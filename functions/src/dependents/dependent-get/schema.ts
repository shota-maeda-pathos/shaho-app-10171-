import { z } from 'zod';

export const DependentGetSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  dependentId: z.string(),
});

export type DependentGetInput = z.output<typeof DependentGetSchema>;
