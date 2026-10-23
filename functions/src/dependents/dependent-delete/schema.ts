import { z } from 'zod';

export const DependentDeleteSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  dependentId: z.string(),
});

export type DependentDeleteInput = z.output<typeof DependentDeleteSchema>;
