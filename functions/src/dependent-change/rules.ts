import { addDays, nthBirthday } from '../insurance/calculator';

/** 続柄。同居が要件になるかは続柄で決まる（担当者が最終判断する） */
export const RELATIONSHIPS = ['spouse', 'child', 'parent', 'grandparent', 'grandchild', 'sibling', 'other'] as const;
export type Relationship = typeof RELATIONSHIPS[number];
export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  spouse: '配偶者', child: '子', parent: '父母', grandparent: '祖父母', grandchild: '孫', sibling: '兄弟姉妹', other: 'その他の親族',
};

export type ChangeKind = 'add' | 'remove' | 'change';
export const KIND_LABEL: Record<ChangeKind, string> = { add: '該当（扶養に入れる）', remove: '非該当（扶養から外す）', change: '変更' };

/** 扶養から外す理由（被扶養者（異動）届の「非該当」の理由） */
export const REMOVE_REASONS = ['就職（勤務先の健康保険に加入）', '収入の増加', '離婚', '死亡', '75歳到達（後期高齢者医療）', '別居（同居が要件の場合）', 'その他'] as const;

/** 年齢 n の基準日（その年の12月31日時点の満年齢）。誕生日の前日に年をとる（年齢計算ニ関スル法律） */
export function ageAtYearEnd(birthDate: string, date: string): number {
  const yearEnd = `${date.slice(0, 4)}-12-31`;
  const age = Number(yearEnd.slice(0, 4)) - Number(birthDate.slice(0, 4));
  // 1月1日生まれは前年の12月31日に1つ上の年齢に達する
  return addDays(nthBirthday(birthDate, age + 1), -1) <= yearEnd ? age + 1 : age;
}

export interface DependentFacts {
  relationship: Relationship;
  birthDate: string;
  isDisabled: boolean;
  income: number;
  coResident: boolean;
  /** 認定日（扶養に入れる事実の発生日） */
  eventDate: string;
}

/**
 * 扶養に入れる人の収入要件と注意点（カタログ 届出⑦）。
 * - 原則：年間収入130万円未満
 * - 60歳以上、または障害者：180万円未満
 * - 19歳以上23歳未満（被保険者の配偶者を除く）：150万円未満
 * 年齢は認定日が属する年の12月31日時点で判定する。同居・続柄の要件は担当者が判断する。
 */
export function judgeDependent(f: DependentFacts) {
  const age = ageAtYearEnd(f.birthDate, f.eventDate);
  let limit = 1_300_000;
  let basis = '原則の基準（130万円未満）';
  if (age >= 60 || f.isDisabled) {
    limit = 1_800_000;
    basis = f.isDisabled ? '障害者の基準（180万円未満）' : '60歳以上の基準（180万円未満）';
  } else if (age >= 19 && age < 23 && f.relationship !== 'spouse') {
    limit = 1_500_000;
    basis = '19歳以上23歳未満の基準（150万円未満）';
  }
  const overLimit = f.income >= limit;
  const notes: string[] = [];
  // 75歳以上は後期高齢者医療制度に入るため、健康保険の被扶養者になれない
  const lateElderly = f.eventDate >= nthBirthday(f.birthDate, 75);
  if (lateElderly) notes.push('75歳以上のため後期高齢者医療制度に加入し、扶養には入れません');
  const needsCoResidence = f.relationship === 'other';
  if (needsCoResidence && !f.coResident) notes.push('この続柄は同居していることが要件です。別居なら扶養に入れません');
  if (!f.coResident && !needsCoResidence) notes.push('別居の場合、収入が仕送り額より少ないことも要件です（仕送りの証明が要ります）');
  // 国民年金の第3号被保険者（20歳以上60歳未満の配偶者）の届出を兼ねる
  const thirdInsured = f.relationship === 'spouse' && f.eventDate >= nthBirthday(f.birthDate, 20) && f.eventDate < nthBirthday(f.birthDate, 60);
  if (thirdInsured) notes.push('20歳以上60歳未満の配偶者のため、国民年金第3号被保険者の届出も兼ねます');
  return { ageAtYearEnd: age, limit, basis, overLimit, lateElderly, needsCoResidence, thirdInsured, notes };
}

export type DependentJudgement = ReturnType<typeof judgeDependent>;

/** 届出の期限：事実の発生から5日以内（初日は数えない。いちばん早い異動日から数える） */
export function dependentFilingDeadline(eventDates: string[]): string | null {
  if (!eventDates.length) return null;
  return addDays([...eventDates].sort()[0], 5);
}

/** 添えて出す書類の目安（個人番号で確認できる場合は省略できるものがある） */
export function attachmentHints(items: { kind: ChangeKind; relationship: Relationship; coResident: boolean; reason: string }[]): string[] {
  const hints = new Set<string>();
  for (const i of items) {
    if (i.kind === 'add') {
      hints.add('続柄の確認書類（戸籍謄本など。被保険者と被扶養者の個人番号が届出に書かれていれば省略できます）');
      hints.add('収入の確認書類（課税（非課税）証明書、退職証明書、雇用保険の受給資格者証など）。16歳未満の子と、在学中の16歳以上の子は不要です');
      if (!i.coResident) hints.add('別居の場合：仕送りの事実と額が分かる書類（振込の控えなど）');
      if (i.relationship === 'other') hints.add('同居が要件の続柄：住民票（個人番号で確認できれば省略できます）');
    }
    if (i.kind === 'remove' && i.reason.startsWith('就職')) hints.add('扶養から外れる人の健康保険証（回収できる場合）');
  }
  return [...hints];
}
