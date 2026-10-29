import { z } from 'zod';
const id = z.string().min(1).max(128).regex(/^[^/]+$/);
export const employeeHistoryListSchema = z.object({
  companyId: id, employeeId: id,
  collection: z.enum(['employments', 'grades', 'bonuses', 'salaries']),
  limit: z.number().int().min(1).max(100).default(20), lastDocId: id.optional(),
});
export type EmployeeHistoryListInput = z.infer<typeof employeeHistoryListSchema>;
