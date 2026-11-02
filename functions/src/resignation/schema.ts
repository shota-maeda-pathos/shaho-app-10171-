import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';

const id = z.string().min(1).regex(/^[^/]+$/);
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** 退職手続きを始める（従業員を選んだところ）。台帳はまだ変えない */
export const ResignationStartSchema = z.object({ companyId: id, employeeId: id });
export const ResignationGetSchema = z.object({ companyId: id, procedureId: id });

const EntryFields = {
  resignationDate: calendarDate,
  reason: z.enum(['resignation', 'death']).default('resignation'),
  note: z.string().trim().max(200).default(''),
};

/** 退職日から決まることの試算（保存しない） */
export const ResignationPreviewSchema = z.object({ companyId: id, procedureId: id, ...EntryFields });
/** 最後の給与の支給月。null は「退職後に支給する給与はない（最後の給与は支給済み）」 */
const lastPayMonth = yearMonth.nullable();
/** 最後の保険料の集め方の試算（保存しない） */
export const SettlementPreviewSchema = z.object({ companyId: id, procedureId: id, lastPayMonth });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };

export const EntrySchema = z.object({ ...Base, ...EntryFields });
export const SettlementSchema = z.object({ ...Base, lastPayMonth });
export const AccountSchema = z.object({ ...Base, accessUntil: calendarDate });
export const LossFilingSchema = z.object({
  ...Base,
  cardsReturned: z.number().int().min(0).max(20),
  cardsUnreturnable: z.number().int().min(0).max(20),
});
export const CompleteSchema = z.object({ ...Base });
/** 同月得喪の厚生年金保険料の還付の通知が届いた（届いた日） */
export const PensionRefundSchema = z.object({ ...Base, noticeDate: calendarDate });

export type EntryInput = z.output<typeof EntrySchema>;
