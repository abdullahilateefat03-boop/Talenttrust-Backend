import { z } from 'zod';
import { MAX_MILESTONES_PER_CONTRACT, milestoneSchema } from '../../../contracts/bounds';

// Base contract schema for common fields
const contractBaseSchema = {
  title: z.string().min(5).max(100),
  description: z.string().min(10).max(1000),
  freelancerId: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  budget: z.number().positive().max(1000000),
  deadline: z.string().datetime().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED']).default('PENDING'),
  terms: z.string().optional(),
  milestones: z.array(z.object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    amount: z.number().positive(),
    deadline: z.string().datetime().optional(),
    completed: z.boolean().default(false),
  })).optional(),
};

// Create contract schema with strict validation
export const createContractSchema = z.object({
  body: z.object(contractBaseSchema).strict(),
});

// Update contract schema with partial fields for PATCH
export const updateContractSchema = z.object({
  body: z.object({
    title: z.string().min(5).max(100).optional(),
    description: z.string().min(10).max(1000).optional(),
    freelancerId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().optional(),
    budget: z.number().positive().max(1000000).optional(),
    deadline: z.string().datetime().nullable().optional(),
    status: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
    terms: z.string().nullable().optional(),
    milestones: z.array(z.object({
      title: z.string().min(1).max(100),
      description: z.string().min(1).max(500),
      amount: z.number().positive(),
      deadline: z.string().datetime().optional(),
      completed: z.boolean().default(false),
    })).optional(),
  }).strict(),
});

// Query parameters schema for filtering and pagination
export const contractQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    status: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
    clientId: z.string().uuid().optional(),
    freelancerId: z.string().uuid().optional(),
    budget: z.number().positive(),
    milestones: z
      .array(milestoneSchema)
      .max(
        MAX_MILESTONES_PER_CONTRACT,
        `Cannot exceed ${MAX_MILESTONES_PER_CONTRACT} milestones per contract`,
      )
      .optional(),
  }),
});

registry.register('CreateContract', createContractSchema.shape.body);

export type CreateContractDto = z.infer<typeof createContractSchema>['body'];

export const updateContractSchema = z.object({
  body: z.object({
    version: z.number().int().min(0),
    title: z.string().min(5).max(100).optional(),
    status: z.enum(['draft', 'active', 'completed', 'disputed', 'cancelled']).optional(),
  }),
});

export type UpdateContractDto = z.infer<typeof updateContractSchema>['body'];
