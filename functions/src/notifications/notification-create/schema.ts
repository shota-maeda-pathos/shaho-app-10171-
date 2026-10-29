import { z } from 'zod';

export const NotificationCreateSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  category: z.enum(['info', 'warning', 'action', 'system']).default('info'),
  targetType: z.enum(['all', 'office', 'employee']).default('all'),
  targetId: z.string().min(1).optional(),
});

export type NotificationCreateInput = z.infer<typeof NotificationCreateSchema>;
