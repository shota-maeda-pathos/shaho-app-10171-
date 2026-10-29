import { z } from 'zod';

export const FilingMockSubmitSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  filingId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

export type FilingMockSubmitInput = z.infer<typeof FilingMockSubmitSchema>;
