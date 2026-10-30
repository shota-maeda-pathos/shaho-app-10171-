import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const target = {
  companyId: z.string().min(1),
  source: z.enum(['employee', 'santei', 'bonus']),
  parentId: id,
  filingId: id,
};

export const ArchiveListSchema = z.object(target).strict();
export type ArchiveListInput = z.infer<typeof ArchiveListSchema>;

export const ArchiveGetSchema = z.object({ ...target, archiveId: id.optional() }).strict();
export type ArchiveGetInput = z.infer<typeof ArchiveGetSchema>;

/** ZIP に入れる届出の選び方。期間の基準は提出日か作成日 */
export const ArchiveBatchSchema = z.object({
  companyId: z.string().min(1),
  officeId: id.optional(),
  filingType: z.string().max(60).optional(),
  base: z.enum(['submitted', 'created']),
  from: date,
  to: date,
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();
export type ArchiveBatchInput = z.infer<typeof ArchiveBatchSchema>;
