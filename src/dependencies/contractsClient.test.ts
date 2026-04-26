import { ChaosPolicy } from '../chaos/chaosPolicy';
import { ContractsClient, DependencyError } from './contractsClient';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ContractsClient', () => {
  let mockRequest: jest.Mock;

  beforeEach(() => {
    mockRequest = jest.fn();
    mockedAxios.create.mockReturnValue({
      request: mockRequest,
    } as any);
    mockedAxios.isCancel = jest.fn().mockReturnValue(false) as any;
    mockedAxios.isAxiosError = jest.fn().mockReturnValue(false) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns contracts from upstream payload', async () => {
    mockRequest.mockResolvedValue({
      data: { contracts: [{ id: 'ct_1', status: 'open' }] },
    });

    const client = new ContractsClient(
      { upstreamContractsUrl: 'http://upstream/contracts', upstreamTimeoutMs: 500 },
      new ChaosPolicy({ chaosMode: 'off', chaosTargets: [], chaosProbability: 0 }),
    );

    await expect(client.getContracts()).resolves.toEqual([{ id: 'ct_1', status: 'open' }]);
  });

  it('throws when chaos policy injects timeout', async () => {
    const client = new ContractsClient(
      { upstreamContractsUrl: 'http://upstream/contracts', upstreamTimeoutMs: 500 },
      new ChaosPolicy({ chaosMode: 'timeout', chaosTargets: ['contracts'], chaosProbability: 0 }),
    );

    await expect(client.getContracts()).rejects.toBeInstanceOf(DependencyError);
  });

  it('throws when upstream payload is invalid', async () => {
    mockRequest.mockResolvedValue({
      data: { items: [] },
    });

    const client = new ContractsClient(
      { upstreamContractsUrl: 'http://upstream/contracts', upstreamTimeoutMs: 500 },
      new ChaosPolicy({ chaosMode: 'off', chaosTargets: [], chaosProbability: 0 }),
    );

    await expect(client.getContracts()).rejects.toBeInstanceOf(DependencyError);
  });
});
