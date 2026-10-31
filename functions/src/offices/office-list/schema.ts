import { z } from 'zod';

export const OfficeListSchema = z.object({
  companyId: z.string(),
  includeInactive: z.boolean().optional(),
  /** 配属できるか（設定の不足・料率）も調べる。設定の事業所の画面だけが使う（料率を読むぶん遅くなる） */
  withSetup: z.boolean().optional(),
});

export type OfficeListInput = z.infer<typeof OfficeListSchema>;
