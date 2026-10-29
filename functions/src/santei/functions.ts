import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { SanteiPreviewSchema, SanteiSubmitSchema } from './schema';
import { previewSantei, submitSantei } from './service';

export const santeiPreview = onCall(async (request) => {
  const input = validate(SanteiPreviewSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return previewSantei(input, auth);
});

export const santeiSubmit = onCall({ timeoutSeconds: 300 }, async (request) => {
  const input = validate(SanteiSubmitSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return submitSantei(input, auth);
});
