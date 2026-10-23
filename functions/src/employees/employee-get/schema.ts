import { z } from 'zod';

export const EmployeeGetSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
});

export type EmployeeGetInput = z.infer<typeof EmployeeGetSchema>;
