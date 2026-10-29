import { z } from 'zod';

export const FilingListSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  employeeId: z.string().optional(),
  workflowStatus: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
  submissionStatus: z.enum(['notSubmitted', 'submitted', 'accepted', 'returned']).optional(),
  filingType: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type FilingListInput = z.infer<typeof FilingListSchema>;
