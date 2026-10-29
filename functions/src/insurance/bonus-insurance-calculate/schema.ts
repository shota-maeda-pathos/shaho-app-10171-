import { z } from 'zod';

export const BonusInsuranceCalculateSchema = z.object({
  companyId: z.string().min(1).max(128).regex(/^[^/]+$/),
  employeeId: z.string().min(1).max(128).regex(/^[^/]+$/),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  totalBonusAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  isExempted: z.boolean().optional(),
});

export type BonusInsuranceCalculateInput = z.infer<typeof BonusInsuranceCalculateSchema>;
