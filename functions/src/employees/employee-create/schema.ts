import { z } from 'zod';

export const EmployeeCreateSchema = z.object({
  companyId: z.string(),
  employeeNumber: z.string().min(1).max(20),
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  lastNameKana: z.string().min(1),
  firstNameKana: z.string().min(1),
  birthDate: z.string().min(1).optional().default(''),
  gender: z.enum(['male', 'female']),
  officeId: z.string(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().min(1),
  requestId: z.string().uuid().optional(),
});

export type EmployeeCreateInput = z.output<typeof EmployeeCreateSchema>;
