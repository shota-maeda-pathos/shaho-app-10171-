import { z } from 'zod';

export const ApprovalRequestApproveSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  requestId: z.string().min(1),
  comment: z.string().optional(),
});

export type ApprovalRequestApproveInput = z.infer<typeof ApprovalRequestApproveSchema>;
