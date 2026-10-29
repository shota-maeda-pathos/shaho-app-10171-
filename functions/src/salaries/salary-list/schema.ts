import { z } from 'zod';

export const SalaryListSchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  officeId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
  /** 1人分の詳細（手当・現物給与・遡及差額など）を返す */
  employeeId: z.string().regex(/^[^/]+$/).optional(),
});

export type SalaryListInput = z.infer<typeof SalaryListSchema>;
