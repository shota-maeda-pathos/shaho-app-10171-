import { z } from 'zod';

export const SalaryListSchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  officeId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type SalaryListInput = z.infer<typeof SalaryListSchema>;
