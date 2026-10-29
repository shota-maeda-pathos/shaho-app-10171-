import { z } from 'zod';

export const BonusCreateSchema = z.object({
  companyId: z.string().min(1).max(128).regex(/^[^/]+$/),
  employeeId: z.string().min(1).max(128).regex(/^[^/]+$/),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  totalAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  standardBonusAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cumulativeBonusAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).multipleOf(1000),
}).refine(v => v.standardBonusAmount === Math.floor(v.totalAmount / 1000) * 1000, { message: '標準賞与額は総額の1,000円未満を切り捨てた額です' })
  .refine(v => v.cumulativeBonusAmount >= v.standardBonusAmount, { message: '年度累計は今回の標準賞与額以上にしてください' });

export type BonusCreateInput = z.infer<typeof BonusCreateSchema>;
