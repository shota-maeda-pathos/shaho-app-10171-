import { z } from 'zod';
import { EmploymentConditionFields, EmploymentTypeSchema } from '../../types/catalog-schemas';

export const EmploymentCreateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employmentType: EmploymentTypeSchema,
  weeklyHours: z.number().min(0).max(168),
  monthlyDays: z.number().min(0).max(31),
  baseSalary: z.number().int().min(0),
  socialInsuranceEnrolled: z.boolean(),
  longTermCareEnrolled: z.boolean(),
  note: z.string().optional(),
  ...EmploymentConditionFields,
});

export type EmploymentCreateInput = z.infer<typeof EmploymentCreateSchema>;
