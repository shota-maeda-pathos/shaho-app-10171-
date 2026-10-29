import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { seedLoadSample } from './service';

/** 毎月の処理を大人数で確かめるための架空の事業所と従業員を作る（管理者だけ） */
export const sampleLoadCreate = onCall({ timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async request => {
  const input = validate(z.object({ companyId: z.string().min(1).regex(/^[^/]+$/), count: z.number().int().min(1).max(1000) }).strict(), request.data);
  return seedLoadSample(await getAuthContext(request, input.companyId), input.count);
});
