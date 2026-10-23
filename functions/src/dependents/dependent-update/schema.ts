import { z } from 'zod';

export const DependentUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  dependentId: z.string(),
  lastName: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastNameKana: z.string().min(1).optional(),
  firstNameKana: z.string().min(1).optional(),
  birthDate: z.string().datetime().optional(),
  gender: z.enum(['male', 'female']).optional(),
  relationship: z.string().min(1).optional(),
  isDisabled: z.boolean().optional(),
  income: z.number().int().min(0).optional(),
  coResident: z.boolean().optional(),
  qualificationDate: z.string().datetime().optional(),
  disqualificationDate: z.string().datetime().nullable().optional(),
});

export type DependentUpdateInput = z.output<typeof DependentUpdateSchema>;
