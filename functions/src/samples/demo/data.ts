// 評価用のテストデータ（docs/test-data-plan.md）。事業所3か所・従業員300人。番号は架空だが、形と検査用数字は本物どおりにする
import { corporateCheckDigit, myNumberCheckDigit } from '../../utils/check-digit';
import { Role } from '../../middleware/auth';
import { samplePlayers } from '../tigers/data';

export const DEMO_SET_ID = 'demo-v1';
/** 基準日。年齢・在籍の計算に使う（作り直しても同じデータになるよう固定） */
export const DEMO_TODAY = '2026-11-01';
/** 入社の手続きで本人の入力を確かめる人のために空けておく番号（台帳は入社の手続きで作る） */
export const DEMO_RESERVED_NUMBER = 12;

export const DEMO_COMPANY = { corporateNumber: corporateCheckDigit('234567890123') + '234567890123', postalCode: '150-0001' };

export interface DemoOffice {
  id: string;
  name: string;
  /** 事業所整理記号 */
  officeNumber: string;
  /** 事業所番号（5桁） */
  officeCode: string;
  prefectureCode: string;
  insurerId: string;
  healthInsuranceType: 'kyokai' | 'union';
  pensionOfficeName: string;
  postalCode: string;
  address: string;
  phone: string;
  paymentMonth: 'current' | 'next';
  deductionMethod: 'current' | 'previous';
  appliedDate: string;
  bonusMonths: number[];
  /** 住所に使う町（郵便番号・市区町村・町名） */
  towns: [string, string, string][];
}

export const DEMO_OFFICES: DemoOffice[] = [
  {
    id: 'office-hq', name: '本社', officeNumber: '12-パトス', officeCode: '21541', prefectureCode: '13', insurerId: '01130012',
    healthInsuranceType: 'kyokai', pensionOfficeName: '渋谷年金事務所', postalCode: '150-0001',
    address: '東京都渋谷区神宮前1-2-3 パトスビル5F', phone: '03-1234-5678', paymentMonth: 'current', deductionMethod: 'current',
    appliedDate: '2012-04-01', bonusMonths: [7, 12],
    towns: [['150-0001', '渋谷区', '神宮前'], ['154-0024', '世田谷区', '三軒茶屋'], ['166-0004', '杉並区', '阿佐谷南'], ['164-0001', '中野区', '中野'],
      ['135-0061', '江東区', '豊洲'], ['140-0014', '品川区', '大井'], ['176-0012', '練馬区', '豊玉北'], ['180-0004', '武蔵野市', '吉祥寺本町']],
  },
  {
    id: 'office-osaka', name: '大阪支社', officeNumber: '21-パトス', officeCode: '30412', prefectureCode: '27', insurerId: '01270016',
    healthInsuranceType: 'kyokai', pensionOfficeName: '天満年金事務所', postalCode: '530-0001',
    address: '大阪府大阪市北区梅田2-4-6 グランドタワー10F', phone: '06-9876-5432', paymentMonth: 'current', deductionMethod: 'previous',
    appliedDate: '2016-10-01', bonusMonths: [7, 12],
    towns: [['530-0001', '大阪市北区', '梅田'], ['541-0053', '大阪市中央区', '本町'], ['564-0063', '吹田市', '江坂町'], ['560-0021', '豊中市', '本町'],
      ['590-0078', '堺市堺区', '南瓦町'], ['577-0056', '東大阪市', '長堂']],
  },
  {
    id: 'office-union', name: '新宿事業所', officeNumber: '11-パトス', officeCode: '21542', prefectureCode: '13', insurerId: '06139901',
    healthInsuranceType: 'union', pensionOfficeName: '新宿年金事務所', postalCode: '160-0022',
    address: '東京都新宿区新宿4-1-6 テスト新宿ビル8F', phone: '03-1234-5690', paymentMonth: 'current', deductionMethod: 'previous',
    appliedDate: '2020-04-01', bonusMonths: [6, 12],
    towns: [['160-0022', '新宿区', '新宿'], ['169-0075', '新宿区', '高田馬場'], ['171-0022', '豊島区', '南池袋'], ['173-0004', '板橋区', '板橋']],
  },
];

/** 部署（事業所ごと。並びは sortOrder の順） */
/** weight は人の入りやすさ（営業・開発が多く、管理部門は少ない） */
export const DEMO_DEPARTMENTS: { id: string; officeId: string; name: string; weight: number }[] = [
  { id: 'dept-hq-general', officeId: 'office-hq', name: '総務部', weight: 2 },
  { id: 'dept-hq-hr', officeId: 'office-hq', name: '人事部', weight: 1 },
  { id: 'dept-hq-accounting', officeId: 'office-hq', name: '経理部', weight: 2 },
  { id: 'dept-hq-sales', officeId: 'office-hq', name: '営業部', weight: 5 },
  { id: 'dept-hq-dev', officeId: 'office-hq', name: '開発部', weight: 6 },
  { id: 'dept-osaka-sales', officeId: 'office-osaka', name: '営業部', weight: 3 },
  { id: 'dept-osaka-ops', officeId: 'office-osaka', name: '業務部', weight: 2 },
  { id: 'dept-union-sales', officeId: 'office-union', name: '営業部', weight: 2 },
  { id: 'dept-union-support', officeId: 'office-union', name: 'カスタマーサポート部', weight: 3 },
];

/** アカウントのある人（test1〜11）の部署。労務の担当者は人事部・業務部に置く */
const ACCOUNT_DEPARTMENT: Record<number, string> = {
  1: 'dept-hq-hr', 2: 'dept-hq-hr', 3: 'dept-osaka-ops', 4: 'dept-hq-sales', 5: 'dept-osaka-ops', 6: 'dept-hq-general',
  7: 'dept-hq-accounting', 8: 'dept-osaka-sales', 9: 'dept-union-support', 10: 'dept-hq-dev', 11: 'dept-osaka-sales',
};

/** test1〜9 のアカウント（課題管理アプリと共通。表示名は変えない）。所属・ロール・担当の事業所 */
export const DEMO_ACCOUNTS: Record<number, { officeId: string; roles: Role[]; officeIds: string[] }> = {
  1: { officeId: 'office-hq', roles: ['admin'], officeIds: ['office-hq', 'office-osaka', 'office-union'] },
  2: { officeId: 'office-hq', roles: ['operator'], officeIds: ['office-hq'] },
  3: { officeId: 'office-osaka', roles: ['operator'], officeIds: ['office-osaka', 'office-union'] },
  4: { officeId: 'office-hq', roles: ['employee'], officeIds: ['office-hq'] },
  5: { officeId: 'office-osaka', roles: ['viewer'], officeIds: ['office-osaka'] },
  6: { officeId: 'office-hq', roles: ['approver'], officeIds: ['office-hq', 'office-osaka', 'office-union'] },
  7: { officeId: 'office-hq', roles: ['approver', 'employee'], officeIds: ['office-hq', 'office-osaka', 'office-union'] },
  8: { officeId: 'office-osaka', roles: ['employee'], officeIds: ['office-osaka'] },
  9: { officeId: 'office-union', roles: ['employee'], officeIds: ['office-union'] },
};

/** 人数（アカウントの人を含む） */
const OFFICE_SIZE: Record<string, number> = { 'office-hq': 170, 'office-osaka': 80, 'office-union': 50 };

const LAST: [string, string][] = [
  ['佐藤', 'サトウ'], ['鈴木', 'スズキ'], ['高橋', 'タカハシ'], ['田中', 'タナカ'], ['伊藤', 'イトウ'], ['渡辺', 'ワタナベ'], ['山本', 'ヤマモト'],
  ['中村', 'ナカムラ'], ['小林', 'コバヤシ'], ['加藤', 'カトウ'], ['吉田', 'ヨシダ'], ['山田', 'ヤマダ'], ['佐々木', 'ササキ'], ['山口', 'ヤマグチ'],
  ['松本', 'マツモト'], ['井上', 'イノウエ'], ['木村', 'キムラ'], ['林', 'ハヤシ'], ['斎藤', 'サイトウ'], ['清水', 'シミズ'], ['山崎', 'ヤマザキ'],
  ['森', 'モリ'], ['池田', 'イケダ'], ['橋本', 'ハシモト'], ['阿部', 'アベ'], ['石川', 'イシカワ'], ['前川', 'マエカワ'], ['小川', 'オガワ'],
  ['岡田', 'オカダ'], ['長谷川', 'ハセガワ'], ['藤田', 'フジタ'], ['後藤', 'ゴトウ'], ['近藤', 'コンドウ'], ['村上', 'ムラカミ'], ['遠藤', 'エンドウ'],
  ['青木', 'アオキ'], ['坂口', 'サカグチ'],
];
const MALE: [string, string][] = [
  ['大輔', 'ダイスケ'], ['健太', 'ケンタ'], ['翔', 'ショウ'], ['拓也', 'タクヤ'], ['誠', 'マコト'], ['亮', 'リョウ'], ['修', 'オサム'], ['剛', 'ツヨシ'],
  ['涼', 'リョウ'], ['直樹', 'ナオキ'], ['和也', 'カズヤ'], ['浩二', 'コウジ'], ['悠斗', 'ユウト'], ['蓮', 'レン'], ['隆', 'タカシ'], ['達也', 'タツヤ'],
  ['雄一', 'ユウイチ'], ['陽介', 'ヨウスケ'], ['哲也', 'テツヤ'], ['俊介', 'シュンスケ'], ['光', 'ヒカル'], ['智也', 'トモヤ'], ['武', 'タケシ'],
];
const FEMALE: [string, string][] = [
  ['花子', 'ハナコ'], ['由美', 'ユミ'], ['美咲', 'ミサキ'], ['彩', 'アヤ'], ['恵', 'メグミ'], ['舞', 'マイ'], ['直美', 'ナオミ'], ['綾', 'アヤ'],
  ['葵', 'アオイ'], ['静香', 'シズカ'], ['陽子', 'ヨウコ'], ['真由', 'マユ'], ['さくら', 'サクラ'], ['結衣', 'ユイ'], ['千尋', 'チヒロ'], ['理恵', 'リエ'],
  ['香織', 'カオリ'], ['裕子', 'ユウコ'], ['愛', 'アイ'], ['楓', 'カエデ'],
];

export interface DemoDependent {
  key: string;
  lastName: string; firstName: string; lastNameKana: string; firstNameKana: string;
  birthDate: string; gender: 'male' | 'female'; relationship: 'spouse' | 'child'; income: number;
}

export interface DemoEmployee {
  id: string;
  /** メールアドレス test{n} と社員番号の番号 */
  n: number;
  employeeNumber: string;
  email: string;
  officeId: string;
  departmentId: string;
  lastName: string; firstName: string; lastNameKana: string; firstNameKana: string;
  gender: 'male' | 'female';
  birthDate: string;
  hireDate: string;
  myNumber: string;
  basicPensionNumber: string;
  insuredPersonNumber: string;
  postalCode: string; prefecture: string; city: string; addressLine: string;
  phone: string;
  insuredCategory: 'general' | 'partTimer' | 'shortTime';
  weeklyHours: number;
  contract: { type: 'indefinite' | 'fixed'; endDate: string | null };
  baseSalary: number;
  longTermCare: boolean;
  dependents: DemoDependent[];
  /** どの場面を確かめるための人か */
  note: string;
}

const pad = (v: number, len = 2) => String(v).padStart(len, '0');
const PREFECTURE: Record<string, string> = { '13': '東京都', '27': '大阪府' };

/** 基準日の満年齢 */
export function ageOn(birthDate: string, today = DEMO_TODAY): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function demoMyNumber(n: number): string {
  const first11 = `1234567${pad(n, 4)}`;
  return first11 + myNumberCheckDigit(first11);
}

/** 年齢到達などの場面を確かめる人（アカウントのない人の先頭に置く） */
const SPECIAL: { birthDate: string; note: string }[] = [
  { birthDate: '1986-12-10', note: '12月に40歳（介護保険が始まる）' },
  { birthDate: '1961-12-05', note: '12月に65歳（介護保険の第1号へ）' },
  { birthDate: '1956-12-20', note: '12月に70歳（厚生年金の資格喪失）' },
  { birthDate: '1951-12-15', note: '12月に75歳（健康保険の資格喪失）' },
  { birthDate: '1953-05-01', note: '70歳以上の在職者' },
];

/** 300人分。番号は test1〜301（12 は入社の手続き用に空ける）。事業所ごとの整理番号は 1 からの連番 */
export function buildDemoEmployees(): DemoEmployee[] {
  const players = new Map(samplePlayers.map(p => [p.n, p]));
  const counts: Record<string, number> = {};
  const people: DemoEmployee[] = [];
  const others = OFFICE_SIZE['office-hq'] + OFFICE_SIZE['office-osaka'] + OFFICE_SIZE['office-union'] - 11;
  let j = 0;
  for (let n = 1; people.length < others + 11; n++) {
    if (n === DEMO_RESERVED_NUMBER) continue;
    const player = players.get(n);
    const account = DEMO_ACCOUNTS[n];
    let officeId: string;
    let name: { last: [string, string]; first: [string, string] };
    let gender: 'male' | 'female';
    let birthDate: string;
    let note: string;
    let k = -1;
    if (player && account) {
      officeId = account.officeId;
      name = { last: [player.last, player.kanaLast], first: [player.first, player.kanaFirst] };
      gender = 'male';
      birthDate = player.birth;
      note = `test${n} のアカウント（${account.roles.join('・')}）`;
    } else if (n === 10) {
      officeId = 'office-hq';
      name = { last: ['山本', 'ヤマモト'], first: ['さくら', 'サクラ'] };
      gender = 'female';
      birthDate = '1994-06-15';
      note = 'test10：本人ポータルから産休・育休を申請する人';
    } else if (n === 11) {
      officeId = 'office-osaka';
      name = { last: ['西田', 'ニシダ'], first: ['健一', 'ケンイチ'] };
      gender = 'male';
      birthDate = '1988-09-03';
      note = 'test11：退職させて、退職後の閲覧期間とアカウントの停止を確かめる人';
    } else {
      k = j++;
      const hqOthers = OFFICE_SIZE['office-hq'] - 6;
      const osakaOthers = OFFICE_SIZE['office-osaka'] - 4;
      officeId = k < hqOthers ? 'office-hq' : k < hqOthers + osakaOthers ? 'office-osaka' : 'office-union';
      gender = k % 5 === 1 || k % 5 === 3 ? 'female' : 'male';
      const firsts = gender === 'male' ? MALE : FEMALE;
      name = { last: LAST[(k * 7) % LAST.length], first: firsts[Math.floor(k / LAST.length + k * 3) % firsts.length] };
      const special = SPECIAL[k];
      birthDate = special?.birthDate ?? `${1960 + (k * 7) % 44}-${pad((k * 5) % 12 + 1)}-${pad((k * 3) % 28 + 1)}`;
      note = special?.note ?? '';
    }
    const office = DEMO_OFFICES.find(o => o.id === officeId)!;
    counts[officeId] = (counts[officeId] ?? 0) + 1;
    const insuredCategory = k >= 5 && k % 15 === 7 ? 'partTimer' : k >= 5 && k % 23 === 11 ? 'shortTime' : 'general';
    const base = n === 6 ? 500_000 : player ? 300_000 : 200_000 + ((n * 37) % 41) * 10_000;
    const scale = insuredCategory === 'partTimer' ? 0.6 : insuredCategory === 'shortTime' ? 0.45 : 1;
    const birthYear = Number(birthDate.slice(0, 4));
    const hireYear = Math.min(2026, Math.max(2008 + (n % 19), birthYear + 22));
    const town = office.towns[n % office.towns.length];
    const age = ageOn(birthDate);
    const dependents: DemoDependent[] = [];
    const lastName = name.last[0], lastNameKana = name.last[1];
    if (k >= 0 && k % 6 === 2 && age >= 28) {
      const spouseFemale = gender === 'male';
      const sf = (spouseFemale ? FEMALE : MALE)[(k + 5) % (spouseFemale ? FEMALE.length : MALE.length)];
      dependents.push({ key: 'spouse', lastName, firstName: sf[0], lastNameKana, firstNameKana: sf[1], birthDate: `${birthYear + 2}-${pad((k * 7) % 12 + 1)}-${pad((k * 5) % 28 + 1)}`, gender: spouseFemale ? 'female' : 'male', relationship: 'spouse', income: 0 });
    }
    if (k >= 0 && k % 10 === 4 && age >= 30) {
      const childMale = k % 20 === 4;
      const cf = (childMale ? MALE : FEMALE)[(k + 9) % (childMale ? MALE.length : FEMALE.length)];
      dependents.push({ key: 'child', lastName, firstName: cf[0], lastNameKana, firstNameKana: cf[1], birthDate: `${Math.min(2024, birthYear + 30)}-${pad((k * 3) % 12 + 1)}-${pad((k * 7) % 28 + 1)}`, gender: childMale ? 'male' : 'female', relationship: 'child', income: 0 });
    }
    // 重みの数だけ並べた中から順に割り振る（営業部・開発部に多めに入る）
    const slots = DEMO_DEPARTMENTS.filter(d => d.officeId === officeId).flatMap(d => Array.from({ length: d.weight }, () => d.id));
    const departmentId = ACCOUNT_DEPARTMENT[n] ?? slots[(k * 7 + 3) % slots.length];
    people.push({
      id: `demo-${pad(n, 4)}`, n, employeeNumber: pad(n, 4), email: `test${n}@example.com`, officeId, departmentId,
      lastName, firstName: name.first[0], lastNameKana, firstNameKana: name.first[1], gender, birthDate,
      hireDate: `${hireYear}-04-01`,
      myNumber: demoMyNumber(n),
      basicPensionNumber: `9000-${pad(n, 6)}`,
      insuredPersonNumber: String(counts[officeId]),
      postalCode: town[0], prefecture: PREFECTURE[office.prefectureCode], city: town[1], addressLine: `${town[2]}${(n % 5) + 1}-${(n % 20) + 1}-${(n % 9) + 1}（テスト）`,
      phone: `090-0000-${pad(n, 4)}`,
      insuredCategory,
      weeklyHours: insuredCategory === 'partTimer' ? 30 : insuredCategory === 'shortTime' ? 25 : 40,
      contract: k >= 0 && k % 9 === 4 ? { type: 'fixed', endDate: '2027-03-31' } : { type: 'indefinite', endDate: null },
      baseSalary: Math.round(base * scale / 1000) * 1000,
      longTermCare: age >= 40 && age < 65,
      dependents,
      note: [note, insuredCategory === 'partTimer' ? 'パート' : insuredCategory === 'shortTime' ? '短時間労働者' : '', k >= 0 && k % 9 === 4 ? '有期契約（2027年3月末まで）' : '']
        .filter(Boolean).join('・'),
    });
  }
  return people;
}
