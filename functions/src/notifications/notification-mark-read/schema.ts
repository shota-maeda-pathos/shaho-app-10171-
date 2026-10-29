import { z } from 'zod';

export const NotificationMarkReadSchema = z.object({
  companyId: z.string().min(1),
  notificationIds: z.array(z.string().min(1)).min(1).max(50),
});

export type NotificationMarkReadInput = z.infer<typeof NotificationMarkReadSchema>;
