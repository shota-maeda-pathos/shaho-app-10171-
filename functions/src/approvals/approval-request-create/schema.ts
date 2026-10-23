import { z } from 'zod';

export const ApprovalRequestCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  targetPath: z.string().min(1),
  targetVersion: z.number().int().min(1),
  requestType: z.enum([
    'salary',
    'bonus',
    'monthlyInsurance',
    'filing',
    'employment',
    'grade',
  ]),
  comment: z.string().optional(),
});

export type ApprovalRequestCreateInput = z.infer<typeof ApprovalRequestCreateSchema>;
