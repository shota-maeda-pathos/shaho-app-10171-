import { z } from 'zod';

export const FilingRecordResultSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  filingId: z.string(),
  expectedVersion: z.number().int(),
  result: z.enum(['accepted', 'returned']),
  note: z.string().optional(),
});

export type FilingRecordResultInput = z.infer<typeof FilingRecordResultSchema>;
