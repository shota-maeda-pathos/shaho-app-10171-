import { ProcedureStep, ProcedureType, StepType } from '../types/firestore';

interface StepTemplate {
  id: string;
  label: string;
  type: StepType;
  dependsOn: string[];
  isConditional: boolean;
  condition: string | null;
}

const ACQUISITION_STEPS: StepTemplate[] = [
  { id: 'emp_register', label: '従業員情報登録', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['emp_register'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

/** 入社手続き（ウィザード）。ステップ名は動詞で書く。電子申請と紙提出は画面では「提出する」1つにまとめる */
const ONBOARDING_STEPS: StepTemplate[] = [
  { id: 'invite', label: '本人に入力を依頼する', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'register', label: '本人の入力を確かめて台帳に登録する', type: 'data_entry', dependsOn: ['invite'], isConditional: false, condition: null },
  { id: 'contract', label: '雇用条件を入れる', type: 'data_entry', dependsOn: ['register'], isConditional: false, condition: null },
  { id: 'filing_create', label: '等級を確かめて資格取得届を作る', type: 'document_create', dependsOn: ['contract'], isConditional: true, condition: '社会保険に加入する場合' },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: true, condition: '社会保険に加入する場合' },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: true, condition: '社会保険に加入する場合' },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: true, condition: '社会保険に加入する場合' },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

/** 退職手続き（ウィザード）。社会保険に加入していない人は保険料・届出のステップがない */
const RESIGNATION_STEPS: StepTemplate[] = [
  { id: 'entry', label: '退職日と理由を入れる', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'settlement', label: '最後の保険料の集め方を決める', type: 'calculation', dependsOn: ['entry'], isConditional: true, condition: '保険料がかかる月がある場合' },
  { id: 'account', label: '退職後のアカウントを確かめる', type: 'account_control', dependsOn: ['entry'], isConditional: false, condition: null },
  { id: 'filing_create', label: '資格喪失届を作る', type: 'document_create', dependsOn: ['entry'], isConditional: true, condition: '社会保険に加入している場合' },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: true, condition: '社会保険に加入している場合' },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: true, condition: '社会保険に加入している場合' },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: true, condition: '社会保険に加入している場合' },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit', 'settlement', 'account'], isConditional: false, condition: null },
];

/** 扶養の手続き（ウィザード）。台帳への反映は完了時に行う */
const DEPENDENT_WIZARD_STEPS: StepTemplate[] = [
  { id: 'change', label: '変わった内容を入れる', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '被扶養者（異動）届を作る', type: 'document_create', dependsOn: ['change'], isConditional: false, condition: null },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

/** 産休・育休の手続き（ウィザード）。休業中の変更届・終了届は、届出のステップを作り直して同じ手続きで出す */
const LEAVE_WIZARD_STEPS: StepTemplate[] = [
  { id: 'plan', label: '休業の期間を決める', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '申出書を作る', type: 'document_create', dependsOn: ['plan'], isConditional: false, condition: null },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'during', label: '休業中のことと復帰を記録する', type: 'data_entry', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit', 'during'], isConditional: false, condition: null },
];

const REVISION_WIZARD_STEPS: StepTemplate[] = [
  { id: 'change', label: '変動を確かめる', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'judge', label: '判定する', type: 'calculation', dependsOn: ['change'], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出を作る', type: 'document_create', dependsOn: ['judge'], isConditional: false, condition: null },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const AGE_WIZARD_STEPS: StepTemplate[] = [
  { id: 'check', label: '到達日と届出の要否を確かめる', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出を作る', type: 'document_create', dependsOn: ['check'], isConditional: false, condition: null },
  { id: 'approval', label: '承認者が確認する', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '電子申請する（模擬）', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙で提出して記録する', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了を確認する', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const LOSS_STEPS: StepTemplate[] = [
  { id: 'resign_entry', label: '退職情報入力', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'final_salary', label: '最終給与精算', type: 'calculation', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['resign_entry'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'portal_access', label: 'ポータル閲覧期間設定', type: 'account_control', dependsOn: ['resign_entry'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit', 'portal_access', 'final_salary'], isConditional: false, condition: null },
];

const DEPENDENT_CHANGE_STEPS: StepTemplate[] = [
  { id: 'data_entry', label: '扶養異動情報入力', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['data_entry'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const MATERNITY_LEAVE_STEPS: StepTemplate[] = [
  { id: 'leave_register', label: '休業情報登録', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'exemption_create', label: '保険料免除登録', type: 'calculation', dependsOn: ['leave_register'], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['leave_register'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit', 'exemption_create'], isConditional: false, condition: null },
];

const CHILDCARE_LEAVE_STEPS: StepTemplate[] = [
  { id: 'leave_register', label: '休業情報登録', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'exemption_create', label: '保険料免除登録', type: 'calculation', dependsOn: ['leave_register'], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['leave_register'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'end_filing', label: '終了届作成', type: 'document_create', dependsOn: [], isConditional: true, condition: '育児休業終了時のみ' },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit', 'exemption_create'], isConditional: false, condition: null },
];

const MONTHLY_CHANGE_STEPS: StepTemplate[] = [
  { id: 'detect', label: '変動検知・確認', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['detect'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const ANNUAL_REVIEW_STEPS: StepTemplate[] = [
  { id: 'target_confirm', label: '対象者確認', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'calculate', label: '算定基礎計算', type: 'calculation', dependsOn: ['target_confirm'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['calculate'], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ一括作成', type: 'document_create', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const BONUS_PAYMENT_STEPS: StepTemplate[] = [
  { id: 'bonus_confirm', label: '賞与データ確認', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'insurance_calc', label: '賞与保険料計算', type: 'calculation', dependsOn: ['bonus_confirm'], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ一括作成', type: 'document_create', dependsOn: ['insurance_calc'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const TRANSFER_STEPS: StepTemplate[] = [
  { id: 'transfer_entry', label: '異動情報入力', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['transfer_entry'], isConditional: true, condition: '都道府県をまたぐ異動の場合' },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['transfer_entry'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['approval'], isConditional: false, condition: null },
];

const AGE_EVENT_STEPS: StepTemplate[] = [
  { id: 'confirm_event', label: '年齢到達確認', type: 'data_entry', dependsOn: [], isConditional: false, condition: null },
  { id: 'filing_create', label: '届出データ作成', type: 'document_create', dependsOn: ['confirm_event'], isConditional: false, condition: null },
  { id: 'approval', label: '社内承認', type: 'approval', dependsOn: ['filing_create'], isConditional: false, condition: null },
  { id: 'mock_filing', label: '模擬電子申請', type: 'mock_filing', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'paper_submit', label: '紙提出記録', type: 'paper_submit', dependsOn: ['approval'], isConditional: false, condition: null },
  { id: 'confirm', label: '完了確認', type: 'confirmation', dependsOn: ['mock_filing', 'paper_submit'], isConditional: false, condition: null },
];

const TEMPLATE_MAP: Record<ProcedureType, StepTemplate[]> = {
  acquisition: ACQUISITION_STEPS,
  loss: LOSS_STEPS,
  dependent_change: DEPENDENT_CHANGE_STEPS,
  maternity_leave: MATERNITY_LEAVE_STEPS,
  childcare_leave: CHILDCARE_LEAVE_STEPS,
  monthly_change: MONTHLY_CHANGE_STEPS,
  annual_review: ANNUAL_REVIEW_STEPS,
  bonus_payment: BONUS_PAYMENT_STEPS,
  transfer: TRANSFER_STEPS,
  age_event: AGE_EVENT_STEPS,
};

const PROCEDURE_TYPE_LABELS: Record<ProcedureType, string> = {
  acquisition: '入社手続き',
  loss: '退職手続き',
  dependent_change: '扶養異動',
  maternity_leave: '産前産後休業',
  childcare_leave: '育児休業',
  monthly_change: '随時改定',
  annual_review: '算定基礎届',
  bonus_payment: '賞与支払届',
  transfer: '異動手続き',
  age_event: '年齢到達手続き',
};

/** 入社手続き（ウィザード）のステップ */
export function buildOnboardingSteps(): ProcedureStep[] {
  return toSteps(ONBOARDING_STEPS);
}

/** 扶養の手続き（ウィザード）のステップ */
export function buildDependentWizardSteps(): ProcedureStep[] {
  return toSteps(DEPENDENT_WIZARD_STEPS);
}

/** 産休・育休の手続き（ウィザード）のステップ */
export function buildLeaveWizardSteps(): ProcedureStep[] {
  return toSteps(LEAVE_WIZARD_STEPS);
}

/** 随時改定・終了時改定（ウィザード）のステップ */
export function buildRevisionWizardSteps(): ProcedureStep[] {
  return toSteps(REVISION_WIZARD_STEPS);
}

/** 年齢到達（ウィザード）のステップ */
export function buildAgeWizardSteps(): ProcedureStep[] {
  return toSteps(AGE_WIZARD_STEPS);
}

/** 退職手続き（ウィザード）のステップ */
export function buildResignationSteps(): ProcedureStep[] {
  return toSteps(RESIGNATION_STEPS);
}

export function buildSteps(procedureType: ProcedureType): ProcedureStep[] {
  return toSteps(TEMPLATE_MAP[procedureType]);
}

function toSteps(templates: StepTemplate[]): ProcedureStep[] {
  return templates.map((t) => ({
    id: t.id,
    label: t.label,
    type: t.type,
    dependsOn: t.dependsOn,
    isConditional: t.isConditional,
    condition: t.condition,
    status: t.dependsOn.length === 0 ? 'available' as const : 'blocked' as const,
    statusDetail: null,
    referenceType: null,
    referenceId: null,
    referenceStatus: null,
    actionLabel: null,
    actionRoute: null,
    completedAt: null,
    completedBy: null,
  }));
}

export function buildTitle(procedureType: ProcedureType, employeeName: string): string {
  return `${employeeName} ${PROCEDURE_TYPE_LABELS[procedureType]}`;
}

export function buildBatchTitle(procedureType: ProcedureType, targetYearMonth: string): string {
  const [y, m] = targetYearMonth.split('-');
  const label = PROCEDURE_TYPE_LABELS[procedureType];
  if (procedureType === 'annual_review') {
    return `${y}年度 ${label}`;
  }
  return `${y}年${parseInt(m, 10)}月 ${label}`;
}

export function getProcedureTypeLabel(procedureType: ProcedureType): string {
  return PROCEDURE_TYPE_LABELS[procedureType];
}
