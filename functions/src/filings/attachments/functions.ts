import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { AttachmentDeleteSchema, AttachmentGetSchema, AttachmentListSchema, AttachmentUploadSchema } from './schema';
import { deleteAttachment, getAttachment, listAttachments, uploadAttachment } from './service';

/** 届出の添付書類と必要書類のチェックリスト。承認者も中身を確かめられる */
export const filingAttachmentList = onCall(async (request) => {
  const input = validate(AttachmentListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return listAttachments(input, auth);
});

export const filingAttachmentUpload = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(AttachmentUploadSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return uploadAttachment(input, auth);
});

export const filingAttachmentGet = onCall({ memory: '512MiB' }, async (request) => {
  const input = validate(AttachmentGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return getAttachment(input, auth);
});

export const filingAttachmentDelete = onCall(async (request) => {
  const input = validate(AttachmentDeleteSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return deleteAttachment(input, auth);
});
