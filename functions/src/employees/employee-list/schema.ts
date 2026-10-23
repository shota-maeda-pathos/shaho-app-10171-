import { z } from 'zod';

export const EmployeeListSchema = z.object({
  companyId: z.string(),
  officeId: z.string().optional(),
  departmentId: z.string().optional(),
  includeResigned: z.boolean().optional(),
  keyword: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type EmployeeListInput = z.output<typeof EmployeeListSchema>;
