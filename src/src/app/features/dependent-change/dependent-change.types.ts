/** サーバー（functions/src/dependent-change）の戻り値に合わせた型 */

export type DependentKey = 'change' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type ChangeKind = 'add' | 'remove' | 'change';

export const RELATIONSHIP_OPTIONS = [
  { value: 'spouse', label: '配偶者' }, { value: 'child', label: '子' }, { value: 'parent', label: '父母' },
  { value: 'grandparent', label: '祖父母' }, { value: 'grandchild', label: '孫' }, { value: 'sibling', label: '兄弟姉妹' },
  { value: 'other', label: 'その他の親族（同居が要件）' },
];
export const relationshipLabel = (v: string) => RELATIONSHIP_OPTIONS.find(o => o.value === v)?.label ?? v;

export const REMOVE_REASONS = ['就職（勤務先の健康保険に加入）', '収入の増加', '離婚', '死亡', '75歳到達（後期高齢者医療）', '別居（同居が要件の場合）', 'その他'];

export interface ChangeItem {
  kind: ChangeKind;
  dependentId: string | null;
  eventDate: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  relationship: string;
  income: number;
  coResident: boolean;
  occupation: string;
  isDisabled: boolean;
  reason: string;
  exceptionReason: string;
}

export interface Judgement {
  ageAtYearEnd: number;
  limit: number;
  basis: string;
  overLimit: boolean;
  lateElderly: boolean;
  needsCoResidence: boolean;
  thirdInsured: boolean;
  notes: string[];
}

export interface Summary {
  judgements: (Judgement | null)[];
  deadline: string | null;
  attachments: string[];
}

export interface CurrentDependent {
  id: string; lastName: string; firstName: string; lastNameKana: string; firstNameKana: string; birthDate: string;
  gender: 'male' | 'female'; relationship: string; income: number; coResident: boolean; occupation: string; isDisabled: boolean;
  qualificationDate: string | null;
}

export interface DependentView extends Summary {
  procedure: { id: string; version: number; status: string; title: string; officeId: string; officeName: string; employeeName: string; fromOnboarding: boolean };
  current: DependentKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; acquisitionDate: string | null };
  items: ChangeItem[];
  dependents: CurrentDependent[];
  filing: { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null } | null;
  approval: { status: string; comment: string | null } | null;
  locked: boolean;
  appliedAt: string | null;
}

export const emptyItem = (kind: ChangeKind = 'add'): ChangeItem => ({
  kind, dependentId: null, eventDate: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', birthDate: '',
  gender: 'female', relationship: 'child', income: 0, coResident: true, occupation: '', isDisabled: false, reason: '', exceptionReason: '',
});
