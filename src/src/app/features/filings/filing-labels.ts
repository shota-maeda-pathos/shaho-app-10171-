import { StatusTone } from '../../shared/ui';

// 届出の種類と状態の表示名（カタログの状態名）。届出一覧・承認一覧で共通に使う

export const FILING_TYPE_LABELS: Record<string, string> = {
  acquisitionNotification: '資格取得届',
  lossNotification: '資格喪失届',
  pensionLoss70: '資格喪失届・70歳以上被用者該当届',
  remunerationMonthlyAlgorithm: '算定基礎届',
  remunerationMonthlyChange: '月額変更届',
  bonusPayment: '賞与支払届',
  bonusNonPayment: '賞与不支給報告書',
  dependentChange: '被扶養者（異動）届',
  maternityLeaveStart: '産前産後休業取得者申出書',
  maternityLeaveChange: '産前産後休業取得者変更（終了）届',
  childcareLeaveStart: '育児休業等取得者申出書',
  childcareLeaveEnd: '育児休業等取得者終了届',
  correction: '訂正届',
  cancellation: '取消届',
  maternityLeaveEndChange: '産前産後休業終了時報酬月額変更届',
  childcareLeaveEndChange: '育児休業等終了時報酬月額変更届',
};

export type FilingStatus =
  | 'draft' | 'rejected' | 'pending' | 'approved'
  | 'sent' | 'received' | 'processing' | 'completed' | 'mockFailed' | 'returned' | 'cancelled';
export type PaperStatus = 'none' | 'submitted' | 'accepted' | 'returned';

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  draft: '下書き', rejected: '差戻し', pending: '承認待ち', approved: '承認済み',
  sent: '送信済み', received: '受付済み', processing: '処理中', completed: '完了',
  mockFailed: '送信エラー', returned: '返戻', cancelled: '取消',
};

export const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  none: '—', submitted: '紙で提出済み', accepted: '紙で受理', returned: '紙で返戻',
};

/** 担当者から見た状態の色。手を動かすものは要対応、相手の番は待ち */
export function filingTone(status: FilingStatus, paper: PaperStatus): StatusTone {
  if (status === 'cancelled' || status === 'completed' || paper === 'accepted') return 'done';
  if (paper === 'submitted') return 'waiting';
  if (status === 'pending' || status === 'sent' || status === 'received' || status === 'processing') return 'waiting';
  // 差戻し・送信エラー・返戻は要確認、下書き・承認済み（提出前）は自分が進める
  if (status === 'rejected' || status === 'mockFailed' || status === 'returned' || paper === 'returned') return 'attention';
  return 'yours';
}

export const filingTypeLabel = (type: string) => FILING_TYPE_LABELS[type] ?? type;
