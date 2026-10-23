import { z } from 'zod';

export const BonusInsuranceCalculateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  totalBonusAmount: z.number().int().min(0),
  isExempted: z.boolean().optional(),
});

export type BonusInsuranceCalculateInput = z.infer<typeof BonusInsuranceCalculateSchema>;
