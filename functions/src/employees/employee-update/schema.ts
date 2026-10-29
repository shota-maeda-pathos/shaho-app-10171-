import { z } from 'zod';
import { EmployeeProfileFields } from '../../types/catalog-schemas';

export const EmployeeUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  expectedVersion: z.number().int(),
  lastName: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastNameKana: z.string().min(1).optional(),
  firstNameKana: z.string().min(1).optional(),
  birthDate: z.string().datetime().optional(),
  gender: z.enum(['male', 'female']).optional(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().datetime().optional(),
  ...EmployeeProfileFields,
});

export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;
