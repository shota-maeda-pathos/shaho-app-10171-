import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 期間（東京の日付）・操作者・種類で絞り込む */
export const auditLogFilterSchema = z.object({
  companyId: z.string().min(1),
  from: date.optional(),
  to: date.optional(),
  actorUid: z.string().optional(),
  /** entity（例：employee・auth・employeeMyNumber）か、entity.action（例：auth.login） */
  kind: z.string().max(80).optional(),
});

export const auditLogListSchema = auditLogFilterSchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;
export type AuditLogListInput = z.infer<typeof auditLogListSchema>;
