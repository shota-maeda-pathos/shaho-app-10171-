import { z } from 'zod';

export const InsuranceRateListSchema = z.object({
  companyId: z.string(),
  insuranceType: z
    .enum(['health', 'pension', 'childSupport', 'childSupportPayment', 'longTermCare'])
    .optional(),
  insurerId: z.string().optional(),
  prefectureCode: z.string().optional(),
  currentOnly: z.boolean().optional(),
});

export type InsuranceRateListInput = z.infer<typeof InsuranceRateListSchema>;
