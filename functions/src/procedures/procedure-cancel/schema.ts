import { z } from 'zod';

export const ProcedureCancelSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  procedureId: z.string().regex(/^[^/]+$/),
  reason: z.string().min(1),
  expectedVersion: z.number().int(),
});

export type ProcedureCancelInput = z.output<typeof ProcedureCancelSchema>;
