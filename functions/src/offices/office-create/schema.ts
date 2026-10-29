import { z } from 'zod';

export const OfficeCreateSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).max(100),
  officeNumber: z.string().max(20).optional(),
  prefectureCode: z.string().length(2).optional(),
  insurerId: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  closingDay: z.number().int().min(1).max(31).optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  paymentMonth: z.enum(['current', 'next']).optional(),
  deductionMethod: z.enum(['current', 'previous']).optional(),
  roundingRule: z.enum(['truncate', 'round', 'ceil']).optional(),
});

export type OfficeCreateInput = z.infer<typeof OfficeCreateSchema>;
