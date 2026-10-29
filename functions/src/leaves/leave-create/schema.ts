import { z } from 'zod';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '有効な日付を入力してください');

export const leaveCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  leaveType: z.enum(['maternity', 'childcare', 'nursing']),
  expectedStartDate: calendarDate,
  expectedEndDate: calendarDate,
  actualStartDate: calendarDate.optional(),
  notes: z.string().max(500).optional(),
}).refine((value) => value.expectedEndDate >= value.expectedStartDate, { message: '終了予定日は開始予定日以降にしてください', path: ['expectedEndDate'] });

export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;
