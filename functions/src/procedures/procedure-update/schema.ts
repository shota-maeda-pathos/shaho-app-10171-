import { z } from 'zod';

export const ProcedureUpdateSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  procedureId: z.string().regex(/^[^/]+$/),
  notes: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  expectedVersion: z.number().int(),
});

export type ProcedureUpdateInput = z.output<typeof ProcedureUpdateSchema>;
