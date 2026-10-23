import { z } from 'zod';

export const MonthlyInsuranceCalculateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  isExempted: z.boolean().optional(),
});

export type MonthlyInsuranceCalculateInput = z.infer<typeof MonthlyInsuranceCalculateSchema>;
