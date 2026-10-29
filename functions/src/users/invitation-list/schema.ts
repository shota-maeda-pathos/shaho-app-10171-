import { z } from 'zod';

export const InvitationListSchema = z.object({
  companyId: z.string(),
  status: z.enum(['pending', 'accepted', 'expired', 'all']).optional().default('all'),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export type InvitationListInput = z.infer<typeof InvitationListSchema>;
