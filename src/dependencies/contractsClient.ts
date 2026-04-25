import { AppConfig } from '../appConfiguration';
import { ChaosPolicy } from '../chaos/chaosPolicy';
import { Contract, ContractsPayload } from '../types/contracts';
import { UpstreamHttpClient, DependencyError } from './upstreamHttpClient';

export { DependencyError };

/**
 * Fetches contracts from an upstream dependency and can inject outages for resilience testing.
 */
export class ContractsClient {
  private readonly client: UpstreamHttpClient;

  constructor(
    private readonly config: Pick<AppConfig, 'upstreamContractsUrl' | 'upstreamTimeoutMs'>,
    chaosPolicy: ChaosPolicy,
  ) {
    this.client = new UpstreamHttpClient(
      {
        dependencyName: 'contracts',
        baseUrl: this.config.upstreamContractsUrl,
        timeoutMs: this.config.upstreamTimeoutMs,
        retryOptions: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5000 },
      },
      chaosPolicy
    );
  }

  async getContracts(): Promise<Contract[]> {
    try {
      const payload = await this.client.get<ContractsPayload>('', {
        headers: { Accept: 'application/json' }
      });
      
      if (!payload || !Array.isArray(payload.contracts)) {
        throw new DependencyError('Upstream payload validation failed');
      }

      return payload.contracts;
    } catch (error) {
      if (error instanceof DependencyError) {
        throw error;
      }
      throw new DependencyError('Upstream dependency unavailable');
    }
  }
}
