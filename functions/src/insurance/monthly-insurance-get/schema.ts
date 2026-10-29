import { z } from 'zod';
export const monthlyInsuranceGetSchema = z.object({ companyId: z.string().min(1), employeeId: z.string().min(1), yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type MonthlyInsuranceGetInput = z.infer<typeof monthlyInsuranceGetSchema>;
