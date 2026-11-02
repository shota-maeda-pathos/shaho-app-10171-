import { z } from 'zod';
import { calendarDate } from '../../types/catalog-schemas';

const id = z.string().regex(/^[^/]+$/);

export const EmployeeStatusGetSchema = z.object({ companyId: z.string().min(1), employeeId: id }).strict();
export type EmployeeStatusGetInput = z.infer<typeof EmployeeStatusGetSchema>;

export const AbsenceSaveSchema = z.object({
  companyId: z.string().min(1),
  employeeId: id,
  action: z.enum(['save', 'delete']),
  /** 直す・消すときの記録のID（新しく足すときは省く） */
  absenceId: id.optional(),
  reason: z.enum(['injury', 'personal']).optional(),
  startDate: calendarDate.optional(),
  endDate: calendarDate.nullable().optional(),
  note: z.string().max(200).optional(),
}).strict();
export type AbsenceSaveInput = z.infer<typeof AbsenceSaveSchema>;
