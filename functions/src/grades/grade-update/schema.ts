import { z } from 'zod';

export const GradeUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  gradeId: z.string(),
  expectedVersion: z.number().int(),
  healthGradeNumber: z.number().int().min(1).max(50).optional(),
  healthStandardRemuneration: z.number().int().min(0).optional(),
  pensionGradeNumber: z.number().int().min(1).max(32).optional(),
  pensionStandardRemuneration: z.number().int().min(0).optional(),
  determinationType: z
    .enum(['regular', 'occasional', 'initial', 'specific'])
    .optional(),
  reason: z.string().optional(),
});

export type GradeUpdateInput = z.infer<typeof GradeUpdateSchema>;
