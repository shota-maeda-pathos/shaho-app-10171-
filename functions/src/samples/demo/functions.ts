import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { seedDemoData } from './service';

/** 評価用のテストデータ（事業所3か所・従業員300人）を作る（管理者だけ。古いテストデータを消してから一度だけ） */
export const sampleDemoCreate = onCall({ timeoutSeconds: 540, memory: '1GiB', maxInstances: 1, concurrency: 1 }, async request => {
  const input = validate(z.object({ companyId: z.string().min(1), sampleSet: z.literal('demo-v1') }).strict(), request.data);
  return seedDemoData(await getAuthContext(request, input.companyId));
});

/** 評価用のテストデータの直し（2026-11-02 の一周で見つけたもの）。既定は dry で、apply: true のときだけ書く（管理者だけ） */
export const sampleDemoRepair = onCall({ timeoutSeconds: 540, memory: '1GiB', maxInstances: 1, concurrency: 1 }, async request => {
  const input = validate(z.object({ companyId: z.string().min(1), apply: z.boolean().optional() }).strict(), request.data);
  const { repairDemoData } = await import('./repair');
  return repairDemoData(await getAuthContext(request, input.companyId), input.apply !== true);
});
