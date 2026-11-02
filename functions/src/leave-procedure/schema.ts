import { z } from 'zod';
import { calendarDate } from '../types/catalog-schemas';

const id = z.string().min(1).regex(/^[^/]+$/);
const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default('');

/** 産休・育休の手続きを始める。産休の手続きから育休を続けて始めると、子と期間を引き継ぐ */
export const LeaveStartSchema = z.object({
  companyId: id,
  employeeId: id,
  kind: z.enum(['maternity', 'childcare']),
  sourceProcedureId: id.nullish().transform(v => v ?? null),
  /** 本人からの申請（ポータル）から始めたときの申請のID。中身を最初の入力に引き継ぐ */
  sourceRequestId: id.nullish().transform(v => v ?? null),
});
export const LeaveGetSchema = z.object({ companyId: id, procedureId: id });

/** 期間の内容。入れかけでも判定できるよう、日付は空を許す（保存のときに確かめる） */
const PlanFields = {
  expectedBirthDate: optionalDate,
  actualBirthDate: optionalDate,
  multiple: z.boolean().default(false),
  childLastName: z.string().trim().max(50).default(''),
  childFirstName: z.string().trim().max(50).default(''),
  childBirthDate: optionalDate,
  bornByEmployee: z.boolean().default(false),
  startDate: optionalDate,
  endDate: optionalDate,
};
export const PreviewSchema = z.object({
  companyId: id, procedureId: id, ...PlanFields,
  event: z.object({ type: z.enum(['birth', 'extend', 'end']), date: calendarDate }).nullish().transform(v => v ?? null),
});

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const PlanSchema = z.object({ ...Base, ...PlanFields });
export const FilingSchema = z.object({ ...Base });
export const EventSchema = z.object({ ...Base, type: z.enum(['birth', 'extend', 'end']), date: calendarDate });
export const CompleteSchema = z.object({ ...Base });

export type PlanInput = z.output<typeof PlanSchema>;
export type PreviewInput = z.output<typeof PreviewSchema>;
