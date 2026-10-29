import { z } from 'zod';

export const DashboardAnalyticsSchema = z.object({
  companyId: z.string().min(1),
  months: z.number().int().min(1).max(12).default(6),
});

export type DashboardAnalyticsInput = z.infer<typeof DashboardAnalyticsSchema>;
