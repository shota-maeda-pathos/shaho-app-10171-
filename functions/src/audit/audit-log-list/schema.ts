import { z } from 'zod';

export const auditLogListSchema = z.object({
  companyId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
  action: z.string().optional(),
  actorUid: z.string().optional(),
});

export type AuditLogListInput = z.infer<typeof auditLogListSchema>;
