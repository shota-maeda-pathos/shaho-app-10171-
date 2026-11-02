import { z } from 'zod';

export const UserInviteSchema = z.object({
  companyId: z.string().min(1),
  email: z.string().email(),
  /** 招待する人の氏名（登録の画面の名前の欄に入れておく） */
  displayName: z.string().trim().min(1).max(50),
  roles: z
    .array(z.enum(['admin', 'approver', 'operator', 'viewer', 'employee']))
    .min(1),
  officeIds: z.array(z.string().min(1)).optional(),
  employeeId: z.string().min(1).optional(),
});

export type UserInviteInput = z.infer<typeof UserInviteSchema>;
