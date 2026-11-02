import { z } from 'zod';

export const EmployeeCsvImportSchema = z.object({
  companyId: z.string().min(1),
  /** CSV の中身（画面で UTF-8／Shift_JIS を読んで文字にしたもの）。保存はしない */
  csv: z.string().min(1).max(3_000_000),
  /** true は確かめるだけ（書き込まない） */
  dryRun: z.boolean(),
});

export type EmployeeCsvImportInput = z.infer<typeof EmployeeCsvImportSchema>;
