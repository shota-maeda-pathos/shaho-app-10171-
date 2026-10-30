import { z } from 'zod';

export const FilingCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  filingType: z.enum([
    'acquisitionNotification',
    'lossNotification',
    'remunerationMonthlyChange',
    'remunerationMonthlyAlgorithm',
    'dependentChange',
    'maternityLeaveStart',
    'childcareLeaveStart',
    'maternityLeaveChange',
    'childcareLeaveEnd',
    'maternityLeaveEndChange',
    'childcareLeaveEndChange',
    'bonusPayment',
  ]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  formData: z.record(z.string(), z.unknown()),
});

export type FilingCreateInput = z.infer<typeof FilingCreateSchema>;
