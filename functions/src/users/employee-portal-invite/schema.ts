import { z } from 'zod';

export const EmployeePortalStatusSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
});

export const EmployeePortalInviteSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  email: z.string().trim().email(),
  /** 受け取られていない招待があっても、それを無効にして作り直す（メールの直し） */
  replace: z.boolean().default(false),
});

export type EmployeePortalStatusInput = z.infer<typeof EmployeePortalStatusSchema>;
export type EmployeePortalInviteInput = z.infer<typeof EmployeePortalInviteSchema>;
