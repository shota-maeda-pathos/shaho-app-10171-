import { z } from 'zod';
import { OfficeExtraFields, RoundingRuleSchema } from '../../types/catalog-schemas';

export const OfficeUpdateSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  officeNumber: z.string().max(20).optional(),
  prefectureCode: z.string().length(2).optional(),
  insurerId: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  closingDay: z.number().int().min(1).max(31).optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  paymentMonth: z.enum(['current', 'next']).optional(),
  deductionMethod: z.enum(['current', 'previous']).optional(),
  roundingRule: RoundingRuleSchema.optional(),
  ...OfficeExtraFields,
  expectedVersion: z.number().int().min(1),
});

export type OfficeUpdateInput = z.infer<typeof OfficeUpdateSchema>;
