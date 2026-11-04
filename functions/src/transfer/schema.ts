import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';

const id = z.string().min(1).regex(/^[^/]+$/);

export const TransferStartSchema = z.object({ companyId: id, employeeId: id });
export const TransferGetSchema = z.object({ companyId: id, procedureId: id });
/** 異動日現在の報酬月額（通貨・現物）。別の適用事業所への異動なら、異動先で資格取得時決定に使う */
const remuneration = { remunerationCurrency: z.number().int().min(0).max(100_000_000).optional(), remunerationInKind: z.number().int().min(0).max(100_000_000).default(0) };
export const TransferPreviewSchema = z.object({ companyId: id, procedureId: id, toOfficeId: id, transferDate: calendarDate, ...remuneration });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const TransferEntrySchema = z.object({ ...Base, toOfficeId: id, transferDate: calendarDate, reason: z.string().trim().max(200).default(''), ...remuneration });
export const TransferApplySchema = z.object({ ...Base });
/** skipPremiumCheck：異動日の前の月の保険料が元の事業所にない人（保険料の対象でない など）を、そのまま完了にする */
export const TransferCompleteSchema = z.object({ ...Base, skipPremiumCheck: z.boolean().default(false) });
