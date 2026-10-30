import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ArchiveBatchSchema, ArchiveGetSchema, ArchiveListSchema } from './schema';
import { batchArchives, getArchive, listArchives } from './service';

const staff = async (request: Parameters<typeof getAuthContext>[0], companyId: string) => {
  const auth = await getAuthContext(request, companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return auth;
};

/** 届出の保存原本（承認ごと）の一覧 */
export const filingArchiveList = onCall(async (request) => {
  const input = validate(ArchiveListSchema, request.data);
  return listArchives(input, await staff(request, input.companyId));
});

/** 保存原本の中身（PDFを作り直す） */
export const filingArchiveGet = onCall(async (request) => {
  const input = validate(ArchiveGetSchema, request.data);
  return getArchive(input, await staff(request, input.companyId));
});

/** ZIP の一括ダウンロード用に、選んだ届出の原本をまとめて返す */
export const filingArchiveBatch = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(ArchiveBatchSchema, request.data);
  return batchArchives(input, await staff(request, input.companyId));
});
