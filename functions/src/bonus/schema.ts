import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 賞与は事業所×支給月が1つの単位 */
export const BonusRunSchema = z.object({ companyId: id, officeId: id, payMonth: month }).strict();
export type BonusRunInput = z.infer<typeof BonusRunSchema>;

export const BonusHoldSchema = BonusRunSchema.extend({ employeeId: id, reason: z.string().trim().min(1).max(200).nullable() }).strict();
export type BonusHoldInput = z.infer<typeof BonusHoldSchema>;

export const BonusImportSchema = BonusRunSchema.extend({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean() }).strict();
export type BonusImportInput = z.infer<typeof BonusImportSchema>;

const payment = z.object({
  date,
  cash: z.number().int().min(0).max(100_000_000),
  inKind: z.number().int().min(0).max(100_000_000),
}).strict();

/** 1人分の賞与（その月の支給をすべて）。payments が空なら登録を消す */
export const BonusEntrySchema = BonusRunSchema.extend({
  employeeId: id,
  payments: z.array(payment).max(10),
  expectedVersion: z.number().int().min(0),
}).strict();
export type BonusEntryInput = z.infer<typeof BonusEntrySchema>;

export const BONUS_ACTIONS = ['requestBonusApproval', 'approveBonus', 'calculate', 'requestPremiumApproval', 'approvePremium'] as const;
export type BonusAction = typeof BONUS_ACTIONS[number];

export const BonusJobStartSchema = BonusRunSchema.extend({
  action: z.enum(BONUS_ACTIONS),
  employeeIds: z.array(id).min(1).max(3000),
}).strict();
export type BonusJobStartInput = z.infer<typeof BonusJobStartSchema>;

export const BonusJobGetSchema = BonusRunSchema.extend({ jobId: id }).strict();
export type BonusJobGetInput = z.infer<typeof BonusJobGetSchema>;

export const BonusFilingUpdateSchema = BonusRunSchema.extend({
  filingId: id,
  expectedVersion: z.number().int().min(1),
  action: z.enum(['requestApproval', 'approve', 'reject', 'cancel', 'mockSubmit', 'paperSubmit']),
  comment: z.string().trim().max(500).optional(),
  /** 紙で提出した日 */
  date: date.optional(),
}).strict();
export type BonusFilingUpdateInput = z.infer<typeof BonusFilingUpdateSchema>;

export const BonusFilingGetSchema = BonusRunSchema.extend({ filingId: id }).strict();
export type BonusFilingGetInput = z.infer<typeof BonusFilingGetSchema>;

/** 支給予定月に賞与を払わなかった：不支給報告書を出した日を記録する（null で取り消し） */
export const BonusNonPaymentSchema = BonusRunSchema.extend({ reportedOn: date.nullable() }).strict();
export type BonusNonPaymentInput = z.infer<typeof BonusNonPaymentSchema>;

/** 賞与不支給報告書を作る。③ 支給予定月の変更（変更しない・変更する・今後は支給しない） */
export const BonusNonPaymentFilingSchema = BonusRunSchema.extend({
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('keep') }),
    z.object({ kind: z.literal('change'), months: z.array(z.number().int().min(1).max(12)).min(1).max(4) }),
    z.object({ kind: z.literal('remove') }),
  ]),
  /** 届書の提出日（記入する日付） */
  reportDate: date,
}).strict();
export type BonusNonPaymentFilingInput = z.infer<typeof BonusNonPaymentFilingSchema>;

/** 賞与のテスト用の架空の事業所（管理者だけ） */
export const BonusSampleSchema = z.object({ companyId: id, count: z.number().int().min(10).max(1000) }).strict();
