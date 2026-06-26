import { Request, Response, NextFunction } from 'express';
import { ContractBoundsError, CONTRACT_BOUNDS } from '../contracts/bounds';

const mockGetAllContracts = jest.fn();
const mockGetContractById = jest.fn();
const mockCreateContract = jest.fn();
const mockGetContractsPage = jest.fn();

jest.mock('../services/contracts.service', () => {
  return {
    ContractsService: jest.fn().mockImplementation(() => {
      return {
        getAllContracts: mockGetAllContracts,
        createContract: mockCreateContract,
        getContractsPage: mockGetContractsPage,
      };
    }),
  };
});
const mockUpdateContract = jest.fn();
const mockDeleteContract = jest.fn();
const mockGetContractStats = jest.fn();

jest.mock('../db/database', () => ({
  getDb: jest.fn().mockReturnValue({}),
}));

jest.mock('../repositories/contractRepository', () => ({
  ContractRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../services/contracts.service', () => ({
  ContractsService: jest.fn().mockImplementation(() => ({
    getAllContracts: mockGetAllContracts,
    getContractById: mockGetContractById,
    createContract: mockCreateContract,
    updateContract: mockUpdateContract,
    deleteContract: mockDeleteContract,
    getContractStats: mockGetContractStats,
  })),
}));

import { ContractsController } from './contracts.controller';

describe('ContractsController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: { title: 'Test Contract' },
      query: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    
    // Clear all mocks
    mockGetAllContracts.mockClear();
    mockGetContractById.mockClear();
    mockCreateContract.mockClear();
    mockGetContractsPage.mockClear();
    mockUpdateContract.mockClear();
    mockDeleteContract.mockClear();
    mockGetContractStats.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // getContracts — happy paths
  // -------------------------------------------------------------------------

  describe('getContracts — success', () => {
    it('returns 200 with cursor page on first page (no cursor)', async () => {
      const fakePage = { data: [], nextCursor: null, hasNextPage: false, limit: 20 };
      mockGetContractsPage.mockResolvedValue(fakePage);

  describe('getContracts', () => {
    it('returns 200 with contracts list', async () => {
      mockGetAllContracts.mockResolvedValue([]);
      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        data: [],
        pagination: expect.any(Object)
      }));
    });

    it('calls next() on error', async () => {
      const mockError = new Error('DB Down');
      mockGetAllContracts.mockRejectedValue(mockError);
      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'success',
        data: fakePage,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes limit and cursor to service when provided', async () => {
      const fakePage = { data: [], nextCursor: null, hasNextPage: false, limit: 5 };
      mockGetContractsPage.mockResolvedValue(fakePage);

      // Build a valid base64url cursor
      const validCursor = Buffer.from(
        JSON.stringify({ createdAt: '2024-01-01T00:00:00.000Z', id: 'abc-123' }),
        'utf8',
      ).toString('base64url');

      mockRequest.query = { limit: '5', cursor: validCursor };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockGetContractsPage).toHaveBeenCalledWith({
        limit: 5,
        cursor: validCursor,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  // -------------------------------------------------------------------------
  // getContracts — validation errors (400)
  // -------------------------------------------------------------------------

  describe('getContracts — validation errors', () => {
    it('returns 400 when limit exceeds 100', async () => {
      mockRequest.query = { limit: '101' };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect((mockResponse.json as jest.Mock).mock.calls[0][0]).toMatchObject({
        status: 'error',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 400 when limit is 0', async () => {
      mockRequest.query = { limit: '0' };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when limit is negative', async () => {
      mockRequest.query = { limit: '-1' };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for a malformed cursor', async () => {
      mockRequest.query = { cursor: 'not-a-valid-cursor' };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect((mockResponse.json as jest.Mock).mock.calls[0][0]).toMatchObject({
        status: 'error',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 400 for a cursor missing the id field', async () => {
      const bad = Buffer.from(
        JSON.stringify({ createdAt: '2024-01-01T00:00:00.000Z' }),
        'utf8',
      ).toString('base64url');
      mockRequest.query = { cursor: bad };

      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });

  // -------------------------------------------------------------------------
  // getContracts — error propagation
  // -------------------------------------------------------------------------

  describe('getContracts — error propagation', () => {
    it('calls next() when service throws', async () => {
      const mockError = new Error('DB Down');
      mockGetContractsPage.mockRejectedValue(mockError);

      await ContractsController.getContracts(
      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getContractById', () => {
    it('returns 200 with contract data', async () => {
      const contract = { id: 'abc', title: 'Test' };
      mockGetContractById.mockResolvedValue(contract);
      mockRequest.params = { id: 'abc' };
      await ContractsController.getContractById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  // -------------------------------------------------------------------------
  // createContract
  // -------------------------------------------------------------------------

  describe('createContract', () => {
    it('returns 201 with the created contract', async () => {
      const fakeContract = { id: 'uuid-1', title: 'Test Contract' };
      mockCreateContract.mockResolvedValue(fakeContract);

      await ContractsController.createContract(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'success',
        data: fakeContract,
      });
    });

    it('calls next() when service throws', async () => {
      const mockError = new Error('Creation failed');
      mockCreateContract.mockRejectedValue(mockError);

      await ContractsController.createContract(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ status: 'success', data: contract });
    });

    it('delegates to next() for NotFoundError when contract missing', async () => {
      mockGetContractById.mockResolvedValue(null);
      mockRequest.params = { id: 'missing' };
      await ContractsController.getContractById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.name).toBe('AppError');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('createContract', () => {
    it('returns 201 on success', async () => {
      const contract = { id: 'abc', status: 'PENDING' };
      mockCreateContract.mockResolvedValue(contract);
      await ContractsController.createContract(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'success',
        data: contract,
        message: 'Contract created successfully'
      });
    });

    it('returns 422 when service throws ContractBoundsError', async () => {
      mockCreateContract.mockRejectedValue(
        new ContractBoundsError('Budget exceeds maximum contract amount'),
      );
      await ContractsController.createContract(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(422);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Budget exceeds maximum contract amount',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('delegates non-bounds errors to next()', async () => {
      const mockError = new Error('Creation failed');
      mockCreateContract.mockRejectedValue(mockError);
      await ContractsController.createContract(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getBounds', () => {
    it('returns 200 with CONTRACT_BOUNDS', () => {
      ContractsController.getBounds(mockRequest as Request, mockResponse as Response);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'success',
        data: CONTRACT_BOUNDS,
      });
    });
  });
});
