import { z } from 'zod';

export const ApprovalRequestListSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  requestType: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type ApprovalRequestListInput = z.infer<typeof ApprovalRequestListSchema>;
