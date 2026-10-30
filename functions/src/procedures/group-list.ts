import { FieldPath } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireOffice, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ProcedureDoc } from '../types/firestore';
import { currentAgeStep } from '../age-event/service';
import { currentResignationStep } from '../resignation/service';

/**
 * 退職・年齢到達の「まとめ」（docs/ui-unification-design.md の3章）を画面で束ねるための一覧。
 * まとめはデータとしては持たず、画面が事業所×日（退職日・到達月）で束ねる。入社は onboardingList を使う。
 */
export type GroupProcedureType = 'loss' | 'age_event';

export interface GroupListItem {
  id: string;
  version: number;
  status: string;
  name: string;
  employeeId: string | null;
  officeId: string;
  /** 退職日（未入力は null）・到達日 */
  date: string | null;
  /** 年齢到達の種類（pension70／health75） */
  kind: string | null;
  /** ウィザードで表示しているステップ（完了は done） */
  current: string;
  /** 差し戻し・返戻のときの理由など、今のステップの補足 */
  currentDetail: string | null;
  returned: boolean;
  /** 承認を依頼中か（承認のステップで止まっている） */
  waitingApproval: boolean;
}

/** 手続き1件をまとめの一覧の1行にする。旧方式の退職手続き（resignation がない）は null */
export function groupItemOf(id: string, p: ProcedureDoc, type: GroupProcedureType): GroupListItem | null {
  if (type === 'loss' && !p.resignation) return null;
  if (type === 'age_event' && !p.ageEvent) return null;
  const current = type === 'loss' ? currentResignationStep(p) : currentAgeStep(p);
  const open = p.steps.find(s => s.status === 'returned') ?? p.steps.find(s => s.status === 'in_progress');
  return {
    id, version: p.version, status: p.status, name: p.employeeName, employeeId: p.employeeId, officeId: p.officeId,
    date: type === 'loss' ? p.resignation!.resignationDate : p.ageEvent!.reachDate,
    kind: type === 'age_event' ? p.ageEvent!.kind : null,
    current,
    currentDetail: open?.statusDetail ?? null,
    returned: p.steps.some(s => s.status === 'returned'),
    waitingApproval: current === 'approval',
  };
}

export const ProcedureGroupListSchema = z.object({
  companyId: z.string().min(1).regex(/^[^/]+$/),
  procedureType: z.enum(['loss', 'age_event']),
  officeId: z.string().min(1).regex(/^[^/]+$/).optional(),
  includeCompleted: z.boolean().default(false),
});

export async function listProcedureGroups(input: z.infer<typeof ProcedureGroupListSchema>, auth: AuthContext) {
  if (input.officeId) requireOffice(auth, input.officeId);
  let query: FirebaseFirestore.Query = db.collection(`companies/${auth.companyId}/procedures`)
    .where('procedureType', '==', input.procedureType)
    .where('deletedAt', '==', null);
  if (!input.includeCompleted) query = query.where('status', '==', 'in_progress');
  if (input.officeId) query = query.where('officeId', '==', input.officeId);
  // 等価の条件だけで、1000件ずつ最後まで読む（旧方式の手続きで件数の上限が埋まらないように）
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (let page = 0; page < 20; page++) {
    let q = query.orderBy(FieldPath.documentId()).limit(1000);
    if (docs.length) q = q.startAfter(docs[docs.length - 1].id);
    const snap = await q.get();
    docs.push(...snap.docs);
    if (snap.size < 1000) break;
  }
  const items = docs
    .map(d => groupItemOf(d.id, d.data() as ProcedureDoc, input.procedureType))
    .filter((i): i is GroupListItem => i !== null && i.status !== 'cancelled')
    .filter(i => auth.roles.includes('admin') || auth.officeIds.includes(i.officeId))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name, 'ja'));
  return { items };
}

/** 退職・年齢到達の手続きの一覧（画面がまとめに束ねる） */
export const procedureGroupList = onCall(async (request) => {
  const input = validate(ProcedureGroupListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return listProcedureGroups(input, auth);
});
