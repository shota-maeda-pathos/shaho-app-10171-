import { z } from 'zod';

export const ProcedureCancelSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  procedureId: z.string().regex(/^[^/]+$/),
  /** 自分が始めた手続きは空でもよい。ほかの人のものは必須（rules.ts） */
  reason: z.string().max(200).default(''),
  expectedVersion: z.number().int(),
});

export type ProcedureCancelInput = z.output<typeof ProcedureCancelSchema>;
