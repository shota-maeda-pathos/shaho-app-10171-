import { z } from 'zod';
import { ProcedureTypeEnum } from '../procedure-create/schema';

export const ProcedureListSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  status: z.enum(['draft', 'in_progress', 'completed', 'cancelled']).optional(),
  procedureType: ProcedureTypeEnum.optional(),
  assignedTo: z.string().optional(),
  employeeId: z.string().regex(/^[^/]+$/).optional(),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().regex(/^[^/]+$/).optional(),
});

export type ProcedureListInput = z.output<typeof ProcedureListSchema>;
