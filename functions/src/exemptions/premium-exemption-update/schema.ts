import { z } from 'zod';
const id = z.string().min(1).max(128).regex(/^[^/]+$/);
export const premiumExemptionUpdateSchema = z.object({
  companyId: id, employeeId: id, exemptionId: id,
  expectedVersion: z.number().int().min(1), requestId: z.string().uuid(),
  endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
  approvedDate: z.string().date().optional(),
  isBonusExempted: z.boolean().optional(),
});
export type PremiumExemptionUpdateInput = z.infer<typeof premiumExemptionUpdateSchema>;
