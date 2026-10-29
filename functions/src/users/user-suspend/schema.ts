import { z } from 'zod';

export const UserSuspendSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().min(1),
});

export type UserSuspendInput = z.infer<typeof UserSuspendSchema>;

export const UserDisableLoginSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().min(1),
});

export type UserDisableLoginInput = z.infer<typeof UserDisableLoginSchema>;
