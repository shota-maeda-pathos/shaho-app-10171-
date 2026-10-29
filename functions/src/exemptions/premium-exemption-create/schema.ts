import { z } from 'zod';

export const premiumExemptionCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  exemptionType: z.enum(['childcare', 'maternity', 'childcare_reduced']),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '年月をYYYY-MM形式で入力してください'),
  endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '年月をYYYY-MM形式で入力してください').optional(),
  approvedDate: z.string().date().optional(),
  isMonthlyExempted: z.boolean().default(true),
  isBonusExempted: z.boolean().default(false),
  leaveId: z.string().optional(),
  notes: z.string().max(500).optional(),
}).refine((value) => !value.endMonth || value.endMonth >= value.startMonth, { message: '終了月は開始月以降にしてください', path: ['endMonth'] })
  .refine(value => !value.isBonusExempted || value.exemptionType !== 'childcare_reduced', { message: '育児短時間勤務には賞与免除を設定できません', path: ['isBonusExempted'] });

export type PremiumExemptionCreateInput = z.input<typeof premiumExemptionCreateSchema>;
