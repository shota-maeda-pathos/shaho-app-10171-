import { z } from 'zod';

export const BonusCreateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  totalAmount: z.number().int().min(0),
  standardBonusAmount: z.number().int().min(0),
  cumulativeBonusAmount: z.number().int().min(0),
});

export type BonusCreateInput = z.infer<typeof BonusCreateSchema>;
