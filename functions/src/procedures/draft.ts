import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ProcedureDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { requireProcedureAccess } from './access';

/**
 * 1人の画面の入力の下書き（docs/ui-unification-design.md の5章「1人の画面の入力は自動で下書き保存」）。
 * 手続きの下の drafts/{ステップ} に、画面の入力をそのまま置く。手続きの本体と version は変えない
 * （ウィザードの保存は expectedVersion で食い違いを確かめるため、下書きで version が上がると保存できなくなる）。
 * 下書きは確定した値ではないので、計算・届出・一覧には使わない。ステップを確定したら画面が消す。
 */

/** 下書き1件の大きさの上限（文字数）。画面の入力欄だけなので十分に小さい */
export const DRAFT_MAX_CHARS = 50_000;

/** 下書きにできる内容か（JSON にでき、大きすぎない） */
export function draftError(data: unknown): string | null {
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return '下書きにできない内容です';
  }
  if (json === undefined) return '下書きにできない内容です';
  if (json.length > DRAFT_MAX_CHARS) return '下書きが大きすぎます';
  return null;
}

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const step = z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/);

export const ProcedureDraftGetSchema = z.object({ companyId: id, procedureId: id }).strict();
export const ProcedureDraftSaveSchema = z.object({
  companyId: id,
  procedureId: id,
  step,
  /** null は下書きを消す（ステップを確定したとき） */
  data: z.unknown().nullable(),
}).strict();

async function loadProcedure(auth: AuthContext, procedureId: string) {
  const ref = db.doc(`companies/${auth.companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  requireProcedureAccess(auth, snap.data() as ProcedureDoc);
  return ref;
}

export async function getDrafts(auth: AuthContext, procedureId: string) {
  const ref = await loadProcedure(auth, procedureId);
  const snap = await ref.collection('drafts').get();
  return {
    drafts: Object.fromEntries(snap.docs.map(d => [d.id, {
      data: d.data().data ?? null,
      savedAt: (d.data().savedAt as Timestamp | undefined)?.toDate().toISOString() ?? null,
      mine: d.data().savedBy === auth.uid,
    }])),
  };
}

export async function saveDraft(auth: AuthContext, input: z.infer<typeof ProcedureDraftSaveSchema>) {
  const ref = await loadProcedure(auth, input.procedureId);
  const draftRef = ref.collection('drafts').doc(input.step);
  if (input.data === null || input.data === undefined) {
    await draftRef.delete();
    return { savedAt: null };
  }
  const error = draftError(input.data);
  if (error) throw invalidArg(error);
  const now = Timestamp.now();
  await draftRef.set({ data: input.data, savedAt: now, savedBy: auth.uid, updatedAt: FieldValue.serverTimestamp() });
  return { savedAt: now.toDate().toISOString() };
}

/** 手続きの下書き（ステップごと）を読む */
export const procedureDraftGet = onCall(async (request) => {
  const input = validate(ProcedureDraftGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return getDrafts(auth, input.procedureId);
});

/** 手続きの1ステップの下書きを置く（data が null なら消す） */
export const procedureDraftSave = onCall(async (request) => {
  const input = validate(ProcedureDraftSaveSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return saveDraft(auth, input);
});
