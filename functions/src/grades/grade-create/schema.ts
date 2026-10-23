import { z } from 'zod';

export const GradeCreateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/),
  healthGradeNumber: z.number().int().min(1).max(50),
  healthStandardRemuneration: z.number().int().min(0),
  pensionGradeNumber: z.number().int().min(1).max(32),
  pensionStandardRemuneration: z.number().int().min(0),
  determinationType: z.enum(['regular', 'occasional', 'initial', 'specific']),
  reason: z.string().optional(),
});

export type GradeCreateInput = z.infer<typeof GradeCreateSchema>;
