import { z } from 'zod';
const id = z.string().min(1).max(128).regex(/^[^/]+$/);
export const leaveUpdateSchema = z.object({
  companyId: id, employeeId: id, leaveId: id,
  expectedVersion: z.number().int().min(1), requestId: z.string().uuid(),
  action: z.enum(['start', 'end']), actualDate: z.string().date(),
});
export type LeaveUpdateInput = z.infer<typeof leaveUpdateSchema>;
