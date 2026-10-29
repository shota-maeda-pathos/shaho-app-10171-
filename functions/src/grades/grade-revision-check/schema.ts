import { z } from 'zod';

export const GradeRevisionCheckSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  changeMonth: z.string().regex(/^\d{4}-\d{2}$/),
  /** occasional：随時改定（2等級差）、leaveEnd：産休・育休終了時改定（1等級差・復帰月が起点） */
  revisionType: z.enum(['occasional', 'leaveEnd']).optional(),
});

export type GradeRevisionCheckInput = z.infer<typeof GradeRevisionCheckSchema>;
