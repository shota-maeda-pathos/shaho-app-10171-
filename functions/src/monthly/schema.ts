import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** 事業所と給与の支給月 */
export const RunSchema = z.object({ companyId: id, officeId: id, payMonth: month }).strict();
export type RunInput = z.infer<typeof RunSchema>;

export const HoldSchema = RunSchema.extend({ employeeId: id, reason: z.string().trim().min(1).max(200).nullable() }).strict();
export type HoldInput = z.infer<typeof HoldSchema>;

export const ImportSchema = RunSchema.extend({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean() }).strict();
export type ImportInput = z.infer<typeof ImportSchema>;

export const NoPaySchema = RunSchema.extend({ employeeId: id, reason: z.string().trim().min(1).max(200) }).strict();
export type NoPayInput = z.infer<typeof NoPaySchema>;

export const CollectionEntrySchema = RunSchema.extend({
  employeeId: id,
  method: z.enum(['payroll', 'transfer', 'refund']),
  amount: z.number().int().positive().max(10_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().min(0),
}).strict();
export type CollectionEntryInput = z.infer<typeof CollectionEntrySchema>;

export const MONTHLY_ACTIONS = ['requestSalaryApproval', 'approveSalary', 'calculate', 'requestPremiumApproval', 'approvePremium', 'publish', 'recordPayroll'] as const;
export type MonthlyAction = typeof MONTHLY_ACTIONS[number];

export const JobStartSchema = RunSchema.extend({
  action: z.enum(MONTHLY_ACTIONS),
  employeeIds: z.array(id).min(1).max(3000),
}).strict();
export type JobStartInput = z.infer<typeof JobStartSchema>;

export const JobGetSchema = RunSchema.extend({ jobId: id }).strict();
export type JobGetInput = z.infer<typeof JobGetSchema>;
