import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { seedTigersSamples } from './service';
import { registerTigers } from './register';
export const sampleTigersCreate = onCall({ maxInstances: 1 }, async request => {
  const input = validate(z.object({ companyId: z.literal('company-001'), sampleSet: z.literal('tigers-v1') }), request.data);
  return seedTigersSamples(await getAuthContext(request, input.companyId));
});
export const tigersRegister = onCall({ maxInstances: 1, concurrency: 1 }, async request => {
  const input = validate(z.object({ companyId: z.literal('company-001') }).strict(), request.data);
  return registerTigers(await getAuthContext(request, input.companyId));
});
