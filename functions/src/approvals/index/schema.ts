import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/);

/** どの承認か：従業員の下の承認申請、または算定基礎届・賞与支払届（run の届出） */
export const ApprovalTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request'), employeeId: id, requestId: id }),
  z.object({ kind: z.literal('runFiling'), source: z.enum(['santei', 'bonus']), parentId: id, filingId: id }),
]);
export type ApprovalTarget = z.infer<typeof ApprovalTargetSchema>;

export const ApprovalSearchSchema = z.object({
  companyId: z.string().min(1),
  view: z.enum(['pending', 'processed']),
  officeId: id.optional(),
  requestType: z.string().max(30).optional(),
  filingType: z.string().max(60).optional(),
  /** forMe：自分が承認できる、mine：自分が依頼した、overdue：期限超過、stale：止まっている */
  only: z.enum(['forMe', 'mine', 'overdue', 'stale']).optional(),
  keyword: z.string().max(50).optional(),
  sort: z.enum(['deadline', 'requestedAt', 'office']).optional(),
  limit: z.number().int().min(1).max(3000).optional(),
});
export type ApprovalSearchInput = z.infer<typeof ApprovalSearchSchema>;

export const ApprovalDetailSchema = z.object({ companyId: z.string().min(1), target: ApprovalTargetSchema });
export type ApprovalDetailInput = z.infer<typeof ApprovalDetailSchema>;

export const ApprovalBulkSchema = z.object({
  companyId: z.string().min(1),
  items: z.array(ApprovalTargetSchema).min(1).max(200),
  comment: z.string().trim().max(500).optional(),
});
export type ApprovalBulkInput = z.infer<typeof ApprovalBulkSchema>;

export const ApprovalCancelSchema = z.object({
  companyId: z.string().min(1),
  target: ApprovalTargetSchema,
  reason: z.string().max(500),
});
export type ApprovalCancelInput = z.infer<typeof ApprovalCancelSchema>;

export const ApprovalSettingsSchema = z.object({
  companyId: z.string().min(1),
  update: z.object({ staleDays: z.number().int().min(1).max(60) }).optional(),
});
export type ApprovalSettingsInput = z.infer<typeof ApprovalSettingsSchema>;

export const ApprovalCompanySchema = z.object({ companyId: z.string().min(1) });
