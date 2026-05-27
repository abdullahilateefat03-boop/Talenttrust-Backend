import { Registry } from 'prom-client';
import {
  createWebhookMetrics,
  getLabelValues,
  Provider,
  PROVIDERS,
  WebhookMetrics,
} from './webhookMetrics';
import type { WebhookRetryConfig } from './appConfiguration';

export interface DeliveryPayload {
  provider: string;
  url: string;
  body: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  durationSeconds: number;
  enqueueToDoLQ?: boolean;
  error?: string;
}

/**
 * DLQ entry to be enqueued when webhook delivery exhausts retries.
 * Includes all necessary context for later replay and audit.
 */
export interface DLQEntry {
  provider: string;
  url: string;
  body: Record<string, unknown>;
  failureReason: string;
  finalAttemptNumber: number;
  lastError: string;
}

/** Sanitizes provider to a known finite value, preventing label cardinality explosion. */
function sanitizeProvider(raw: string): Provider {
  const normalized = raw.toLowerCase() as Provider;
  return PROVIDERS.includes(normalized) ? normalized : 'generic';
}

/**
 * Determines if an error is transient and therefore retryable.
 * Transient errors: 5xx, connection errors, timeouts
 * Non-transient: 4xx status codes, application errors
 */
function isTransientError(statusCode?: number, errorType?: string): boolean {
  // 4xx errors are never transient - don't retry
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return false;
  }

  // 5xx errors are transient
  if (statusCode !== undefined && statusCode >= 500) {
    return true;
  }

  // Network/connection errors are transient
  if (errorType) {
    return ['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(errorType);
  }

  // Unknown errors default to transient for safety
  return true;
}

/**
 * Calculates exponential backoff delay with jitter.
 * Formula: min(baseDelay * (multiplier ^ attemptNumber), maxDelay) ± jitterAmount
 *
 * @param attemptNumber - Zero-indexed attempt number (0 = first retry)
 * @param config - Retry configuration with delays and multiplier
 * @returns Delay in milliseconds, with jitter applied
 */
function calculateBackoffDelay(attemptNumber: number, config: WebhookRetryConfig): number {
  // Calculate exponential delay
  let delay = config.initialDelayMs * Math.pow(config.multiplier, attemptNumber);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);

  // Apply jitter: ±(delay * jitterFactor * random())
  const jitterAmount = delay * config.jitterFactor * Math.random();
  const jitterOffset = Math.random() < 0.5 ? jitterAmount : -jitterAmount;
  const finalDelay = delay + jitterOffset;

  // Ensure non-zero delay
  return Math.max(100, Math.round(finalDelay));
}

/**
 * Utility to sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebhookDeliveryService {
  private readonly metrics: WebhookMetrics;
  private readonly retryConfig: WebhookRetryConfig;
  private dlqCallback?: (entry: DLQEntry) => Promise<void>;

  constructor(
    private readonly registry: Registry,
    retryConfig: WebhookRetryConfig,
    dlqCallback?: (entry: DLQEntry) => Promise<void>,
  ) {
    this.metrics = createWebhookMetrics(registry);
    this.retryConfig = retryConfig;
    this.dlqCallback = dlqCallback;
  }

  /**
   * Sets a callback to be invoked when a webhook exhausts retries and needs to be enqueued to DLQ.
   * This allows decoupling the delivery service from DLQ storage.
   */
  setDLQCallback(callback: (entry: DLQEntry) => Promise<void>): void {
    this.dlqCallback = callback;
  }

  /**
   * Delivers a webhook payload to the target URL with exponential backoff retry on transient failures.
   *
   * Behavior:
   * - Single attempt on first call
   * - On transient failure: retry with exponential backoff + jitter (up to maxAttempts)
   * - On 4xx error: fail immediately without retry
   * - On success: record metrics and return
   * - After exhausting retries: enqueue to DLQ and record metrics
   *
   * Note: Preserves HMAC signature semantics - the signature is pre-computed by caller
   * and should not be re-signed on retries (timestamp remains stale per spec).
   *
   * @param payload - Webhook payload with provider, URL, and body
   * @param httpClient - Function to execute the actual HTTP call
   * @returns DeliveryResult with success status, status code, and duration
   */
  async deliver(
    payload: DeliveryPayload,
    httpClient: (url: string, body: Record<string, unknown>) => Promise<{ statusCode: number }>,
  ): Promise<DeliveryResult> {
    const provider = sanitizeProvider(payload.provider);
    let attemptNumber = 0;
    let lastStatusCode: number | undefined;
    let lastErrorType: string | undefined;
    let lastError: string | undefined;

    // Retry loop: attempt up to maxAttempts times
    while (attemptNumber < this.retryConfig.maxAttempts) {
      const endTimer = this.metrics.deliveryLatencySeconds.startTimer({ provider });
      lastStatusCode = undefined;
      lastErrorType = undefined;

      try {
        const response = await httpClient(payload.url, payload.body);
        lastStatusCode = response.statusCode;

        // Success: record and return immediately
        if (lastStatusCode >= 200 && lastStatusCode < 300) {
          const { status, reason } = getLabelValues(lastStatusCode);
          const durationSeconds = endTimer({ status });
          this.metrics.deliveryAttemptsTotal.inc({ status, provider, reason });

          return {
            success: true,
            statusCode: lastStatusCode,
            durationSeconds,
          };
        }

        // Non-transient error (4xx): fail immediately without retry
        if (lastStatusCode >= 400 && lastStatusCode < 500) {
          const { status, reason } = getLabelValues(lastStatusCode);
          const durationSeconds = endTimer({ status });
          this.metrics.deliveryAttemptsTotal.inc({ status, provider, reason });

          return {
            success: false,
            statusCode: lastStatusCode,
            durationSeconds,
          };
        }

        // Transient error (5xx): will retry below
      } catch (err: unknown) {
        // Extract error code — never log raw error messages that may contain PII
        lastErrorType = (err as NodeJS.ErrnoException).code ?? 'unknown';
        lastError = (err as Error).message ?? 'Unknown error';
      }

      // Check if the error is transient
      if (!isTransientError(lastStatusCode, lastErrorType)) {
        // Non-transient: fail immediately
        const { status, reason } = getLabelValues(lastStatusCode, lastErrorType);
        const durationSeconds = endTimer({ status });
        this.metrics.deliveryAttemptsTotal.inc({ status, provider, reason });

        return {
          success: false,
          statusCode: lastStatusCode,
          durationSeconds,
        };
      }

      // Transient error: check if we should retry
      if (attemptNumber < this.retryConfig.maxAttempts - 1) {
        // Record retry metric
        const { reason } = getLabelValues(lastStatusCode, lastErrorType);
        this.metrics.deliveryRetriesTotal.inc({ provider, reason });
        endTimer({ status: 'retrying' });

        // Calculate backoff and sleep
        const delayMs = calculateBackoffDelay(attemptNumber, this.retryConfig);
        await sleep(delayMs);
        attemptNumber++;

        // Retry next iteration
        continue;
      }

      // Max retries exhausted: record final failure and enqueue to DLQ
      const { status, reason } = getLabelValues(lastStatusCode, lastErrorType);
      const durationSeconds = endTimer({ status });
      this.metrics.deliveryAttemptsTotal.inc({ status, provider, reason });

      // Enqueue to DLQ if callback is set
      const dlqEntry: DLQEntry = {
        provider,
        url: payload.url,
        body: payload.body,
        failureReason: reason,
        finalAttemptNumber: attemptNumber + 1,
        lastError: lastError || lastErrorType || 'Unknown error',
      };

      if (this.dlqCallback) {
        try {
          await this.dlqCallback(dlqEntry);
        } catch (dlqErr: unknown) {
          console.error('Failed to enqueue webhook to DLQ:', dlqErr);
        }
      }

      return {
        success: false,
        statusCode: lastStatusCode,
        durationSeconds,
        enqueueToDoLQ: true,
        error: lastError || lastErrorType,
      };
    }

    // This should never be reached, but safety fallback
    return {
      success: false,
      durationSeconds: 0,
    };
  }
}
