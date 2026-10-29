import { z } from 'zod';
const id = z.string().min(1).max(128).regex(/^[^/]+$/);
export const bonusGetSchema = z.object({ companyId: id, employeeId: id, yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
export const bonusUpdateSchema = bonusGetSchema.extend({
  totalAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cumulativeBonusAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).multipleOf(1000),
  expectedVersion: z.number().int().min(1), requestId: z.string().uuid(),
}).refine(v => v.cumulativeBonusAmount >= Math.floor(v.totalAmount / 1000) * 1000, { message: '年度累計は今回の標準賞与額以上にしてください' });
export type BonusGetInput = z.infer<typeof bonusGetSchema>;
export type BonusUpdateInput = z.infer<typeof bonusUpdateSchema>;
