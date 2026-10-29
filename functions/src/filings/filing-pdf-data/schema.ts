import { z } from 'zod';

export const FilingPdfDataSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  filingId: z.string().min(1),
});

export type FilingPdfDataInput = z.infer<typeof FilingPdfDataSchema>;
