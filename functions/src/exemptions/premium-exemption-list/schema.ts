import { z } from 'zod';

export const premiumExemptionListSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().optional(),
  exemptionType: z.enum(['childcare', 'maternity', 'childcare_reduced']).optional(),
  status: z.enum(['active', 'ended']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type PremiumExemptionListInput = z.infer<typeof premiumExemptionListSchema>;
