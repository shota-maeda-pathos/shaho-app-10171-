import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';
import { ContractFields } from '../onboarding/schema';

const id = z.string().min(1).regex(/^[^/]+$/);

/** 雇用条件の変更を始める（従業員詳細・有期契約の満了の知らせから） */
export const ChangeStartSchema = z.object({ companyId: id, employeeId: id, reason: z.enum(['change', 'renewal']).default('change') });
export const ChangeGetSchema = z.object({ companyId: id, procedureId: id });

/** 新しい雇用条件。入社の雇用条件と同じ項目に、新しい条件を使い始める日を足す */
const EntryFields = { ...ContractFields, effectiveDate: calendarDate, note: z.string().trim().max(200).default('') };
export const ChangePreviewSchema = z.object({ companyId: id, procedureId: id, ...EntryFields });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const ChangeEntrySchema = z.object({ ...Base, ...EntryFields });
export const ChangeFilingSchema = z.object({ ...Base });
export const ChangeCompleteSchema = z.object({ ...Base });

export type ChangeEntryInput = z.output<typeof ChangeEntrySchema>;
export type ChangePreviewInput = z.output<typeof ChangePreviewSchema>;
