import { z } from 'zod';

export const leaveListSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().optional(),
  leaveType: z.enum(['maternity', 'childcare', 'nursing']).optional(),
  status: z.enum(['planned', 'active', 'ended']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type LeaveListInput = z.infer<typeof leaveListSchema>;
