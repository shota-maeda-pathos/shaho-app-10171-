import { z } from 'zod';

export const DependentListSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type DependentListInput = z.output<typeof DependentListSchema>;
