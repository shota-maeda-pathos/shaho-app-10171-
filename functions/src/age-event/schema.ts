import { z } from 'zod';

const id = z.string().min(1).regex(/^[^/]+$/);

/** 年齢到達の手続きを始める（ホームのやること・手続きを始めるから） */
export const AgeStartSchema = z.object({ companyId: id, employeeId: id, kind: z.enum(['pension70', 'health75']) });
export const AgeGetSchema = z.object({ companyId: id, procedureId: id });
/** 70歳：入れかけの報酬月額で届出の要否を判定する（保存しない） */
export const AgePreviewSchema = z.object({ companyId: id, procedureId: id, remuneration: z.number().int().min(0).max(99_999_999).nullable() });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const AgeCheckSchema = z.object({
  ...Base,
  remuneration: z.number().int().min(0).max(99_999_999).nullish().transform(v => v ?? null),
  inKind: z.number().int().min(0).max(99_999_999).default(0),
  cardsReturned: z.number().int().min(0).max(20).default(0),
  cardsUnreturnable: z.number().int().min(0).max(20).default(0),
});
export const AgeFilingSchema = z.object({ ...Base });
export const AgeCompleteSchema = z.object({ ...Base });

export type AgeCheckInput = z.output<typeof AgeCheckSchema>;
