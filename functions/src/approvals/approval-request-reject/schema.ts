import { z } from 'zod';

export const ApprovalRequestRejectSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  requestId: z.string().min(1),
  comment: z.string().min(1),
});

export type ApprovalRequestRejectInput = z.infer<typeof ApprovalRequestRejectSchema>;
