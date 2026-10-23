import { z } from 'zod';

export const DepartmentListSchema = z.object({
  companyId: z.string(),
  officeId: z.string().optional(),
  includeInactive: z.boolean().optional(),
});

export type DepartmentListInput = z.infer<typeof DepartmentListSchema>;
