import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { seedUnionSample } from './service';

/** 組合健保のテスト用の事業所と従業員を作る（管理者だけ。料率は設定→料率で登録する） */
export const sampleUnionCreate = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async request => {
  const input = validate(z.object({ companyId: z.string().min(1) }).strict(), request.data);
  return seedUnionSample(await getAuthContext(request, input.companyId));
});
