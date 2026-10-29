import { z } from 'zod';

export const SalaryUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  salaryId: z.string(),
  expectedVersion: z.number().int(),
  paymentBasisDays: z.number().int().min(0).max(31).optional(),
  baseSalary: z.number().int().min(0).optional(),
  fixedAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  variableAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  isConfirmed: z.boolean().optional(),
});

export type SalaryUpdateInput = z.infer<typeof SalaryUpdateSchema>;
