import { z } from 'zod';

export const ProcedureGetSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  procedureId: z.string().regex(/^[^/]+$/),
});

export type ProcedureGetInput = z.output<typeof ProcedureGetSchema>;
