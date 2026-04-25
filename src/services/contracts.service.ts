import { CreateContractDto, UpdateContractDto } from '../modules/contracts/dto/contract.dto';
import { Contract } from '../db/types';
import { ContractRepository } from '../repositories/contractRepository';
import { SorobanService } from './soroban.service';
import { validateContractBounds, ContractBoundsError } from '../contracts/bounds';

/**
 * @dev Service layer for managing Freelancer Escrow Contracts.
 * Handles business logic, database interactions (mocked for now),
 * and orchestration with the Soroban smart contract service.
 */
export class ContractsService {
  private repository: ContractsRepository;
  private sorobanService: SorobanService;

  // Mock database
  private contracts: any[] = [];

  constructor(contractRepository: ContractRepository) {
    this.sorobanService = new SorobanService();
    this.contractRepository = contractRepository;
  }

  /**
   * Retrieves all contracts from the repository.
   * @returns Array of contract metadata including version field.
   */
  public async getAllContracts(): Promise<Contract[]> {
    return this.contractRepository.findAll();
  }

  /**
   * Retrieves a single contract by ID.
   * @param id The contract UUID.
   * @returns The contract or undefined if not found.
   */
  public async getContractById(id: string): Promise<Contract | undefined> {
    return this.contractRepository.findById(id);
  }

  /**
   * Creates a new contract off-chain, preparing it for escrow deposit.
   * Enforces milestone count and total amount caps before persisting.
   * @param data The contract details conforming to CreateContractDto.
   * @returns The newly created contract object.
   * @throws ContractBoundsError if budget or milestone totals exceed policy limits.
   */
  public async createContract(data: CreateContractDto) {
    const boundsCheck = validateContractBounds(data.budget, data.milestones);
    if (!boundsCheck.valid) {
      throw new ContractBoundsError(boundsCheck.error);
    }

    const newContract = {
      id: crypto.randomUUID(),
      ...data,
      status: 'PENDING',
      createdAt: new Date(),
    };

    this.contracts.push(newContract);

    // Simulate notifying the Soroban service to prepare the transaction
    await this.sorobanService.prepareEscrow(newContract.id, data.budget);

    return stats;
  }

  /**
   * Updates a contract using Optimistic Concurrency Control.
   * Destructures `version` from the DTO and delegates to the repository's
   * atomic compare-and-swap method. `VersionConflictError` propagates
   * naturally so the error handler can map it to HTTP 409.
   *
   * @param id  - UUID of the contract to update.
   * @param dto - Update payload including the required `version` field.
   * @returns The updated Contract with an incremented version.
   * @throws {VersionConflictError} When the stored version does not match `dto.version`.
   */
  public async updateContract(id: string, dto: UpdateContractDto): Promise<Contract> {
    const { version, ...fields } = dto;
    return this.contractRepository.updateWithVersion(id, fields, version);
  }
}
