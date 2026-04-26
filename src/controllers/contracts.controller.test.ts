import { Request, Response, NextFunction } from 'express';
import { ContractBoundsError, CONTRACT_BOUNDS } from '../contracts/bounds';

const mockGetContracts = jest.fn();
const mockGetContractById = jest.fn();
const mockCreateContract = jest.fn();
const mockUpdateContract = jest.fn();
const mockDeleteContract = jest.fn();
const mockGetContractStats = jest.fn();

jest.mock('../db/database', () => ({
  getDb: jest.fn().mockReturnValue({}),
}));

jest.mock('../repositories/contractRepository', () => ({
  ContractRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../services/contracts.service', () => {
  return {
    ContractsService: jest.fn().mockImplementation(() => {
      return {
        getContracts: mockGetContracts,
        getContractById: mockGetContractById,
        createContract: mockCreateContract,
        updateContract: mockUpdateContract,
        deleteContract: mockDeleteContract,
        getContractStats: mockGetContractStats,
      };
    }),
  };
});

import { ContractsController } from './contracts.controller';

describe('ContractsController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: { title: 'Test Contract' },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    
    // Clear all mocks
    mockGetContracts.mockClear();
    mockGetContractById.mockClear();
    mockCreateContract.mockClear();
    mockUpdateContract.mockClear();
    mockDeleteContract.mockClear();
    mockGetContractStats.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getContracts', () => {
    it('returns 200 with contracts list', async () => {
      mockGetAllContracts.mockResolvedValue([]);
      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ status: 'success', data: [] });
    });

    it('calls next() on error', async () => {
      const mockError = new Error('DB Down');
      mockGetAllContracts.mockRejectedValue(mockError);
      await ContractsController.getContracts(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(mockError);
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
      expect(mockResponse.json).toHaveBeenCalledWith({ status: 'success', data: contract });
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
