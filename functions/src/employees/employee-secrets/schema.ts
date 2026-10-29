import { z } from 'zod';

export const SecretsGetSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
});

export type SecretsGetInput = z.infer<typeof SecretsGetSchema>;

export const SecretsUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  myNumber: z.string().regex(/^\d{12}$/, 'マイナンバーは12桁の数字です').optional(),
  basicPensionNumber: z.string().regex(/^\d{4}-\d{6}$/, '基礎年金番号はXXXX-XXXXXXの形式です').optional(),
  expectedVersion: z.number(),
});

export type SecretsUpdateInput = z.infer<typeof SecretsUpdateSchema>;
