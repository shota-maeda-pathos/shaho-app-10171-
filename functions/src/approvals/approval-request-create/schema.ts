import { z } from 'zod';

export const ApprovalRequestCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  targetPath: z.string().min(1),
  targetVersion: z.number().int().min(0),
  requestType: z.enum([
    'salary',
    'bonus',
    'monthlyInsurance',
    'bonusInsurance',
    'filing',
    'employment',
    'grade',
  ]),
  comment: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ApprovalRequestCreateInput = z.infer<typeof ApprovalRequestCreateSchema>;
