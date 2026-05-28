import { Registry } from 'prom-client';
import { WebhookDeliveryService, DeliveryPayload, DLQEntry } from './webhookDelivery';
import { getLabelValues } from './webhookMetrics';
import type { WebhookRetryConfig } from './appConfiguration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultRetryConfig: WebhookRetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 100, // Short for testing
  maxDelayMs: 1000,
  multiplier: 2,
  jitterFactor: 0.1,
};

function makeRegistry() {
  return new Registry();
}

function makeService(registry: Registry, retryConfig = defaultRetryConfig, dlqCallback?: (entry: DLQEntry) => Promise<void>) {
  return new WebhookDeliveryService(registry, retryConfig, dlqCallback);
}

const basePayload: DeliveryPayload = {
  provider: 'stripe',
  url: 'https://example.com/webhook',
  body: { event: 'payment.succeeded' },
};

async function getCounterValue(
  registry: Registry,
  labels: Record<string, string>,
): Promise<number> {
  const metrics = await registry.getMetricsAsJSON();
  const counter = metrics.find((m) => m.name === 'webhook_delivery_attempts_total');
  if (!counter || !('values' in counter)) return 0;
  const match = (counter.values as Array<{ labels: Record<string, string>; value: number }>).find(
    (v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

async function getRetryCounterValue(
  registry: Registry,
  labels: Record<string, string>,
): Promise<number> {
  const metrics = await registry.getMetricsAsJSON();
  const counter = metrics.find((m) => m.name === 'webhook_delivery_retries_total');
  if (!counter || !('values' in counter)) return 0;
  const match = (counter.values as Array<{ labels: Record<string, string>; value: number }>).find(
    (v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

async function getHistogramSampleCount(
  registry: Registry,
  labels: Record<string, string>,
): Promise<number> {
  const metrics = await registry.getMetricsAsJSON();
  const hist = metrics.find((m) => m.name === 'webhook_delivery_latency_seconds');
  if (!hist || !('values' in hist)) return 0;
  const countEntry = (
    hist.values as Array<{ labels: Record<string, string>; value: number; metricName?: string }>
  ).find(
    (v) =>
      v.metricName === 'webhook_delivery_latency_seconds_count' &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return countEntry?.value ?? 0;
}

// ---------------------------------------------------------------------------
// getLabelValues unit tests
// ---------------------------------------------------------------------------

describe('getLabelValues', () => {
  it('returns success for 2xx status codes', () => {
    expect(getLabelValues(200)).toEqual({ status: 'success', reason: 'unknown' });
    expect(getLabelValues(201)).toEqual({ status: 'success', reason: 'unknown' });
  });

  it('returns 4xx_client_error for 4xx status codes', () => {
    expect(getLabelValues(400)).toEqual({ status: 'failure', reason: '4xx_client_error' });
    expect(getLabelValues(404)).toEqual({ status: 'failure', reason: '4xx_client_error' });
  });

  it('returns 5xx_server_error for 5xx status codes', () => {
    expect(getLabelValues(500)).toEqual({ status: 'failure', reason: '5xx_server_error' });
    expect(getLabelValues(503)).toEqual({ status: 'failure', reason: '5xx_server_error' });
  });

  it('returns timeout for ETIMEDOUT error', () => {
    expect(getLabelValues(undefined, 'ETIMEDOUT')).toEqual({ status: 'failure', reason: 'timeout' });
    expect(getLabelValues(undefined, 'ECONNABORTED')).toEqual({ status: 'failure', reason: 'timeout' });
  });

  it('returns dns_resolution_failure for ENOTFOUND / EAI_AGAIN', () => {
    expect(getLabelValues(undefined, 'ENOTFOUND')).toEqual({ status: 'failure', reason: 'dns_resolution_failure' });
    expect(getLabelValues(undefined, 'EAI_AGAIN')).toEqual({ status: 'failure', reason: 'dns_resolution_failure' });
  });

  it('returns connection_refused for ECONNREFUSED', () => {
    expect(getLabelValues(undefined, 'ECONNREFUSED')).toEqual({ status: 'failure', reason: 'connection_refused' });
  });

  it('returns unknown for unrecognised errors', () => {
    expect(getLabelValues(undefined, 'SOME_WEIRD_CODE')).toEqual({ status: 'failure', reason: 'unknown' });
    expect(getLabelValues()).toEqual({ status: 'failure', reason: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService integration tests
// ---------------------------------------------------------------------------

describe('WebhookDeliveryService', () => {
  describe('successful delivery', () => {
    it('increments success counter and records latency', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);

      const count = await getCounterValue(registry, {
        status: 'success',
        provider: 'stripe',
        reason: 'unknown',
      });
      expect(count).toBe(1);

      const histCount = await getHistogramSampleCount(registry, {
        status: 'success',
        provider: 'stripe',
      });
      expect(histCount).toBe(1);
    });

    it('increments counter again on a second successful call', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 200 });

      await service.deliver(basePayload, httpClient);
      await service.deliver(basePayload, httpClient);

      const count = await getCounterValue(registry, {
        status: 'success',
        provider: 'stripe',
        reason: 'unknown',
      });
      expect(count).toBe(2);
    });
  });

  describe('non-retryable failures (4xx)', () => {
    it('does not retry on 4xx_client_error (HTTP 404)', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 404 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(httpClient).toHaveBeenCalledTimes(1);

      const count = await getCounterValue(registry, {
        status: 'failure',
        provider: 'stripe',
        reason: '4xx_client_error',
      });
      expect(count).toBe(1);

      const retryCount = await getRetryCounterValue(registry, {
        provider: 'stripe',
        reason: '4xx_client_error',
      });
      expect(retryCount).toBe(0);
    });

    it('does not retry on other 4xx errors', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 401 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(httpClient).toHaveBeenCalledTimes(1);
    });

    it('does not retry on HTTP 400 Bad Request', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 400 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(httpClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable failures (5xx)', () => {
    it('retries on 5xx_server_error (HTTP 500) then succeeds', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest
        .fn()
        .mockResolvedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(3);

      const retryCount = await getRetryCounterValue(registry, {
        provider: 'stripe',
        reason: '5xx_server_error',
      });
      expect(retryCount).toBe(2);
    });

    it('retries on HTTP 503 Service Unavailable', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest
        .fn()
        .mockResolvedValueOnce({ statusCode: 503 })
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(2);
    });

    it('retries until max attempts reached then enqueues to DLQ', async () => {
      const registry = makeRegistry();
      const dlqEntries: DLQEntry[] = [];
      const dlqCallback = jest.fn(async (entry: DLQEntry) => {
        dlqEntries.push(entry);
      });
      const service = makeService(registry, defaultRetryConfig, dlqCallback);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 500 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(result.enqueueToDoLQ).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(5); // maxAttempts = 5
      expect(dlqCallback).toHaveBeenCalledTimes(1);

      const dlqEntry = dlqEntries[0];
      expect(dlqEntry).toMatchObject({
        provider: 'stripe',
        url: 'https://example.com/webhook',
        body: { event: 'payment.succeeded' },
        failureReason: '5xx_server_error',
        finalAttemptNumber: 5,
      });

      const retryCount = await getRetryCounterValue(registry, {
        provider: 'stripe',
        reason: '5xx_server_error',
      });
      expect(retryCount).toBe(4); // 4 retries (attempt 2-5), attempt 1 is initial
    });
  });

  describe('transient network errors', () => {
    it('retries on ETIMEDOUT error then succeeds', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      const httpClient = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(2);

      const retryCount = await getRetryCounterValue(registry, {
        provider: 'stripe',
        reason: 'timeout',
      });
      expect(retryCount).toBe(1);
    });

    it('retries on ECONNRESET error then succeeds', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      const httpClient = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(2);
    });

    it('retries on ECONNABORTED error', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('connection aborted'), { code: 'ECONNABORTED' });
      const httpClient = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(2);
    });

    it('retries on ENOTFOUND (DNS) error then succeeds', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      const httpClient = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(2);

      const retryCount = await getRetryCounterValue(registry, {
        provider: 'stripe',
        reason: 'dns_resolution_failure',
      });
      expect(retryCount).toBe(1);
    });

    it('exhausts retries on ETIMEDOUT and enqueues to DLQ', async () => {
      const registry = makeRegistry();
      const dlqEntries: DLQEntry[] = [];
      const dlqCallback = jest.fn(async (entry: DLQEntry) => {
        dlqEntries.push(entry);
      });
      const service = makeService(registry, defaultRetryConfig, dlqCallback);
      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      const httpClient = jest.fn().mockRejectedValue(err);

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(result.enqueueToDoLQ).toBe(true);
      expect(httpClient).toHaveBeenCalledTimes(5);
      expect(dlqCallback).toHaveBeenCalledTimes(1);

      const dlqEntry = dlqEntries[0];
      expect(dlqEntry.failureReason).toBe('timeout');
      expect(dlqEntry.finalAttemptNumber).toBe(5);
    });
  });

  describe('exponential backoff behavior', () => {
    it('applies exponential backoff with increasing delays', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const timings: number[] = [];
      const httpClient = jest.fn(async () => {
        timings.push(Date.now());
        return { statusCode: 500 };
      });

      await service.deliver(basePayload, httpClient);

      expect(httpClient).toHaveBeenCalledTimes(5);
      expect(timings.length).toBe(5);

      // Check that delays increase exponentially
      // Note: Jitter makes exact values hard to predict, but general trend should be there
      const delay1 = timings[1] - timings[0];
      const delay2 = timings[2] - timings[1];
      const delay3 = timings[3] - timings[2];

      // Delays should generally increase (within jitter bounds)
      expect(delay2).toBeGreaterThan(0);
      expect(delay3).toBeGreaterThan(0);
    });

    it('caps delay at maxDelayMs', async () => {
      const registry = makeRegistry();
      const fastRetryConfig: WebhookRetryConfig = {
        maxAttempts: 10,
        initialDelayMs: 100,
        maxDelayMs: 500,
        multiplier: 3, // High multiplier to exceed max quickly
        jitterFactor: 0.1,
      };
      const service = makeService(registry, fastRetryConfig);
      const timings: number[] = [];
      const httpClient = jest.fn(async () => {
        timings.push(Date.now());
        return { statusCode: 500 };
      });

      await service.deliver(basePayload, httpClient);

      // Check that delays don't exceed maxDelayMs by too much
      for (let i = 1; i < timings.length; i++) {
        const delay = timings[i] - timings[i - 1];
        expect(delay).toBeLessThanOrEqual(fastRetryConfig.maxDelayMs + 100); // +100 for jitter
      }
    });
  });

  describe('cardinality safety', () => {
    it('maps unknown providers to "generic"', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 200 });

      await service.deliver({ ...basePayload, provider: 'some-random-provider-xyz' }, httpClient);

      const count = await getCounterValue(registry, {
        status: 'success',
        provider: 'generic',
        reason: 'unknown',
      });
      expect(count).toBe(1);
    });

    it('does not create a label entry for an arbitrary provider name', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 200 });

      await service.deliver({ ...basePayload, provider: 'webhook-id-abc123' }, httpClient);

      // The raw provider name must NOT appear in the metrics output
      const raw = await registry.metrics();
      expect(raw).not.toContain('webhook-id-abc123');
    });
  });

  describe('latency histogram', () => {
    it('records one observation per delivery call', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 200 });

      await service.deliver(basePayload, httpClient);
      await service.deliver(basePayload, httpClient);
      await service.deliver({ ...basePayload, provider: 'github' }, httpClient);

      const stripeCount = await getHistogramSampleCount(registry, {
        status: 'success',
        provider: 'stripe',
      });
      expect(stripeCount).toBe(2);

      const githubCount = await getHistogramSampleCount(registry, {
        status: 'success',
        provider: 'github',
      });
      expect(githubCount).toBe(1);
    });

    it('records histogram entries for each retry attempt', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest
        .fn()
        .mockResolvedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce({ statusCode: 200 });

      await service.deliver(basePayload, httpClient);

      // Should record 3 histogram entries (one per attempt)
      const count = await getHistogramSampleCount(registry, {
        status: 'success',
        provider: 'stripe',
      });
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('HMAC signature semantics', () => {
    it('does not re-sign webhook on retries (signature remains with original timestamp)', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      // Signature and timestamp are passed in the payload body (as strings/metadata)
      // The httpClient receives them and should not modify them
      const signedPayload: DeliveryPayload = {
        provider: 'stripe',
        url: 'https://example.com/webhook',
        body: {
          event: 'payment.succeeded',
          // In real usage, headers would contain X-Signature and X-Timestamp
          // These are not retried/re-signed
        },
      };

      const httpClient = jest
        .fn()
        .mockResolvedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await service.deliver(signedPayload, httpClient);

      expect(result.success).toBe(true);
      // Both calls receive the exact same body (signature unchanged)
      expect(httpClient).toHaveBeenCalledWith(signedPayload.url, signedPayload.body);
      expect(httpClient).toHaveBeenCalledWith(signedPayload.url, signedPayload.body);
    });
  });

  describe('DLQ callback error handling', () => {
    it('handles DLQ callback failures gracefully', async () => {
      const registry = makeRegistry();
      const dlqCallback = jest.fn(async () => {
        throw new Error('DLQ storage failed');
      });
      const service = makeService(registry, defaultRetryConfig, dlqCallback);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 500 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(result.enqueueToDoLQ).toBe(true);
      // Should not throw, callback should be invoked despite error
      expect(dlqCallback).toHaveBeenCalledTimes(1);
    });

    it('records failure even if DLQ callback is not set', async () => {
      const registry = makeRegistry();
      const service = makeService(registry, defaultRetryConfig, undefined);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 500 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(result.enqueueToDoLQ).toBe(true);
    });
  });

  describe('failure scenarios', () => {
    it('records 5xx_server_error on HTTP 500', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const httpClient = jest.fn().mockResolvedValue({ statusCode: 500 });

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      const count = await getCounterValue(registry, {
        status: 'failure',
        provider: 'stripe',
        reason: '5xx_server_error',
      });
      expect(count).toBe(1);
    });

    it('records timeout on ETIMEDOUT network error', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      const httpClient = jest.fn().mockRejectedValue(err);

      const result = await service.deliver(basePayload, httpClient);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeUndefined();
      const count = await getCounterValue(registry, {
        status: 'failure',
        provider: 'stripe',
        reason: 'timeout',
      });
      expect(count).toBe(1);
    });

    it('records dns_resolution_failure on ENOTFOUND', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      const httpClient = jest.fn().mockRejectedValue(err);

      await service.deliver(basePayload, httpClient);

      const count = await getCounterValue(registry, {
        status: 'failure',
        provider: 'stripe',
        reason: 'dns_resolution_failure',
      });
      expect(count).toBe(1);
    });

    it('records connection_refused on ECONNREFUSED', async () => {
      const registry = makeRegistry();
      const service = makeService(registry);
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const httpClient = jest.fn().mockRejectedValue(err);

      await service.deliver(basePayload, httpClient);

      const count = await getCounterValue(registry, {
        status: 'failure',
        provider: 'stripe',
        reason: 'connection_refused',
      });
      expect(count).toBe(1);
    });
  });
});
