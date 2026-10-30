// 届出の添付書類（カタログ 届出「添付書類の管理」）。種類ごとの必要書類のチェックリストと、受け付けるファイルの確かめ。
// Firestore・Storage に依存しない純粋関数だけを置く。

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_FILING = 20;

export type AttachmentContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

/** ファイルの先頭のバイトから種類を見分ける（拡張子や申告された種類は信用しない） */
export function sniffContentType(bytes: Uint8Array): AttachmentContentType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf'; // %PDF-
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

/** 受け付けるかを確かめる。だめなら理由 */
export function attachmentError(input: { name: string; bytes: Uint8Array; existing: number }): string | null {
  if (!input.name.trim()) return 'ファイル名がありません';
  if (input.bytes.length === 0) return 'ファイルが空です';
  if (input.bytes.length > MAX_FILE_BYTES) return `ファイルが大きすぎます（${(input.bytes.length / 1024 / 1024).toFixed(1)}MB）。1ファイル5MBまでです`;
  if (input.existing >= MAX_FILES_PER_FILING) return `1件の届出に添付できるのは${MAX_FILES_PER_FILING}ファイルまでです`;
  if (!sniffContentType(input.bytes)) return 'PDF・JPEG・PNGのファイルだけ添付できます';
  return null;
}

/** 保存するファイル名（パスに使えない文字を置き換え、長さを切る） */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (cleaned || 'file').slice(-100);
}

export interface ChecklistItem {
  key: string;
  label: string;
  /** required：原則必要、conditional：場合により必要（note に条件） */
  need: 'required' | 'conditional';
  note: string | null;
}

type Data = Record<string, any>;

/**
 * 届出の種類ごとの必要書類（日本年金機構の各届書の記入方法・添付書類の案内による目安）。
 * 個人番号で確認できる書類は省略できるため、送信前は警告にとどめる
 */
export function attachmentChecklist(filingType: string, formData: Data, original?: { filingType?: string }): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, need: ChecklistItem['need'], note: string | null = null) => {
    if (!items.some(i => i.key === key)) items.push({ key, label, need, note });
  };
  switch (filingType) {
    case 'acquisitionNotification':
      if (String(formData['備考'] ?? '').includes('再雇用')) {
        add('rehire', '退職日と継続再雇用が確認できる書類（就業規則・退職辞令の写しと雇用契約書の写し、または事業主の証明書）', 'required');
      }
      break;
    case 'lossNotification':
      add('insuranceCard', '回収した健康保険証（資格確認書）', 'conditional', '回収できないときは「被保険者証回収不能届」を添えます。マイナ保険証だけの人は不要です');
      break;
    case 'dependentChange': {
      const list = Array.isArray(formData['被扶養者一覧']) ? (formData['被扶養者一覧'] as Data[]) : [];
      for (const d of list) {
        const kind = String(d['異動の種別'] ?? '');
        if (kind === '該当') {
          add('relationship', '続柄の確認書類（戸籍謄本など）', 'conditional', '被保険者と被扶養者の個人番号が届出に書かれていれば省略できます');
          add('income', '収入の確認書類（課税（非課税）証明書・退職証明書・雇用保険の受給資格者証など）', 'conditional', '16歳未満の子と、在学中の16歳以上の子は不要です');
          if (String(d['同居別居'] ?? '') === '別居') add('remittance', '仕送りの事実と額が分かる書類（振込の控えなど）', 'required', '別居の家族を扶養に入れるとき');
          // 同居が要件なのは「その他の親族」（扶養の手続きの続柄の表示名）
          if (String(d['続柄'] ?? '') === 'その他の親族') {
            add('residence', '同居が分かる書類（住民票）', 'conditional', '同居が要件の続柄。個人番号で確認できれば省略できます');
          }
        }
        if (kind === '非該当') add('dependentCard', '扶養から外れる人の健康保険証（資格確認書）', 'conditional', '回収できる場合');
      }
      break;
    }
    case 'remunerationMonthlyChange':
    case 'maternityLeaveEndChange':
    case 'childcareLeaveEndChange':
      add('wageLedger', '賃金台帳と出勤簿の写し', 'conditional', '改定月が届出の日から60日以上さかのぼるとき、または標準報酬月額が5等級以上下がるとき');
      break;
    case 'correction':
    case 'cancellation':
      add('evidence', '訂正・取消の理由が分かる書類（賃金台帳・出勤簿・雇用契約書の写しなど）', 'conditional',
        original?.filingType === 'acquisitionNotification' || original?.filingType === 'lossNotification'
          ? '資格の取得日・喪失日を直す・取り消すときは、事実が確認できる書類を添えます'
          : '年金事務所から求められたとき');
      break;
    default:
      break;
  }
  return items;
}

/** チェックリストのうち、まだ添付のない「原則必要」の書類 */
export function missingRequired(items: ChecklistItem[], attachedKeys: (string | null)[]): ChecklistItem[] {
  const have = new Set(attachedKeys.filter(Boolean));
  return items.filter(i => i.need === 'required' && !have.has(i.key));
}
