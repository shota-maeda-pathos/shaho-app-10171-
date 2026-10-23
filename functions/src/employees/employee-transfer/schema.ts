import { z } from 'zod';

export const EmployeeTransferSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  expectedVersion: z.number().int(),
  newOfficeId: z.string().min(1),
  transferDate: z.string().datetime(),
  reason: z.string().optional(),
});

export type EmployeeTransferInput = z.infer<typeof EmployeeTransferSchema>;
