import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';
import { RELATIONSHIPS } from './rules';

const id = z.string().min(1).regex(/^[^/]+$/);
const kana = z.string().trim().min(1).max(50).regex(/^[ァ-ヶー\s　]+$/, 'フリガナはカタカナで入力してください');

/** 扶養の手続きを始める。入社の手続きから始めると、本人が申し出た家族を引き継ぐ */
export const DependentChangeStartSchema = z.object({
  companyId: id,
  employeeId: id,
  sourceProcedureId: id.nullish().transform(v => v ?? null),
  /** 本人からの申請（ポータル）から始めたときの申請のID。中身を最初の入力に引き継ぐ */
  sourceRequestId: id.nullish().transform(v => v ?? null),
});
export const DependentChangeGetSchema = z.object({ companyId: id, procedureId: id });

export const ItemSchema = z.object({
  kind: z.enum(['add', 'remove', 'change']),
  dependentId: id.nullable().default(null),
  eventDate: calendarDate,
  lastName: z.string().trim().min(1).max(50),
  firstName: z.string().trim().min(1).max(50),
  lastNameKana: kana,
  firstNameKana: kana,
  birthDate: calendarDate,
  gender: z.enum(['male', 'female']),
  relationship: z.enum(RELATIONSHIPS),
  income: z.number().int().min(0).max(100_000_000).default(0),
  coResident: z.boolean().default(true),
  occupation: z.string().trim().max(50).default(''),
  isDisabled: z.boolean().default(false),
  reason: z.string().trim().max(200).default(''),
  exceptionReason: z.string().trim().max(500).default(''),
});

/** 入力中の内容の判定（保存しない）。入れかけの内容でも判定できるよう、判定に使う項目だけ受ける */
/** 日付の入力欄は打ち間違いの途中で null を送るので、null も空として受ける */
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).nullish().transform(v => v ?? '');
export const PreviewSchema = z.object({
  companyId: id, procedureId: id,
  items: z.array(z.object({
    kind: z.enum(['add', 'remove', 'change']), eventDate: date, birthDate: date, relationship: z.string().max(20).default('other'),
    income: z.number().int().min(0).max(100_000_000).default(0), coResident: z.boolean().default(true),
    isDisabled: z.boolean().default(false), reason: z.string().max(200).default(''),
  })).max(20),
});

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const ChangeSchema = z.object({ ...Base, items: z.array(ItemSchema).min(1).max(20) });
export const FilingSchema = z.object({ ...Base });
export const CompleteSchema = z.object({ ...Base });

export type ItemInput = z.output<typeof ItemSchema>;
export type PreviewItem = z.output<typeof PreviewSchema>['items'][number];
