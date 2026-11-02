import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { ApprovalIndexEntry } from '../index/rules';
import { changeReason, changedFields, COMPANY_FILING_FIELDS, EMPLOYEE_FILING_FIELDS, SALARY_FILING_FIELDS, SALARY_FILING_TYPES } from './rules';
import { FILING_LABELS } from '../../portal/details';
import { laborConsultantText } from '../../companies/labor-consultant';

/** 自動の取り消しは、管理者の権限でシステムとして行う（監査ログの実行者は system） */
const systemAuth = (companyId: string): AuthContext => ({
  uid: 'system', companyId, roles: ['admin'], officeIds: [], employeeId: null, isSuspended: false, isLoginDisabled: false, sessionId: 'system',
});

/**
 * 承認済み（未送信）の届出の承認を取り消す。送信・提出済みのもの、計算済みの等級を伴うものなどは取り消せないので、知らせるだけにする
 */
export async function autoCancelApprovals(companyId: string, scope: { employeeId?: string; filingTypes?: string[] }, reason: string) {
  const snap = await db.collection(`companies/${companyId}/approvalIndex`).where('status', '==', 'approved').get();
  const targets = snap.docs.map(d => d.data() as ApprovalIndexEntry).filter(e =>
    e.requestType === 'filing'
    && (!scope.employeeId || e.employeeId === scope.employeeId)
    && (!scope.filingTypes || (e.filingType && scope.filingTypes.includes(e.filingType))));
  if (!targets.length) return { cancelled: 0, kept: [] as string[] };
  const { cancelApproval } = await import('../index/service');
  const auth = systemAuth(companyId);
  let cancelled = 0;
  const kept: string[] = [];
  for (const e of targets) {
    const target = e.kind === 'runFiling'
      ? { kind: 'runFiling' as const, source: e.source as 'santei' | 'bonus', parentId: e.parentId!, filingId: e.filingId! }
      : { kind: 'request' as const, employeeId: e.employeeId!, requestId: e.requestId };
    try {
      await cancelApproval({ companyId, target, reason }, auth);
      cancelled += 1;
    } catch (err) {
      // 送信・提出済みは取り消せない（それで正しい）。それ以外の理由だけ知らせる
      const message = err instanceof Error ? err.message : String(err);
      if (!/送信した届出|紙で提出した届出/.test(message)) kept.push(`${(e.filingType && FILING_LABELS[e.filingType]) || e.filingType || e.requestType}（${e.employeeName || e.officeName}）：${message}`);
    }
  }
  if (cancelled || kept.length) {
    const { notify } = await import('../../utils/notify');
    // 取り消した届出がすべて同じ事業所なら、その事業所の担当者にも見せる（会社情報の変更など複数の事業所にわたるときは管理者だけ）
    const offices = [...new Set(targets.map(e => e.officeId).filter(Boolean))];
    await notify({
      companyId, category: 'approval', targetType: 'approvalAutoCancel', createdBy: 'system', officeId: offices.length === 1 ? offices[0] : null,
      title: cancelled ? `届出の承認を自動で取り消しました（${cancelled}件）` : '承認済みの届出を確かめてください',
      body: `${reason}${kept.length ? `\n取り消せなかった届出：${kept.slice(0, 5).join('／')}${kept.length > 5 ? ` ほか${kept.length - 5}件` : ''}` : ''}`,
    });
  }
  return { cancelled, kept };
}

/** 会社情報が変わったとき：前の内容を版として残し、未提出の算定基礎届・賞与支払届の見出しを新しくし、承認を取り消す */
export async function onCompanyChanged(companyId: string, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  const fields = changedFields(before, after, COMPANY_FILING_FIELDS);
  if (!fields.length || !before || !after) return;
  const now = Timestamp.now();
  await db.collection(`companies/${companyId}/companyVersions`).add({
    version: before.version ?? null, changedFields: fields, before: Object.fromEntries(COMPANY_FILING_FIELDS.map(f => [f, before[f] ?? null])),
    after: Object.fromEntries(COMPANY_FILING_FIELDS.map(f => [f, after[f] ?? null])), changedBy: after.updatedBy ?? null, changedAt: now,
  });
  await autoCancelApprovals(companyId, {}, changeReason('会社情報', fields));
  // 未提出の run の届出の見出し（会社名・事業主氏名・社会保険労務士）を新しい内容にする。承認済みは上で下書きに戻っている
  for (const col of ['santeiRuns', 'bonusRuns']) {
    const runs = await db.collection(`companies/${companyId}/${col}`).get();
    for (const run of runs.docs) {
      const filings = await run.ref.collection('filings').where('status', 'in', ['draft', 'pending']).get();
      for (const f of filings.docs) {
        await f.ref.update({ 'header.会社名': after.name ?? '', 'header.事業主氏名': after.representativeName ?? '', 'header.社会保険労務士': laborConsultantText(after.laborConsultant), updatedAt: now, version: FieldValue.increment(1) });
      }
    }
  }
}

/** 従業員の届出に載る項目が変わったとき：その人の承認済み（未送信）の届出の承認を取り消す */
export async function onEmployeeChanged(companyId: string, employeeId: string, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  const fields = changedFields(before, after, EMPLOYEE_FILING_FIELDS);
  if (!fields.length) return;
  await autoCancelApprovals(companyId, { employeeId }, changeReason(`${after?.lastName ?? ''} ${after?.firstName ?? ''}さんの従業員情報`, fields));
}

/** 給与が変わったとき：その人の給与を使う届出（月額変更届・終了時改定の届）の承認を取り消す */
export async function onSalaryChanged(companyId: string, employeeId: string, month: string, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  const fields = changedFields(before, after, SALARY_FILING_FIELDS);
  if (!fields.length) return;
  await autoCancelApprovals(companyId, { employeeId, filingTypes: SALARY_FILING_TYPES }, changeReason(`${month}支給の給与`, fields));
}
