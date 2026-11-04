import { addMonths, eligibilityByAge, lookupGrade, monthOf, resolveGradeTable } from '../insurance/calculator';

/**
 * 事業所間異動の影響（純粋関数）。カタログ：都道府県が変わり保険料率が変わるか、届出が要るか（管轄年金事務所が変わるか）、
 * どの月から新しい事業所の料率を使うかを判定して確認画面に出す。
 * - 事業所整理記号が違う事業所への異動は、別の適用事業所への異動なので、異動日に旧事業所で資格を失い、新事業所で資格を得る
 *   （資格喪失届・資格取得届。喪失と取得が同じ月なので、その月から新事業所の保険料になる）
 * - 事業所整理記号が同じ（一括適用など）なら届出はいらない
 * - 社会保険に加入していない人は、別の適用事業所への異動でも届出はいらない（退職と同じ）
 */
export interface OfficeFacts {
  id: string;
  name: string;
  officeNumber: string;
  prefectureCode: string;
  insurerId: string;
  pensionOfficeName: string | null;
}

/** 異動日に入っている保険（雇用条件と年齢から）。退職の resignationFacts と同じ考え方 */
export interface TransferCoverage {
  health: boolean;
  pension: boolean;
  /** 70歳以上で厚生年金に入らず、70歳以上被用者として届け出ている（喪失届に不該当、取得届に該当を書く） */
  over70Worker: boolean;
}

export function transferCoverage(p: { enrolled: { health: boolean; pension: boolean }; applicable: boolean; birthDate: string | null; transferDate: string }): TransferCoverage {
  const age = p.birthDate ? eligibilityByAge(p.birthDate, p.transferDate) : null;
  return {
    health: p.enrolled.health && (age?.health ?? true),
    pension: p.enrolled.pension && (age?.pension ?? true),
    over70Worker: !!age && !age.pension && p.applicable,
  };
}

/** 届出の「取得区分」「喪失する保険」の書き方 */
export function insuranceLabel(c: TransferCoverage, kind: '該当' | '不該当'): string {
  if (c.health && c.pension) return '健保・厚年';
  if (c.health) return '健保のみ';
  if (c.pension) return '厚年のみ';
  return `なし（70歳以上被用者の${kind}のみ）`;
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

export function transferFacts(from: OfficeFacts, to: OfficeFacts, transferDate: string, coverage?: TransferCoverage): TransferFacts {
  const healthRateChanges = from.prefectureCode !== to.prefectureCode || from.insurerId !== to.insurerId;
  const otherOffice = !!from.officeNumber && !!to.officeNumber ? from.officeNumber !== to.officeNumber : true;
  const insured = !coverage || coverage.health || coverage.pension || coverage.over70Worker;
  const filingRequired = otherOffice && insured;
  const pensionOfficeChanges = !!from.pensionOfficeName && !!to.pensionOfficeName && from.pensionOfficeName !== to.pensionOfficeName;
  const newRateMonth = monthOf(transferDate);
  const notes: string[] = [];
  if (healthRateChanges) notes.push(`健康保険の料率が変わります（${from.name} → ${to.name}）`);
  else notes.push('健康保険の料率は変わりません');
  notes.push(filingRequired
    ? `別の適用事業所への異動のため、${from.name}で資格喪失届、${to.name}で資格取得届を出します（喪失日・取得日はどちらも異動日）`
    : otherOffice ? '社会保険に加入していないため、別の適用事業所への異動でも届出はいりません'
    : '同じ適用事業所の中の異動（事業所整理記号が同じ）のため、届出はいりません');
  if (filingRequired && coverage?.over70Worker) notes.push('70歳以上のため厚生年金には入りません。喪失届に70歳以上被用者の不該当、取得届に該当を書きます');
  if (filingRequired && coverage && !coverage.health) notes.push('75歳以上のため健康保険には入りません');
  if (pensionOfficeChanges) notes.push(`管轄の年金事務所が変わります（${from.pensionOfficeName} → ${to.pensionOfficeName}）`);
  notes.push(`${Number(newRateMonth.slice(0, 4))}年${Number(newRateMonth.slice(5, 7))}月分の保険料から${to.name}で計算します`);
  return { healthRateChanges, filingRequired, pensionOfficeChanges, newRateMonth, notes };
}

/**
 * 異動を完了にして台帳の所属を変えてよいか。変えられないときは理由を返す（純粋関数）。
 * 所属は異動日から変える。異動日の前の月の保険料は元の事業所で計算するので、それが済んでから
 * （保険料の対象でない人などは skipPremiumCheck で省ける）
 */
export function transferMoveBlocker(p: { today: string; transferDate: string; hasLastMonthPremium: boolean; skipPremiumCheck: boolean }): string | null {
  if (p.today < p.transferDate) return `所属は異動日（${p.transferDate}）に変えます。異動日になってから完了にしてください`;
  if (!p.hasLastMonthPremium && !p.skipPremiumCheck) {
    return `${lastMonthBeforeTransfer(p.transferDate)}分の保険料が、まだ元の事業所で計算されていません。毎月の処理で計算してから完了にしてください（保険料の対象でない人は「計算せずに進める」に印を付けます）`;
  }
  return null;
}

/** 元の事業所で保険料を計算する最後の月（異動日の前の月。資格喪失日の属する月の前の月まで） */
export function lastMonthBeforeTransfer(transferDate: string): string {
  return addMonths(transferDate.slice(0, 7), -1);
}

/**
 * 異動先での資格取得時決定（純粋関数）。別の適用事業所への異動は資格を取り直すので、標準報酬月額は前の等級を引き継がず、
 * 異動日現在の報酬月額（通貨＋現物。残業代などは見込みで入れる）から決め直す（健保法42条・厚年法22条）
 */
export function transferAcquisitionGrade(p: { currency: number; inKind: number }) {
  const remuneration = Math.floor(p.currency + p.inKind);
  const health = lookupGrade(resolveGradeTable('health'), remuneration);
  const pension = lookupGrade(resolveGradeTable('pension'), remuneration);
  return {
    remuneration,
    health: { gradeNumber: health.gradeNumber, standardRemuneration: health.standardRemuneration },
    pension: { gradeNumber: pension.gradeNumber, standardRemuneration: pension.standardRemuneration },
  };
}
