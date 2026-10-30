import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FilingSearchSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  employeeId: z.string().regex(/^[^/]+$/).optional(),
  filingType: z.string().max(60).optional(),
  status: z.enum(['draft', 'rejected', 'pending', 'approved', 'sent', 'received', 'processing', 'completed', 'mockFailed', 'returned', 'cancelled']).optional(),
  paperStatus: z.enum(['none', 'submitted', 'accepted', 'returned']).optional(),
  /** open：未提出、overdue：期限超過、dueSoon：7日以内に期限 */
  view: z.enum(['all', 'open', 'overdue', 'dueSoon']).optional(),
  keyword: z.string().max(50).optional(),
  acceptanceNumber: z.string().max(40).optional(),
  period: z.object({
    base: z.enum(['created', 'submitted', 'deadline']),
    from: date.optional(),
    to: date.optional(),
  }).optional(),
  sort: z.enum(['deadline', 'updated']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export type FilingSearchInput = z.infer<typeof FilingSearchSchema>;

export const FilingIndexRebuildSchema = z.object({ companyId: z.string().min(1) });
