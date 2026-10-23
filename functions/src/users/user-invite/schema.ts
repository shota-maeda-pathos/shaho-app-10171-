import { z } from 'zod';

export const UserInviteSchema = z.object({
  companyId: z.string().min(1),
  email: z.string().email(),
  roles: z
    .array(z.enum(['admin', 'approver', 'operator', 'viewer', 'employee']))
    .min(1),
  officeIds: z.array(z.string().min(1)).optional(),
  employeeId: z.string().min(1).optional(),
});

export type UserInviteInput = z.infer<typeof UserInviteSchema>;
