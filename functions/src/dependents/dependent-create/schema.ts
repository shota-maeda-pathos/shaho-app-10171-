import { z } from 'zod';

export const DependentCreateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  lastNameKana: z.string().min(1),
  firstNameKana: z.string().min(1),
  birthDate: z.string().datetime(),
  gender: z.enum(['male', 'female']),
  relationship: z.string().min(1),
  isDisabled: z.boolean().optional(),
  income: z.number().int().min(0).optional(),
  coResident: z.boolean().optional(),
  qualificationDate: z.string().datetime(),
});

export type DependentCreateInput = z.output<typeof DependentCreateSchema>;
