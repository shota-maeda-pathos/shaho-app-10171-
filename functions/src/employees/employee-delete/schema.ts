import { z } from 'zod';

export const EmployeeDeleteSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  expectedVersion: z.number().int(),
});

export type EmployeeDeleteInput = z.infer<typeof EmployeeDeleteSchema>;
