import { z } from 'zod';

export const NotificationListSchema = z.object({
  companyId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  lastDocId: z.string().optional(),
});

export type NotificationListInput = z.infer<typeof NotificationListSchema>;
