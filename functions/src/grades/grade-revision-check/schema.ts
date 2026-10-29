import { z } from 'zod';

export const GradeRevisionCheckSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  changeMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export type GradeRevisionCheckInput = z.infer<typeof GradeRevisionCheckSchema>;
