import { z } from 'zod';

export const EmployeeResignSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  expectedVersion: z.number().int(),
  resignationDate: z.string().datetime(),
  reason: z.string().optional(),
});

export type EmployeeResignInput = z.infer<typeof EmployeeResignSchema>;
