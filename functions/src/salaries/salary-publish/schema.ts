import { z } from 'zod';

export const SalaryPublishSchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
});

export type SalaryPublishInput = z.infer<typeof SalaryPublishSchema>;
