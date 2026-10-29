import { z } from 'zod';

export const EmployeeOnboardSchema = z.object({
  companyId: z.string(),
  employeeNumber: z.string().min(1).max(20),
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  lastNameKana: z.string().min(1),
  firstNameKana: z.string().min(1),
  birthDate: z.string().optional().default(''),
  gender: z.enum(['male', 'female']),
  officeId: z.string(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().min(1),
  employmentType: z.enum(['regular', 'partTime', 'contract']),
  weeklyHours: z.number().min(0).max(168),
  monthlyDays: z.number().min(0).max(31),
  baseSalary: z.number().int().min(0),
  fixedAllowances: z.record(z.string(), z.number().int().min(0)).optional(),
  socialInsuranceEnrolled: z.boolean(),
  longTermCareEnrolled: z.boolean(),
});

export type EmployeeOnboardInput = z.infer<typeof EmployeeOnboardSchema>;
