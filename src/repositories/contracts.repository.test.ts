import { ContractsRepository, InMemoryContractsRepository } from './contracts.repository';
import { CreateContractDto, UpdateContractDto, ContractQueryParams } from '../modules/contracts/dto/contract.dto';

describe('ContractsRepository', () => {
  let repository: ContractsRepository;

  beforeEach(() => {
    repository = new InMemoryContractsRepository();
  });

  describe('create', () => {
    it('should create a contract with valid data', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
        status: 'PENDING',
      };

      const result = await repository.create(contractData);

      expect(result).toMatchObject({
        title: contractData.title,
        description: contractData.description,
        clientId: contractData.clientId,
        budget: contractData.budget,
        status: contractData.status,
        freelancerId: null,
        terms: null,
        milestones: null,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a contract with milestones', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract with Milestones',
        description: 'A test contract with milestones',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 2000,
        milestones: [
          {
            title: 'Milestone 1',
            description: 'First milestone',
            amount: 1000,
            completed: false,
          },
          {
            title: 'Milestone 2',
            description: 'Second milestone',
            amount: 1000,
            completed: false,
          },
        ],
      };

      const result = await repository.create(contractData);

      expect(result.milestones).toHaveLength(2);
      expect(result.milestones![0].title).toBe('Milestone 1');
      expect(result.milestones![1].amount).toBe(1000);
    });
  });

  describe('findById', () => {
    it('should return a contract when found', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
      };

      const created = await repository.create(contractData);
      const found = await repository.findById(created.id);

      expect(found).toEqual(created);
    });

    it('should return null when contract not found', async () => {
      const result = await repository.findById('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    beforeEach(async () => {
      // Create test contracts
      await repository.create({
        title: 'Contract 1',
        description: 'First contract',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
        status: 'PENDING',
      });

      await repository.create({
        title: 'Contract 2',
        description: 'Second contract',
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        budget: 2000,
        status: 'ACTIVE',
      });

      await repository.create({
        title: 'Contract 3',
        description: 'Third contract',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1500,
        status: 'COMPLETED',
      });
    });

    it('should return paginated contracts', async () => {
      const params: ContractQueryParams = {
        page: 1,
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      const result = await repository.findMany(params);

      expect(result.contracts).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('should filter by status', async () => {
      const params: ContractQueryParams = {
        page: 1,
        limit: 10,
        status: 'PENDING',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      const result = await repository.findMany(params);

      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0].status).toBe('PENDING');
    });

    it('should filter by clientId', async () => {
      const params: ContractQueryParams = {
        page: 1,
        limit: 10,
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      const result = await repository.findMany(params);

      expect(result.contracts).toHaveLength(2);
      expect(result.contracts.every(c => c.clientId === '550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should sort by budget in ascending order', async () => {
      const params: ContractQueryParams = {
        page: 1,
        limit: 10,
        sortBy: 'budget',
        sortOrder: 'asc',
      };

      const result = await repository.findMany(params);

      expect(result.contracts[0].budget).toBe(1000);
      expect(result.contracts[1].budget).toBe(1500);
      expect(result.contracts[2].budget).toBe(2000);
    });

    it('should sort by budget in descending order', async () => {
      const params: ContractQueryParams = {
        page: 1,
        limit: 10,
        sortBy: 'budget',
        sortOrder: 'desc',
      };

      const result = await repository.findMany(params);

      expect(result.contracts[0].budget).toBe(2000);
      expect(result.contracts[1].budget).toBe(1500);
      expect(result.contracts[2].budget).toBe(1000);
    });
  });

  describe('update', () => {
    it('should update an existing contract', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
      };

      const created = await repository.create(contractData);
      const updateData: UpdateContractDto = {
        title: 'Updated Contract',
        budget: 1500,
        status: 'ACTIVE',
      };

      const updated = await repository.update(created.id, updateData);

      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe('Updated Contract');
      expect(updated.budget).toBe(1500);
      expect(updated.status).toBe('ACTIVE');
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    it('should throw error when updating non-existent contract', async () => {
      const updateData: UpdateContractDto = {
        title: 'Updated Contract',
      };

      await expect(repository.update('non-existent-id', updateData)).rejects.toThrow(
        'Contract with id non-existent-id not found'
      );
    });

    it('should handle null values in update', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
        freelancerId: '550e8400-e29b-41d4-a716-446655440001',
      };

      const created = await repository.create(contractData);
      const updateData: UpdateContractDto = {
        freelancerId: null,
        terms: null,
      };

      const updated = await repository.update(created.id, updateData);

      expect(updated.freelancerId).toBeNull();
      expect(updated.terms).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing contract', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
      };

      const created = await repository.create(contractData);
      await repository.delete(created.id);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });

    it('should throw error when deleting non-existent contract', async () => {
      await expect(repository.delete('non-existent-id')).rejects.toThrow(
        'Contract with id non-existent-id not found'
      );
    });
  });

  describe('exists', () => {
    it('should return true for existing contract', async () => {
      const contractData: CreateContractDto = {
        title: 'Test Contract',
        description: 'A test contract description',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
      };

      const created = await repository.create(contractData);
      const exists = await repository.exists(created.id);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent contract', async () => {
      const exists = await repository.exists('non-existent-id');
      expect(exists).toBe(false);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await repository.create({
        title: 'Contract 1',
        description: 'First contract',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 1000,
        status: 'PENDING',
      });

      await repository.create({
        title: 'Contract 2',
        description: 'Second contract',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        budget: 2000,
        status: 'ACTIVE',
      });

      await repository.create({
        title: 'Contract 3',
        description: 'Third contract',
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        budget: 1500,
        status: 'PENDING',
      });
    });

    it('should return total count without filters', async () => {
      const count = await repository.count();
      expect(count).toBe(3);
    });

    it('should return filtered count by status', async () => {
      const count = await repository.count({ status: 'PENDING' });
      expect(count).toBe(2);
    });

    it('should return filtered count by clientId', async () => {
      const count = await repository.count({ clientId: '550e8400-e29b-41d4-a716-446655440000' });
      expect(count).toBe(2);
    });
  });
});
