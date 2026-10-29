import { z } from 'zod';

export const dashboardStatsSchema = z.object({
  companyId: z.string().min(1),
});

export type DashboardStatsInput = z.infer<typeof dashboardStatsSchema>;
