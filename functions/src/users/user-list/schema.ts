import { z } from 'zod';

export const UserListSchema = z.object({
  companyId: z.string().min(1),
});

export type UserListInput = z.infer<typeof UserListSchema>;
