import { z } from 'zod';

const safeId = z.string().min(1).regex(/^[^/]+$/);

/** 算定基礎届は事業所×年が1つの単位 */
export const SanteiRunSchema = z.object({
  companyId: safeId,
  officeId: safeId,
  year: z.number().int().min(2020).max(2100),
});
export type SanteiRunInput = z.infer<typeof SanteiRunSchema>;

export const SanteiHoldSchema = SanteiRunSchema.extend({
  employeeId: safeId,
  /** null で保留を解除 */
  reason: z.string().trim().min(1).max(200).nullable(),
});
export type SanteiHoldInput = z.infer<typeof SanteiHoldSchema>;

/** 支払基礎日数の基準を満たす月がない人の決め方（null で取り消し） */
export const SanteiDecisionSchema = SanteiRunSchema.extend({
  employeeIds: z.array(safeId).min(1).max(3000),
  decision: z.enum(['previous']).nullable(),
});
export type SanteiDecisionInput = z.infer<typeof SanteiDecisionSchema>;

export const SANTEI_ACTIONS = ['requestGradeApproval', 'approveGrade'] as const;
export type SanteiAction = typeof SANTEI_ACTIONS[number];

export const SanteiJobStartSchema = SanteiRunSchema.extend({
  action: z.enum(SANTEI_ACTIONS),
  employeeIds: z.array(safeId).min(1).max(3000),
});
export type SanteiJobStartInput = z.infer<typeof SanteiJobStartSchema>;

export const SanteiJobGetSchema = SanteiRunSchema.extend({ jobId: safeId });
export type SanteiJobGetInput = z.infer<typeof SanteiJobGetSchema>;

export const SanteiFilingCreateSchema = SanteiRunSchema;

export const SanteiFilingUpdateSchema = SanteiRunSchema.extend({
  filingId: safeId,
  expectedVersion: z.number().int().min(1),
  action: z.enum(['requestApproval', 'approve', 'reject', 'cancel', 'mockSubmit', 'paperSubmit']),
  comment: z.string().trim().max(500).optional(),
  /** 紙で提出した日 */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SanteiFilingUpdateInput = z.infer<typeof SanteiFilingUpdateSchema>;

export const SanteiFilingGetSchema = SanteiRunSchema.extend({ filingId: safeId });
export type SanteiFilingGetInput = z.infer<typeof SanteiFilingGetSchema>;

/** 算定のテスト用の架空の事業所（管理者だけ） */
export const SanteiSampleSchema = z.object({
  companyId: safeId,
  count: z.number().int().min(10).max(1000),
}).strict();
