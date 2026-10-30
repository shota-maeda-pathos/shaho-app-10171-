import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** どの届出か。parentId は従業員の届出なら従業員ID、算定基礎届・賞与支払届なら run のID */
const TargetShape = {
  source: z.enum(['employee', 'santei', 'bonus']),
  parentId: id,
  filingId: id,
};

export const FilingSubmissionGetSchema = z.object({ companyId: z.string().min(1), ...TargetShape });

export const FilingSubmissionActionSchema = z.object({
  companyId: z.string().min(1),
  ...TargetShape,
  expectedVersion: z.number().int(),
  action: z.enum(['mockSend', 'mockCancel', 'mockAdvance', 'mockReturn', 'paperSubmit', 'paperResult', 'reopen']),
  scenario: z.enum(['normal', 'timeout', 'serverError', 'validationError', 'outOfHours']).optional(),
  date: date.optional(),
  office: z.string().max(100).optional(),
  method: z.enum(['counter', 'mail']).optional(),
  result: z.enum(['accepted', 'returned']).optional(),
  note: z.string().max(500).optional(),
});

export type FilingTarget = { source: 'employee' | 'santei' | 'bonus'; parentId: string; filingId: string };
export type FilingSubmissionActionInput = z.infer<typeof FilingSubmissionActionSchema>;

const seconds = z.number().int().min(0).max(3600);
export const MockSettingsSchema = z.object({
  companyId: z.string().min(1),
  update: z.object({ auto: z.boolean(), receiveSeconds: seconds, processSeconds: seconds, completeSeconds: seconds }).optional(),
});
export type MockSettingsInput = z.infer<typeof MockSettingsSchema>;
