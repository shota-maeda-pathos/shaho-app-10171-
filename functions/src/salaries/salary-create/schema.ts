import { z } from 'zod';
import { SalaryExtraFields } from '../../types/catalog-schemas';

export const SalaryCreateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  paymentBasisDays: z.number().int().min(0).max(31),
  baseSalary: z.number().int().min(0),
  fixedAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  variableAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  ...SalaryExtraFields,
});

export type SalaryCreateInput = z.infer<typeof SalaryCreateSchema>;
