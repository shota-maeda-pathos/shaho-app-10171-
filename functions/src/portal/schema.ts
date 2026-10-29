import { z } from 'zod';
const id = z.string().min(1).max(128).regex(/^[^/]+$/);
export const portalOverviewSchema = z.object({ companyId: id, limit: z.number().int().min(1).max(50).default(12), lastDocId: id.optional() }).strict();
export const portalPayslipGetSchema = z.object({ companyId: id, yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
export type PortalOverviewInput = z.infer<typeof portalOverviewSchema>;
export type PortalPayslipGetInput = z.infer<typeof portalPayslipGetSchema>;
