import { monthOf } from '../insurance/calculator';

/**
 * 事業所間異動の影響（純粋関数）。カタログ：都道府県が変わり保険料率が変わるか、届出が要るか（管轄年金事務所が変わるか）、
 * どの月から新しい事業所の料率を使うかを判定して確認画面に出す。
 * - 事業所整理記号が違う事業所への異動は、別の適用事業所への異動なので、異動日に旧事業所で資格を失い、新事業所で資格を得る
 *   （資格喪失届・資格取得届。喪失と取得が同じ月なので、その月から新事業所の保険料になる）
 * - 事業所整理記号が同じ（一括適用など）なら届出はいらない
 */
export interface OfficeFacts {
  id: string;
  name: string;
  officeNumber: string;
  prefectureCode: string;
  insurerId: string;
  pensionOfficeName: string | null;
}

export interface TransferFacts {
  /** 健康保険の料率が変わる（都道府県・保険者が違う） */
  healthRateChanges: boolean;
  /** 別の適用事業所への異動（届出が要る） */
  filingRequired: boolean;
  /** 管轄年金事務所が変わる */
  pensionOfficeChanges: boolean;
  /** 新しい事業所の料率を使い始める保険料の月 */
  newRateMonth: string;
  notes: string[];
}

export function transferFacts(from: OfficeFacts, to: OfficeFacts, transferDate: string): TransferFacts {
  const healthRateChanges = from.prefectureCode !== to.prefectureCode || from.insurerId !== to.insurerId;
  const filingRequired = !!from.officeNumber && !!to.officeNumber ? from.officeNumber !== to.officeNumber : true;
  const pensionOfficeChanges = !!from.pensionOfficeName && !!to.pensionOfficeName && from.pensionOfficeName !== to.pensionOfficeName;
  const newRateMonth = monthOf(transferDate);
  const notes: string[] = [];
  if (healthRateChanges) notes.push(`健康保険の料率が変わります（${from.name} → ${to.name}）`);
  else notes.push('健康保険の料率は変わりません');
  notes.push(filingRequired
    ? `別の適用事業所への異動のため、${from.name}で資格喪失届、${to.name}で資格取得届を出します（喪失日・取得日はどちらも異動日）`
    : '同じ適用事業所の中の異動（事業所整理記号が同じ）のため、届出はいりません');
  if (pensionOfficeChanges) notes.push(`管轄の年金事務所が変わります（${from.pensionOfficeName} → ${to.pensionOfficeName}）`);
  notes.push(`${Number(newRateMonth.slice(0, 4))}年${Number(newRateMonth.slice(5, 7))}月分の保険料から${to.name}で計算します`);
  return { healthRateChanges, filingRequired, pensionOfficeChanges, newRateMonth, notes };
}
