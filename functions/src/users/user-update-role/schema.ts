import { z } from 'zod';

export const UserUpdateRoleSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().min(1),
  roles: z
    .array(z.enum(['admin', 'approver', 'operator', 'viewer', 'employee']))
    .min(1),
  officeIds: z.array(z.string().min(1)).optional(),
});

export type UserUpdateRoleInput = z.infer<typeof UserUpdateRoleSchema>;
