import { DependentChangeItem, LeavePeriodState, LeaveProcedureState } from '../types/firestore';
import { db } from '../config';
import { invalidArg, notFound } from '../utils/errors';

/**
 * 本人からの申請（カタログ11章）を、担当者の扶養・休業のウィザードの最初の入力に引き継ぐ。
 * 担当者はウィザードで中身を確かめて直し、いつもの手順で届出まで進める
 */

type Detail = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** 扶養の追加・外すの申請から、扶養の手続きの項目を作る。外す家族は台帳の氏名で探す（見つからなければ担当者が選ぶ） */
export function dependentItemFromRequest(type: string, d: Detail, dependents: { id: string; lastName: string; firstName: string; birthDate: string; gender: 'male' | 'female'; relationship: string }[]): DependentChangeItem | null {
  const blank = { lastNameKana: '', firstNameKana: '', occupation: '', isDisabled: false, exceptionReason: '' };
  if (type === 'dependentAdd') {
    return {
      ...blank, kind: 'add', dependentId: null, eventDate: str(d.since), lastName: str(d.lastName), firstName: str(d.firstName),
      lastNameKana: str(d.lastNameKana), firstNameKana: str(d.firstNameKana), birthDate: str(d.birthDate),
      gender: d.gender === 'male' ? 'male' : 'female', relationship: str(d.relationship) || 'other',
      income: typeof d.annualIncome === 'number' ? d.annualIncome : 0, coResident: d.coResident !== false, reason: '',
    };
  }
  if (type === 'dependentRemove') {
    const key = str(d.dependentName).replace(/[\s　]/g, '');
    const hit = dependents.find(x => `${x.lastName}${x.firstName}` === key || x.firstName === key);
    if (!hit) return null;
    return {
      ...blank, kind: 'remove', dependentId: hit.id, eventDate: str(d.since), lastName: hit.lastName, firstName: hit.firstName,
      birthDate: hit.birthDate, gender: hit.gender, relationship: hit.relationship, income: 0, coResident: true, reason: str(d.reason),
    };
  }
  return null;
}

/** 産休・育休の申請から、休業の手続きの最初の内容（出産予定日・子・期間）を作る */
export function leaveStateFromRequest(kind: 'maternity' | 'childcare', d: Detail): { expectedBirthDate: string | null; child: LeaveProcedureState['child']; period: LeavePeriodState | null } {
  const start = str(d.startDate);
  const end = str(d.endDate);
  const period = start && end ? { startDate: start, plannedEnd: end, actualBirthDate: null, actualEndDate: null } : null;
  if (kind === 'maternity') return { expectedBirthDate: str(d.expectedBirthDate) || null, child: null, period };
  const hasChild = str(d.childLastName) || str(d.childFirstName) || str(d.childBirthDate);
  return {
    expectedBirthDate: null, period,
    child: hasChild ? { lastName: str(d.childLastName), firstName: str(d.childFirstName), birthDate: str(d.childBirthDate), bornByEmployee: false } : null,
  };
}

/** 引き継ぐ申請を読む。その人のもので、まだ受け付けていない（または取り込み中の）ものに限る */
export async function loadRequestForHandoff(companyId: string, requestId: string, employeeId: string, types: string[]) {
  const snap = await db.doc(`companies/${companyId}/portalRequests/${requestId}`).get();
  if (!snap.exists) throw notFound('申請');
  const x = snap.data()!;
  if (x.employeeId !== employeeId || !types.includes(x.type)) throw invalidArg('この手続きには引き継げない申請です');
  if (x.status === 'done' || x.status === 'rejected') throw invalidArg('完了・差し戻しにした申請は引き継げません');
  return { type: x.type as string, detail: (x.detail ?? {}) as Detail };
}
