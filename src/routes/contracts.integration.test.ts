import request from 'supertest';
import express from 'express';
import contractsRoutes from './contracts.routes';

// Mock the services to isolate route testing
jest.mock('../services/contracts.service');
jest.mock('../services/soroban.service');

import { ContractsService } from '../services/contracts.service';

describe('Contracts Routes Integration Tests', () => {
  let app: express.Application;
  let mockContractsService: jest.Mocked<ContractsService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/contracts', contractsRoutes);
    
    mockContractsService = ContractsService as jest.Mocked<typeof ContractsService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/contracts', () => {
    it('should return contracts list with pagination', async () => {
      const mockContractsData = {
        contracts: [
          {
            id: 'contract-1',
            title: 'Test Contract',
            description: 'A test contract',
            clientId: 'client-1',
            freelancerId: null,
            budget: 1000,
            deadline: null,
            status: 'PENDING',
            terms: null,
            milestones: null,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      };

      mockContractsService.prototype.getContracts = jest.fn().mockResolvedValue(mockContractsData);

      const response = await request(app)
        .get('/api/v1/contracts?page=1&limit=10')
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        data: mockContractsData,
      });
    });

    it('should handle validation errors for query parameters', async () => {
      const response = await request(app)
        .get('/api/v1/contracts?page=invalid&limit=abc')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should handle service errors', async () => {
      mockContractsService.prototype.getContracts = jest.fn().mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/contracts')
        .expect(500);

      // Error should be handled by error middleware
    });
  });

  describe('GET /api/v1/contracts/stats', () => {
    it('should return contract statistics', async () => {
      const mockStats = {
        total: 5,
        byStatus: {
          PENDING: 2,
          ACTIVE: 2,
          COMPLETED: 1,
          CANCELLED: 0,
          DISPUTED: 0,
        },
        totalBudget: 10000,
      };

      mockContractsService.prototype.getContractStats = jest.fn().mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/v1/contracts/stats')
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        data: mockStats,
      });
    });
  });

  describe('GET /api/v1/contracts/:id', () => {
    it('should return a contract when found', async () => {
      const mockContract = {
        id: 'contract-1',
        title: 'Test Contract',
        description: 'A test contract',
        clientId: 'client-1',
        freelancerId: null,
        budget: 1000,
        deadline: null,
        status: 'PENDING',
        terms: null,
        milestones: null,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockContractsService.prototype.getContractById = jest.fn().mockResolvedValue(mockContract);

      const response = await request(app)
        .get('/api/v1/contracts/contract-1')
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        data: mockContract,
      });
    });

    it('should return 404 when contract not found', async () => {
      mockContractsService.prototype.getContractById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/contracts/non-existent')
        .expect(404);

      expect(response.body).toEqual({
        status: 'error',
        error: 'Contract not found',
      });
    });

    it('should handle validation errors for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/v1/contracts/invalid-uuid')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('POST /api/v1/contracts', () => {
    it('should create a contract with valid data', async () => {
      const mockContract = {
        id: 'contract-1',
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        freelancerId: null,
        budget: 1000,
        deadline: null,
        status: 'PENDING',
        terms: null,
        milestones: null,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockContractsService.prototype.createContract = jest.fn().mockResolvedValue(mockContract);

      const contractData = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
      };

      const response = await request(app)
        .post('/api/v1/contracts')
        .send(contractData)
        .expect(201);

      expect(response.body).toEqual({
        status: 'success',
        data: mockContract,
        message: 'Contract created successfully',
      });
    });

    it('should handle validation errors for invalid data', async () => {
      const invalidData = {
        title: 'AB', // Too short
        description: 'Short', // Too short
        clientId: 'invalid-uuid',
        budget: -100, // Negative
      };

      const response = await request(app)
        .post('/api/v1/contracts')
        .send(invalidData)
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should handle validation errors for unknown fields', async () => {
      const invalidData = {
        title: 'Valid Title',
        description: 'Valid description that is long enough',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
        unknownField: 'should not be allowed',
      };

      const response = await request(app)
        .post('/api/v1/contracts')
        .send(invalidData)
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('PATCH /api/v1/contracts/:id', () => {
    it('should update a contract with valid data', async () => {
      const mockUpdatedContract = {
        id: 'contract-1',
        title: 'Updated Contract',
        description: 'Updated description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        freelancerId: null,
        budget: 1500,
        deadline: null,
        status: 'ACTIVE',
        terms: null,
        milestones: null,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z',
      };

      mockContractsService.prototype.updateContract = jest.fn().mockResolvedValue(mockUpdatedContract);

      const updateData = {
        title: 'Updated Contract',
        budget: 1500,
        status: 'ACTIVE',
      };

      const response = await request(app)
        .patch('/api/v1/contracts/contract-1')
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        data: mockUpdatedContract,
        message: 'Contract updated successfully',
      });
    });

    it('should handle validation errors for invalid UUID', async () => {
      const response = await request(app)
        .patch('/api/v1/contracts/invalid-uuid')
        .send({ title: 'Updated' })
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });

    it('should handle validation errors for invalid update data', async () => {
      const invalidData = {
        title: 'AB', // Too short
        status: 'INVALID_STATUS',
      };

      const response = await request(app)
        .patch('/api/v1/contracts/550e8400-e29b-41d4-a716-446655440000')
        .send(invalidData)
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('DELETE /api/v1/contracts/:id', () => {
    it('should delete a contract', async () => {
      mockContractsService.prototype.deleteContract = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/contracts/contract-1')
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        message: 'Contract deleted successfully',
      });
    });

    it('should handle validation errors for invalid UUID', async () => {
      const response = await request(app)
        .delete('/api/v1/contracts/invalid-uuid')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });

    it('should handle service errors when contract not found', async () => {
      mockContractsService.prototype.deleteContract = jest.fn().mockRejectedValue(new Error('Contract not found'));

      const response = await request(app)
        .delete('/api/v1/contracts/550e8400-e29b-41d4-a716-446655440000')
        .expect(500);

      // Error should be handled by error middleware
    });
  });
});
