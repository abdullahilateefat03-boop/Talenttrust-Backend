import { randomUUID } from 'uuid';
import { ContractResponse, ContractListResponse, CreateContractDto, UpdateContractDto, ContractQueryParams } from '../modules/contracts/dto/contract.dto';

/**
 * Repository interface for contracts data access layer.
 * Provides abstraction for database operations and enables easy swapping of implementations.
 */
export interface ContractsRepository {
  // CRUD operations
  create(contractData: CreateContractDto): Promise<ContractResponse>;
  findById(id: string): Promise<ContractResponse | null>;
  findMany(params: ContractQueryParams): Promise<ContractListResponse>;
  update(id: string, updateData: UpdateContractDto): Promise<ContractResponse>;
  delete(id: string): Promise<void>;
  
  // Additional utility methods
  exists(id: string): Promise<boolean>;
  count(filters?: Partial<ContractQueryParams>): Promise<number>;
}

/**
 * Contract entity interface representing the database model
 */
export interface ContractEntity {
  id: string;
  title: string;
  description: string;
  freelancerId: string | null;
  clientId: string;
  budget: number;
  deadline: string | null;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  terms: string | null;
  milestones: ContractMilestoneEntity[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractMilestoneEntity {
  title: string;
  description: string;
  amount: number;
  deadline: string | null;
  completed: boolean;
}

/**
 * In-memory implementation of ContractsRepository for development and testing.
 * Implements the full CRUD interface with proper data validation and transformation.
 */
export class InMemoryContractsRepository implements ContractsRepository {
  private contracts: Map<string, ContractEntity> = new Map();

  /**
   * Creates a new contract with generated ID and timestamps
   */
  async create(contractData: CreateContractDto): Promise<ContractResponse> {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const contract: ContractEntity = {
      id,
      title: contractData.title,
      description: contractData.description,
      freelancerId: contractData.freelancerId || null,
      clientId: contractData.clientId,
      budget: contractData.budget,
      deadline: contractData.deadline || null,
      status: contractData.status || 'PENDING',
      terms: contractData.terms || null,
      milestones: contractData.milestones || null,
      createdAt: now,
      updatedAt: now,
    };

    this.contracts.set(id, contract);
    return this.mapToResponse(contract);
  }

  /**
   * Finds a contract by ID
   */
  async findById(id: string): Promise<ContractResponse | null> {
    const contract = this.contracts.get(id);
    return contract ? this.mapToResponse(contract) : null;
  }

  /**
   * Finds multiple contracts with filtering, sorting, and pagination
   */
  async findMany(params: ContractQueryParams): Promise<ContractListResponse> {
    let contracts = Array.from(this.contracts.values());

    // Apply filters
    if (params.status) {
      contracts = contracts.filter(c => c.status === params.status);
    }
    if (params.clientId) {
      contracts = contracts.filter(c => c.clientId === params.clientId);
    }
    if (params.freelancerId) {
      contracts = contracts.filter(c => c.freelancerId === params.freelancerId);
    }

    // Apply sorting
    contracts.sort((a, b) => {
      const aValue = a[params.sortBy as keyof ContractEntity];
      const bValue = b[params.sortBy as keyof ContractEntity];
      
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      
      const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      return params.sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const total = contracts.length;
    const totalPages = Math.ceil(total / params.limit);
    const startIndex = (params.page - 1) * params.limit;
    const endIndex = startIndex + params.limit;
    const paginatedContracts = contracts.slice(startIndex, endIndex);

    return {
      contracts: paginatedContracts.map(c => this.mapToResponse(c)),
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Updates an existing contract
   */
  async update(id: string, updateData: UpdateContractDto): Promise<ContractResponse> {
    const existingContract = this.contracts.get(id);
    if (!existingContract) {
      throw new Error(`Contract with id ${id} not found`);
    }

    const updatedContract: ContractEntity = {
      ...existingContract,
      ...updateData,
      updatedAt: new Date().toISOString(),
    };

    this.contracts.set(id, updatedContract);
    return this.mapToResponse(updatedContract);
  }

  /**
   * Deletes a contract by ID
   */
  async delete(id: string): Promise<void> {
    const exists = this.contracts.has(id);
    if (!exists) {
      throw new Error(`Contract with id ${id} not found`);
    }
    this.contracts.delete(id);
  }

  /**
   * Checks if a contract exists
   */
  async exists(id: string): Promise<boolean> {
    return this.contracts.has(id);
  }

  /**
   * Counts contracts with optional filters
   */
  async count(filters?: Partial<ContractQueryParams>): Promise<number> {
    let contracts = Array.from(this.contracts.values());

    if (filters) {
      if (filters.status) {
        contracts = contracts.filter(c => c.status === filters.status);
      }
      if (filters.clientId) {
        contracts = contracts.filter(c => c.clientId === filters.clientId);
      }
      if (filters.freelancerId) {
        contracts = contracts.filter(c => c.freelancerId === filters.freelancerId);
      }
    }

    return contracts.length;
  }

  /**
   * Maps a ContractEntity to ContractResponse
   */
  private mapToResponse(contract: ContractEntity): ContractResponse {
    return {
      id: contract.id,
      title: contract.title,
      description: contract.description,
      freelancerId: contract.freelancerId,
      clientId: contract.clientId,
      budget: contract.budget,
      deadline: contract.deadline,
      status: contract.status,
      terms: contract.terms,
      milestones: contract.milestones,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }

  /**
   * Utility method for testing - clears all contracts
   */
  clear(): void {
    this.contracts.clear();
  }

  /**
   * Utility method for testing - returns all contracts without pagination
   */
  getAll(): ContractResponse[] {
    return Array.from(this.contracts.values()).map(c => this.mapToResponse(c));
  }
}
