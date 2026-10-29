import { z } from 'zod';

export const FilingAutoGenerateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  filingType: z.enum([
    'acquisitionNotification',
    'lossNotification',
    'remunerationMonthlyChange',
    'remunerationMonthlyAlgorithm',
    'dependentChange',
    'bonusPayment',
  ]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

export type FilingAutoGenerateInput = z.infer<typeof FilingAutoGenerateSchema>;
