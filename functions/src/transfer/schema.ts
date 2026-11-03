import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';

const id = z.string().min(1).regex(/^[^/]+$/);

export const TransferStartSchema = z.object({ companyId: id, employeeId: id });
export const TransferGetSchema = z.object({ companyId: id, procedureId: id });
export const TransferPreviewSchema = z.object({ companyId: id, procedureId: id, toOfficeId: id, transferDate: calendarDate });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const TransferEntrySchema = z.object({ ...Base, toOfficeId: id, transferDate: calendarDate, reason: z.string().trim().max(200).default('') });
export const TransferApplySchema = z.object({ ...Base });
/** skipPremiumCheck：異動日の前の月の保険料が元の事業所にない人（保険料の対象でない など）を、そのまま完了にする */
export const TransferCompleteSchema = z.object({ ...Base, skipPremiumCheck: z.boolean().default(false) });
