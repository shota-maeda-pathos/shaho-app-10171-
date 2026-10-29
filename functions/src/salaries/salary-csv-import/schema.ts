import { z } from 'zod';

export const SalaryCsvImportSchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  csvRows: z.array(z.object({
    employeeNumber: z.string().min(1),
    paymentBasisDays: z.number().int().min(0).max(31),
    baseSalary: z.number().int().min(0),
    fixedAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
    variableAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  })).min(1).max(500),
});

export type SalaryCsvImportInput = z.infer<typeof SalaryCsvImportSchema>;
