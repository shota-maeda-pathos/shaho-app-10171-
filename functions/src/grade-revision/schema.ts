import { z } from 'zod';

const id = z.string().min(1).regex(/^[^/]+$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default('');

/**
 * 随時改定・終了時改定の手続きを始める。
 * 毎月の処理の知らせからは変動月を、産休・育休の手続きからは休業を引き継ぐ
 */
export const RevisionStartSchema = z.object({
  companyId: id,
  employeeId: id,
  kind: z.enum(['occasional', 'maternityEnd', 'childcareEnd']).default('occasional'),
  startMonth: month.nullish().transform(v => v ?? null),
  sourceProcedureId: id.nullish().transform(v => v ?? null),
});
export const RevisionGetSchema = z.object({ companyId: id, procedureId: id });

/** 変動の内容。入れかけでも判定できるよう、空を許す（保存のときに確かめる） */
const ChangeFields = {
  startMonth: z.string().regex(/^(\d{4}-\d{2})?$/).default(''),
  manualDirection: z.enum(['up', 'down']).nullish().transform(v => v ?? null),
  previousRemuneration: z.number().int().min(0).max(99_999_999).nullish().transform(v => v ?? null),
  note: z.string().trim().max(200).default(''),
  // 終了時改定
  endDate: optionalDate,
  childName: z.string().trim().max(100).default(''),
  childBirthDate: optionalDate,
  nextLeaveFromNextDay: z.boolean().default(false),
  applied: z.boolean().default(false),
  appliedDate: optionalDate,
};
export const RevisionPreviewSchema = z.object({ companyId: id, procedureId: id, ...ChangeFields });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const ChangeSchema = z.object({ ...Base, ...ChangeFields });
/** revise：この判定で改定する／close：対象外として手続きを終える */
export const DecideSchema = z.object({ ...Base, decision: z.enum(['revise', 'close']) });
export const RevisionFilingSchema = z.object({ ...Base });
export const RevisionCompleteSchema = z.object({ ...Base });

export type ChangeInput = z.output<typeof ChangeSchema>;
export type RevisionPreviewInput = z.output<typeof RevisionPreviewSchema>;
