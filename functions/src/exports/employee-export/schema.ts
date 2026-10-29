import { z } from 'zod';

export const employeeExportSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type EmployeeExportInput = z.infer<typeof employeeExportSchema>;
