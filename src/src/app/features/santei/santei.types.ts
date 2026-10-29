// functions/src/santei/santei-calc.ts の SanteiRow と同じ形
export type SanteiStatus = 'ok' | 'excluded' | 'pending' | 'needsAction';

export interface SanteiGrade {
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
}

export interface SanteiMonth {
  yearMonth: string;
  paymentBasisDays: number | null;
  remuneration: number | null;
  used: boolean;
}

export interface SanteiRow {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: SanteiStatus;
  reason: string;
  insuredCategory: 'general' | 'partTimer' | 'shortTime';
  months: SanteiMonth[];
  basis: 'days17' | 'days15' | 'days11' | 'none' | null;
  average: number | null;
  current: SanteiGrade | null;
  proposed: SanteiGrade | null;
  changed: boolean;
  approvalStatus: 'none' | 'pending' | 'approved';
}

export interface SanteiPreviewResponse {
  year: number;
  effectiveMonth: string;
  filingPeriod: { from: string; to: string };
  items: SanteiRow[];
  hasMore: boolean;
  lastDocId?: string;
}

export interface SanteiSubmitResult {
  employeeId: string;
  ok: boolean;
  requestId?: string;
  error?: string;
}

export const SANTEI_STATUS_LABELS: Record<SanteiStatus, string> = {
  ok: '対象',
  excluded: '除外',
  pending: '保留',
  needsAction: '対応要',
};

export const INSURED_CATEGORY_LABELS: Record<SanteiRow['insuredCategory'], string> = {
  general: '一般（17日）',
  partTimer: 'パート（17日・15日特例）',
  shortTime: '短時間労働者（11日）',
};

/** 算定の対象年：7月より前は前年分の届出を確認することが多いため、1〜3月は前年を既定とする */
export function defaultSanteiYear(today = new Date()): number {
  return today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
}
