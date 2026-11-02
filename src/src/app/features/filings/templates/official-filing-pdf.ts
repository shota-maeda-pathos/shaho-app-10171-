import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Font as FontKitFont } from '@pdf-lib/fontkit';

export interface FilingPrintMeta {
  companyName: string;
  officeName: string;
  officeNumber: string;
  officeAddress: string;
  officePhone: string;
  representativeName: string;
  effectiveDate: string;
  employeeNumber?: string;
  /** 社会保険労務士記載欄（例：「山田 花子（登録番号 13000001）」）。委託していなければ空 */
  laborConsultant?: string;
}

export const OFFICIAL_FORMS: Record<string, { file: string; title: string; source: string }> = {
  acquisitionNotification: { file: 'acquisition', title: '被保険者資格取得届', source: 'hihokensha/20140718.html' },
  lossNotification: { file: 'loss', title: '被保険者資格喪失届', source: 'hihokensha/20140722.html' },
  remunerationMonthlyAlgorithm: { file: 'santei', title: '被保険者報酬月額算定基礎届', source: 'hoshu/20141225.html' },
  remunerationMonthlyChange: { file: 'change', title: '被保険者報酬月額変更届', source: 'hoshu/20141224.html' },
  bonusPayment: { file: 'bonus', title: '被保険者賞与支払届', source: 'shoyo/20140821.html' },
  bonusNonPayment: { file: 'bonus-non-payment', title: '賞与不支給報告書', source: 'shoyo/20140821.html' },
  dependentChange: { file: 'dependent', title: '被扶養者（異動）届', source: 'hihokensha/20141224.html' },
  maternityLeaveStart: { file: 'maternity', title: '産前産後休業取得者申出書', source: 'menjo/20140326-01.html' },
  childcareLeaveStart: { file: 'childcare', title: '育児休業等取得者申出書', source: 'menjo/20140403-01.html' },
  maternityLeaveChange: { file: 'maternity', title: '産前産後休業取得者変更（終了）届', source: 'menjo/20140326-01.html' },
  childcareLeaveEnd: { file: 'childcare-end', title: '育児休業等取得者終了届', source: 'menjo/20140403-02.html' },
  maternityLeaveEndChange: { file: 'maternity-end-change', title: '産前産後休業終了時報酬月額変更届', source: 'menjo/20140327-01.html' },
  childcareLeaveEndChange: { file: 'childcare-end-change', title: '育児休業等終了時報酬月額変更届', source: 'menjo/20140626-01.html' },
  pensionLoss70: { file: 'pension-loss-70', title: '厚生年金保険 被保険者資格喪失届・70歳以上被用者該当届', source: 'hihokensha/20140218.html' },
};

type Data = Record<string, unknown>;
type Box = [x: number, top: number, width: number, height: number];
export interface PrintPlacement { page: number; label: string; text: string; box: Box; inkBox: Box; align: 'left' | 'center' | 'right' }
export interface OfficialPdfResult {
  bytes: Uint8Array;
  warnings: string[];
  placements: PrintPlacement[];
}

// Coordinates are measured on the original PDF at 160% (953 x 1347).
// Keep the original MediaBox, CropBox, barcode, explanatory page and printed labels.
class Writer {
  private readonly characters: Set<number>;
  constructor(readonly page: PDFPage, readonly font: PDFFont, readonly warnings: Set<string>,
    readonly placements: PrintPlacement[], readonly index: number, readonly metrics: FontKitFont) { this.characters = new Set(font.getCharacterSet()); }

  text(value: unknown, box: Box, label: string, options: { size?: number; required?: boolean; right?: boolean; center?: boolean } = {}) {
    const text = value == null ? '' : String(value).replace(/[\r\n\t]+/g, ' ').trim();
    if (!text) {
      if (options.required) this.warnings.add(`${label}が未登録です。`);
      return;
    }
    if ([...text].some(char => !this.characters.has(char.codePointAt(0)!))) {
      throw new Error(`${label}に出力できない文字が含まれています。`);
    }
    let size = options.size ?? 10;
    const [x, top, width, height] = box.map(v => v / 1.6);
    let advance = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const glyph of this.metrics.layout(text).glyphs) {
      if (glyph.bbox.width || glyph.bbox.height) {
        minX = Math.min(minX, advance + glyph.bbox.minX); maxX = Math.max(maxX, advance + glyph.bbox.maxX);
        minY = Math.min(minY, glyph.bbox.minY); maxY = Math.max(maxY, glyph.bbox.maxY);
      }
      advance += glyph.advanceWidth;
    }
    if (!Number.isFinite(minX)) return;
    const inkWidth = (maxX - minX) / this.metrics.unitsPerEm;
    const inkHeight = (maxY - minY) / this.metrics.unitsPerEm;
    while (size > 5 && (inkWidth * size > width - 2 || inkHeight * size > height - 2)) size -= .25;
    if (inkWidth * size > width - 2 || inkHeight * size > height - 2) {
      throw new Error(`${label}が記入欄に収まりません。入力内容を確認してください。`);
    }
    const media = this.page.getMediaBox();
    const scale = size / this.metrics.unitsPerEm;
    const inkLeft = x + (options.right ? width - inkWidth * size - 1 : options.center ? (width - inkWidth * size) / 2 : 1);
    const baseline = media.y + media.height - top - height / 2 - (minY + maxY) * scale / 2;
    this.page.drawText(text, {
      x: media.x + inkLeft - minX * scale,
      y: baseline,
      size, font: this.font, color: rgb(0, 0, 0),
    });
    this.placements.push({ page: this.index, label, text, box,
      inkBox: [inkLeft * 1.6, (media.y + media.height - baseline - maxY * scale) * 1.6, inkWidth * size * 1.6, inkHeight * size * 1.6],
      align: options.right ? 'right' : options.center ? 'center' : 'left' });
  }

  digits(value: unknown, box: Box, count: number, label: string, required = false) {
    const text = value == null ? '' : String(value).replace(/[\s-]/g, '');
    if (!text) { if (required) this.warnings.add(`${label}が未登録です。`); return; }
    if (!new RegExp(`^\\d{${count}}$`).test(text)) {
      this.warnings.add(`${label}は${count}桁の数字が必要です。現在の値は記入していません。`);
      return;
    }
    [...text].forEach((digit, i) => this.text(digit, [box[0] + box[2] * i / count, box[1], box[2] / count, box[3]], label, { size: 10, center: true }));
  }

  cells(value: unknown, box: Box, count: number, label: string, right = false) {
    const text = value == null ? '' : String(value).trim();
    if ([...text].length > count) { this.warnings.add(`${label}が桁枠に収まらないため空欄にしています。`); return; }
    const characters = [...text];
    characters.forEach((digit, i) => this.text(digit,
      [box[0] + box[2] * (i + (right ? count - characters.length : 0)) / count, box[1], box[2] / count, box[3]],
      label, { size: 10, center: true }));
  }

  circle(x: number, top: number, width = 12, height = 12) {
    const media = this.page.getMediaBox();
    this.page.drawEllipse({ x: media.x + x / 1.6, y: media.y + media.height - top / 1.6,
      xScale: width / 3.2, yScale: height / 3.2, borderWidth: .6, borderColor: rgb(0, 0, 0) });
  }

  money(value: unknown, box: Box, label: string, thousands = false, required = false) {
    if (value == null || value === '') { if (required) this.warnings.add(`${label}が未登録です。`); return; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      this.warnings.add(`${label}の金額を確認してください。現在の値は記入していません。`); return;
    }
    this.text((thousands ? Math.floor(value / 1000) : value).toLocaleString('ja-JP'), box, label, { right: true, size: 9 });
  }
}

function parseDate(value: unknown): { year: number; month: number; day: number; era: number; eraYear: number; name: string } | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const era = value >= '2019-05-01' ? 9 : value >= '1989-01-08' ? 7 : value >= '1926-12-25' ? 5 : 0;
  if (!era) return null;
  return { year, month, day, era, eraYear: year - (era === 9 ? 2018 : era === 7 ? 1988 : 1925), name: era === 9 ? '令和' : era === 7 ? '平成' : '昭和' };
}

function eraText(value: unknown): string {
  const d = parseDate(value);
  return d ? `${d.era}-${String(d.eraYear).padStart(2,'0')}${String(d.month).padStart(2,'0')}${String(d.day).padStart(2,'0')}` : '';
}

function dateParts(w: Writer, value: unknown, boxes: [Box, Box, Box], label: string,
  era?: { x: number; showa: number; heisei: number; reiwa: number }) {
  const d = parseDate(value);
  if (!d || (!era && d.era !== 9)) { w.warnings.add(`${label}が未登録、または様式に記入できない日付です。`); return; }
  if (era) w.circle(era.x, d.era === 5 ? era.showa : d.era === 7 ? era.heisei : era.reiwa, 12, 11);
  [d.eraYear, d.month, d.day].forEach((v, i) => w.digits(String(v).padStart(2, '0'), boxes[i], 2, label));
}

function names(w: Writer, data: Data, boxes: [Box, Box], kanaBoxes?: [Box, Box]) {
  const split = (value: unknown): [string, string] => {
    const parts = String(value ?? '').trim().split(/[\s　]+/);
    return [parts[0] ?? '', parts.slice(1).join(' ')];
  };
  const name = split(data['被保険者氏名']);
  name.forEach((value, i) => w.text(value, boxes[i], '被保険者氏名', { required: true, center: true }));
  if (kanaBoxes) split(data['被保険者氏名フリガナ']).forEach((value, i) => {
    const box = [...kanaBoxes[i]] as Box;
    if (i === 0) { box[0] += 38; box[2] -= 38; }
    w.text(value, box, '氏名フリガナ', { size: 7, required: true, center: true });
  });
}

interface HeaderLayout {
  date: [Box, Box, Box];
  symbol: [Box, Box];
  number?: Box;
  address: Box;
  name: Box;
  representative: Box;
  phone: [Box, Box, Box];
  /** 社会保険労務士記載欄の「氏名等」の右（2026-10-31 様式の文字の位置から測り、枠に収まることを画面で確認） */
  consultant?: Box;
}
const CONSULTANT: Record<string, Box> = {
  acquisition: [593, 270, 295, 56], loss: [619, 279, 270, 56], change: [590, 263, 290, 54],
  santei: [617, 307, 275, 50], bonus: [600, 307, 280, 46], dependent: [600, 270, 280, 50],
};
const HEADERS: Record<string, HeaderLayout> = {
  acquisition: { date: [[84,101,29,13],[133,101,28,13],[179,101,28,13]], symbol:[[113.36,118.78,82.94,29.18],[210.13,118.78,82.94,29.18]], number:[348.37,118.78,138.24,29.18], address:[117,181,366,45], name:[117,243,366,33], representative:[117,288,366,28], phone:[[172,321,65,19],[253,321,95,19],[365,321,65,19]] },
  loss: { date:[[124,89,31,13],[185,89,29,13],[248,89,27,13]], symbol:[[123.06,105.44,101.37,27.46],[241.33,105.44,101.37,27.46]], number:[384.94,105.44,126.72,27.46], address:[128,169,379,43], name:[128,233,379,31], representative:[128,279,379,30], phone:[[175,326,65,19],[266,326,93,19],[378,326,65,19]] },
  change: { date:[[137,91,35,13],[200,91,21,13],[245,91,20,13]], symbol:[[145.62,110.6,87.55,31.1],[255.06,110.6,87.55,31.1]], address:[149,176,322,35], name:[149,231,322,28], representative:[149,273,322,23], phone:[[163,304,57,19],[240,304,65,19],[325,304,60,19]] },
  santei: { date:[[81,88,35,13],[141,88,28,13],[190,88,28,13]], symbol:[[118.06,103.31,92.93,39.17],[234.03,103.31,92.55,39.17]], address:[123,178,370,46], name:[123,257,370,29], representative:[123,310,370,28], phone:[[130,351,64,19],[213,351,83,19],[314,351,79,19]] },
  bonus: { date:[[59,83,26,13],[109,83,27,13],[161,83,34,13]], symbol:[[107.5,97.16,93.7,39.55],[226.54,97.16,90.82,39.55]], address:[113,180,367,65], name:[113,270,367,29], representative:[113,312,367,26], phone:[[125,342,67,19],[213,342,76,19],[317,342,80,19]] },
  dependent: { date:[[85,83,34,13],[141,83,33,13],[194,83,30,13]], symbol:[[155.6,97.74,101.57,32.26],[281.36,97.74,94.46,32.26]], address:[160,181,346,35], name:[160,229,346,29], representative:[160,277,346,24], phone:[[163,307,59,19],[246,307,69,19],[336,307,74,19]] },
  maternity: { date:[[122,146,28,13],[167,146,28,13],[210,146,28,13]], symbol:[[156.46,163.4,87.56,32.26],[265.9,163.4,87.56,32.26]], address:[161,235,321,40], name:[161,289,321,28], representative:[161,339,321,28], phone:[[178,374,53,19],[250,374,66,19],[345,374,63,19]] },
  'pension-loss-70': { date:[[108,145,55,14],[175,145,32,14],[218,145,30,14]], symbol:[[167,164,88,30],[277,164,85,30]], number:[408,164,109,30], address:[168,215,348,45], name:[168,285,348,35], representative:[168,345,348,30], phone:[[170,392,70,16],[252,392,80,16],[340,392,70,16]] },
  'maternity-end-change': { date:[[130,151,37,13],[181,151,28,13],[224,151,26,13]], symbol:[[175,172,83,26],[280,172,82,26]], address:[176,232,305,30], name:[176,288,305,28], representative:[176,340,305,28], phone:[[180,380,55,19],[262,380,65,19],[345,380,60,19]] },
  'childcare-end-change': { date:[[120,151,37,13],[172,151,28,13],[214,151,26,13]], symbol:[[165,172,83,26],[270,172,82,26]], address:[166,232,305,30], name:[166,288,305,28], representative:[166,340,305,28], phone:[[170,380,55,19],[252,380,65,19],[335,380,60,19]] },
  // 賞与不支給報告書：日付の欄は罫線がないため「令和」「年」「月」「日」の文字の間に書く。整理記号は4マス×2、事業所番号は5マス
  'bonus-non-payment': { date:[[80,127,38,15],[138,127,36,15],[194,127,36,15]], symbol:[[150.5,147.3,90.1,36.7],[261.7,147.3,90.5,36.7]], number:[420.6,147.3,117,36.7], address:[152,215,380,48], name:[152,276,380,40], representative:[152,323,380,24], phone:[[158,381,70,16],[240,381,68,16],[318,381,80,16]] },
  childcare: { date:[[86,145,37,13],[143,145,31,13],[190,145,30,13]], symbol:[[133.42,163.4,94.47,36.1],[251.5,163.4,94.47,36.1]], address:[140,238,345,41], name:[140,300,345,28], representative:[140,348,345,26], phone:[[157,386,52,19],[237,386,63,19],[322,386,69,19]] },
};

function header(w: Writer, key: string, fd: Data, meta: FilingPrintMeta) {
  const h = HEADERS[key === 'childcare-end' ? 'childcare' : key];
  const submitted = parseDate(fd['届出年月日'] ?? meta.effectiveDate);
  if (submitted?.era === 9) [submitted.eraYear, submitted.month, submitted.day].forEach((value,i) =>
    w.text(value,h.date[i],'届出年月日',{size:8,center:true}));
  else w.warnings.add('届出年月日が未登録、または令和の日付ではありません。');
  // Existing drafts incorrectly copied officeNumber into this field. Never repeat it as a symbol.
  const symbol = fd['事業所整理記号'];
  if (typeof symbol === 'string' && symbol.trim() && symbol !== meta.officeNumber) {
    const parts = symbol.split(/[-－―ー]/);
    if (parts.length === 2 && parts.every(Boolean)) {
      w.cells(parts[0],h.symbol[0],4,'事業所整理記号',true);
      w.cells(parts[1],h.symbol[1],4,'事業所整理記号');
    } else w.warnings.add('事業所整理記号は番号と区別して確認してください。現在の値は記入していません。');
  } else w.warnings.add('事業所整理記号が未登録、または事業所番号と同じ値です。');
  if (h.number) w.digits(fd['事業所番号'] ?? meta.officeNumber,h.number,5,'事業所番号',true);
  w.text(fd['事業所所在地'] ?? meta.officeAddress,h.address,'事業所所在地',{ required:true });
  w.text(fd['事業所名称'] ?? meta.officeName,h.name,'事業所名称',{ required:true });
  w.text(fd['事業主氏名'] ?? meta.representativeName,h.representative,'事業主氏名',{ required:true });
  const phone = String(fd['電話番号'] ?? meta.officePhone ?? '').split('-');
  if (phone.length === 3) {
    phone.forEach((part,i)=>w.text(part,h.phone[i],'電話番号',{ size:9,center:true }));
  } else if (phone.join('')) w.warnings.add('電話番号を市外局番・市内局番・加入者番号に分けて登録してください。');
  else w.warnings.add('電話番号が未登録です。');
  // 社会保険労務士に届出を委託しているときだけ書く（カタログ1章）
  const consultant = fd['社会保険労務士'] ?? meta.laborConsultant;
  const box = CONSULTANT[key === 'childcare-end' ? 'childcare' : key];
  if (consultant && box) w.text(consultant, box, '社会保険労務士', { size: 9 });
}

function insuredNumber(w: Writer, value: unknown, box: Box) {
  const number = String(value ?? '');
  if (/^\d{1,6}$/.test(number)) w.text(number,box,'被保険者整理番号',{ size:10,center:true });
  else w.warnings.add('被保険者整理番号を確認してください。社員番号や英字入りの値は記入していません。');
}
function identifier(w: Writer, fd: Data, box: Box) {
  if (fd['個人番号']) w.digits(fd['個人番号'],box,12,'個人番号',true);
  else if (fd['基礎年金番号']) w.digits(fd['基礎年金番号'],[box[0],box[1],box[2]*10/12,box[3]],10,'基礎年金番号',true);
  else w.warnings.add('個人番号または基礎年金番号が未登録です。');
}

function acquisition(w: Writer, fd: Data) {
  insuredNumber(w,fd['被保険者整理番号'],[116,375,43,26]);
  names(w,fd,[[216,375,157,28],[382,375,156,28]],[[216,357,157,13],[382,357,156,13]]);
  dateParts(w,fd['生年月日'],[[624.85,353.08,41.47,56.64],[666.32,353.08,41.47,56.64],[707.79,353.08,41.47,56.64]],'生年月日',{x:604,showa:365,heisei:380,reiwa:396});
  if (fd['性別'] === '男' || fd['性別'] === 'male') w.circle(810,366,12,11);
  else if (fd['性別'] === '女' || fd['性別'] === 'female') w.circle(810,377,12,11);
  else w.warnings.add('被保険者種別を確認してください。');
  identifier(w,fd,[210.13,409.72,331.77,50.3]);
  dateParts(w,fd['資格取得年月日'],[[624.85,409.72,41.47,50.3],[666.32,409.72,41.47,50.3],[707.79,409.72,41.47,50.3]],'資格取得年月日');
  const category = ACQUISITION_CATEGORY[String(fd['取得区分'] ?? '')];
  if (category) w.circle(119,category==='1'?417:category==='3'?434:447,12,11);
  else w.warnings.add('取得区分の選択を確認してください（一般・新規などの文字は区分番号として記入しません）。');
  if (fd['被扶養者'] === '無') w.circle(ACQUISITION_DEPENDENT.none,ACQUISITION_DEPENDENT.top,12,11);
  else if (fd['被扶養者'] === '有') w.circle(ACQUISITION_DEPENDENT.some,ACQUISITION_DEPENDENT.top,12,11);
  w.money(fd['報酬月額_通貨'],[159,465,147,15],'報酬月額（通貨）',false,true);
  w.money(fd['報酬月額_現物'],[159,486,147,15],'報酬月額（現物）');
  const total = fd['報酬月額_合計'];
  if (typeof total === 'number' && Number.isSafeInteger(total) && total >= 0) w.cells(total,[334.06,477.11,186.62,26.11],9,'報酬月額合計',true);
  else w.warnings.add('報酬月額合計が未登録、または整数の金額ではありません。');
  for (const item of Array.isArray(fd['備考項目']) ? fd['備考項目'] : []) {
    const mark = ACQUISITION_REMARKS[String(item)];
    if (mark) w.circle(mark[0],mark[1],12,11);
  }
  const address = fd['被保険者住所'] ?? fd['住所'];
  w.text(address,[132,527,395,14],'被保険者住所');
  if (!fd['個人番号'] && !address) w.warnings.add('個人番号を記入しない場合は、被保険者の住所が必要です。');
}

/** 取得区分の番号。手続きの画面では加入する保険の文字で持つため、様式の番号（1. 健保・厚年 3. 共済出向 4. 船保任継）に直す */
const ACQUISITION_CATEGORY: Record<string, '1' | '3' | '4'> = {
  '1': '1', '3': '3', '4': '4', '健保・厚年': '1', '健保のみ': '1', '厚年のみ': '1', '新規': '1', '共済出向': '3', '船保任継': '4',
};
/** 被扶養者「0. 無」「1. 有」の丸の位置 */
const ACQUISITION_DEPENDENT = { none: 811, some: 880, top: 434 };
/** 備考「1. 70歳以上被用者該当」「2. 二以上事業所勤務者の取得」「3. 短時間労働者の取得」「4. 退職後の継続再雇用者の取得」の丸の位置 */
const ACQUISITION_REMARKS: Record<string, [number, number]> = { '1': [604, 475], '2': [604, 486], '3': [604, 497], '4': [777, 475] };

/** 喪失原因「7. 75歳到達（健康保険のみ喪失）」の丸の位置 */
const LOSS_75_MARK: [number, number] = [705, 441];

function loss(w: Writer, fd: Data) {
  insuredNumber(w,fd['被保険者整理番号'],[135,377,100,25]);
  names(w,fd,[[308,375,166,28],[483,375,160,28]],[[308,358,166,13],[483,358,160,13]]);
  dateParts(w,fd['生年月日'],[[739.76,356.15,50.69,58.37],[790.45,356.15,50.69,58.37],[841.14,356.15,50.68,58.37]],'生年月日',{x:706,showa:366,heisei:381,reiwa:397});
  identifier(w,fd,[131.5,414.52,304.13,63.36]);
  dateParts(w,fd['資格喪失年月日'],[[494.77,414.52,50.69,63.36],[545.46,414.52,50.68,63.36],[596.14,414.52,50.69,63.36]],'資格喪失年月日');
  const reason = String(fd['喪失原因'] ?? '');
  if (reason === '退職等' || reason === '4') w.circle(705,420,12,11);
  else if (reason === '死亡' || reason === '5') w.circle(705,431,12,11);
  else if (reason === '75歳到達' || reason === '7') w.circle(LOSS_75_MARK[0],LOSS_75_MARK[1],12,11);
  else w.warnings.add('喪失原因の選択を確認してください。');
}

/** lenient：算定基礎届（複数人）では、途中入社の月や従前で決めた人の平均額が空欄になるのは正しいため、未登録の警告を出さない */
function remuneration(w: Writer, fd: Data, regular: boolean, offset = 0, lenient = false) {
  const top = (regular ? 467 : 427) + offset;
  insuredNumber(w,fd['被保険者整理番号'],[regular?68:93,top+10,regular?98:106,23]);
  w.text(fd['被保険者氏名'],[regular?175:208,top+7,regular?255:211,23],'被保険者氏名',{required:true,center:true});
  w.text(eraText(fd['生年月日']),[regular?438:427,top+7,regular?119:175,22],'生年月日',{size:9,required:true,center:true});
  const effective = regular ? fd['対象年'] : String(fd['改定年月'] ?? '');
  const year = Number(String(effective).slice(0,4));
  if (year >= 2019) w.text(String(year-2018),[regular?579:620,top+15,regular?60:30,21],'適用年',{center:true});
  else w.warnings.add('適用年を確認してください。');
  if (!regular) w.text(String(Number(String(fd['改定年月'] ?? '').slice(5,7))),[668,top+15,22,21],'改定月',{center:true});
  const middle = (regular?507:459)+offset;
  w.money(fd['従前の標準報酬月額_健康保険'],[regular?79:105,middle+14,regular?67:77,18],'従前標準報酬（健康保険）',true);
  w.money(fd['従前の標準報酬月額_厚生年金'],[regular?186:220,middle+14,regular?69:75,18],'従前標準報酬（厚生年金）',true);
  for (let i=0;i<3;i++) {
    const prefix=regular?`${i+4}月`:`${i+1}月目`;
    const y=(regular?551:500)+offset+i*(regular?25.6:30.6);
    if (!regular) w.text(/^\d{4}-\d{2}$/.test(String(fd[`${prefix}_年月`]??'')) ? Number(String(fd[`${prefix}_年月`]).slice(5,7)) : '',[94,y,29,18],`${prefix}の支払月`,{size:9,center:true,required:true});
    w.text(fd[`${prefix}_支払基礎日数`],[regular?104:133,y,regular?70:63,18],`${prefix}の支払基礎日数`,{size:9,center:true,required:!lenient});
    w.money(fd[`${prefix}_通貨`],[regular?184:211,y,regular?91:89,18],`${prefix}の通貨報酬`,false,!lenient);
    w.money(fd[`${prefix}_現物`],[regular?287:322,y,regular?108:91,18],`${prefix}の現物報酬`);
    const cash=fd[`${prefix}_通貨`],kind=fd[`${prefix}_現物`];
    if(typeof cash==='number'&&typeof kind==='number') w.money(cash+kind,[regular?415:434,y,regular?95:97,18],`${prefix}の合計`);
  }
  w.money(fd['合計'],[regular?553:554,(regular?552:502)+offset,regular?114:131,18],'総計',false,!lenient);
  w.money(fd['平均額'],[regular?553:554,(regular?579:534)+offset,regular?114:131,18],'平均額',false,!lenient);
  if (!lenient) w.warnings.add('現物報酬・支払月・修正平均額・備考など、登録されていない欄は原票で確認してください。');
}

/**
 * 産前産後休業終了時・育児休業等終了時報酬月額変更届（1人1枚）。2つの様式は同じ並びで、育休の様式は約10px左にある。
 * 申出者欄は被保険者本人の申出を兼ねる（申出のチェックと日付・氏名を書く。住所は台帳にないため空欄）
 */
function leaveEndRemuneration(w: Writer, fd: Data, childcare: boolean) {
  const dx = childcare ? -10 : 0;
  const b = (x: number, top: number, width: number, height: number): Box => [x + dx, top, width, height];
  // 申出：本人の申出の日と氏名
  if (fd['申出年月日']) {
    w.text('レ', b(126, 411, 12, 12), '申出のチェック', { size: 9, center: true });
    const d = parseDate(fd['申出年月日']);
    if (d?.era === 9) [d.eraYear, d.month, d.day].forEach((v, i) => w.text(v, [b(690, 428, 33, 15), b(737, 428, 29, 15), b(780, 428, 29, 15)][i], '申出年月日', { size: 9, center: true }));
  } else w.warnings.add('本人の申出年月日が未登録です。');
  w.text(fd['被保険者氏名'], b(165, 521, 300, 18), '申出者氏名');
  w.warnings.add('申出者の住所・電話番号は台帳にないため空欄です。原票に記入してください。');

  insuredNumber(w, fd['被保険者整理番号'], b(166, 570, 92, 40));
  identifier(w, fd, b(322, 567, 298, 45));
  names(w, fd, [b(167, 630, 90, 25), b(259, 630, 92, 25)], [b(167, 609, 90, 11), b(259, 609, 92, 11)]);
  dateParts(w, fd['生年月日'], [b(473, 622, 40, 32), b(522, 622, 40, 32), b(571, 622, 40, 32)], '生年月日',
    { x: 444 + dx, showa: childcare ? 627 : 626, heisei: childcare ? 638 : 637, reiwa: childcare ? 649 : 648 });
  const child = String(fd['養育する子の氏名'] ?? '').trim().split(/[\s　]+/);
  if (child[0]) {
    w.text(child[0], b(167, 683, 90, 24), '子の氏名', { center: true });
    w.text(child.slice(1).join(' '), b(259, 683, 92, 24), '子の氏名', { center: true });
  } else w.warnings.add('養育する子の氏名が未登録です。');
  dateParts(w, fd['養育する子の生年月日'], [b(473, 673, 40, 32), b(522, 673, 40, 32), b(571, 673, 40, 32)], '子の生年月日',
    childcare ? { x: 444 + dx, showa: 0, heisei: 683, reiwa: 696 } : undefined);
  dateParts(w, fd['休業終了年月日'], [b(694, 673, 40, 32), b(743, 673, 40, 32), b(792, 673, 40, 32)], '休業終了年月日');

  for (let i = 0; i < 3; i++) {
    const p = `${i + 1}月目`;
    const top = 747 + 47 * i;
    const ymText = String(fd[`${p}_年月`] ?? '');
    w.text(/^\d{4}-\d{2}$/.test(ymText) ? Number(ymText.slice(5, 7)) : '', b(170, top, 34, 20), `${p}の支給月`, { size: 9, center: true, required: true });
    w.text(fd[`${p}_支払基礎日数`], b(218, top, 29, 20), `${p}の支払基礎日数`, { size: 9, center: true, required: true });
    w.money(fd[`${p}_通貨`], b(264, top, 88, 20), `${p}の通貨`, false, true);
    w.money(fd[`${p}_現物`], b(366, top, 109, 20), `${p}の現物`);
    const cash = fd[`${p}_通貨`], kind = fd[`${p}_現物`];
    if (typeof cash === 'number' && typeof kind === 'number') w.money(cash + kind, b(490, top, 120, 20), `${p}の合計`);
  }
  // 総計・平均額・修正平均額は1桁ずつの枠（9桁）
  const digits = (value: unknown, top: number, label: string, required: boolean) => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) w.cells(value, b(660, top, 170, 20), 9, label, true);
    else if (required) w.warnings.add(`${label}が未登録です。`);
  };
  digits(fd['合計'], 747, '総計', true);
  digits(fd['平均額'], 794, '平均額', true);
  digits(fd['修正平均額'], 841, '修正平均額', false);
  w.money(fd['従前の標準報酬月額_健康保険'], b(167, 893, 30, 15), '従前標準報酬（健康保険）', true);
  w.money(fd['従前の標準報酬月額_厚生年金'], b(212, 893, 27, 15), '従前標準報酬（厚生年金）', true);
  if (fd['昇降給区分'] === '昇給') w.circle(352 + dx, 891, 12, 11);
  else if (fd['昇降給区分'] === '降給') w.circle(397 + dx, 891, 12, 11);
  if (fd['遡及支払額'] != null) {
    const months = String(fd['遡及支払月'] ?? '').split('、')[0];
    if (/^\d{4}-\d{2}$/.test(months)) w.text(Number(months.slice(5, 7)), b(490, 893, 34, 15), '遡及支払月', { size: 9, center: true });
    w.money(fd['遡及支払額'], b(538, 893, 72, 15), '遡及支払額');
  }
  const effective = String(fd['改定年月'] ?? '');
  if (/^\d{4}-\d{2}$/.test(effective) && Number(effective.slice(0, 4)) >= 2019) {
    w.text(Number(effective.slice(0, 4)) - 2018, b(700, 892, 36, 16), '改定年', { size: 9, center: true });
    w.text(Number(effective.slice(5, 7)), b(760, 892, 44, 16), '改定月', { size: 9, center: true });
  } else w.warnings.add('改定年月を確認してください。');
  // 翌日から続けて産休・育休に入る人は、この届出を作れない（サーバーで止めている）
  w.text('レ', childcare ? [382, 1001, 12, 12] : [392, 1007, 12, 12], '月変該当の確認', { size: 9, center: true });
  w.warnings.add('給与の締切日・支払日と備考は、原票で確認してください。');
}

/** 元号の番号（昭和5・平成7・令和9）の枠と、年・月・日の2桁ずつの枠に日付を書く */
function eraDate(w: Writer, value: unknown, era: Box, parts: [Box, Box, Box], label: string) {
  const d = parseDate(value);
  if (!d) { w.warnings.add(`${label}が未登録、または様式に記入できない日付です。`); return; }
  w.text(d.era, era, label, { center: true });
  [d.eraYear, d.month, d.day].forEach((v, i) => w.digits(String(v).padStart(2, '0'), parts[i], 2, label));
}

/** 厚生年金保険 被保険者資格喪失届・70歳以上被用者該当届（喪失原因「6. 70歳到達」は様式に印刷済み） */
function pensionLoss70(w: Writer, fd: Data) {
  insuredNumber(w, fd['被保険者整理番号'], [170, 540, 103, 40]);
  w.text(fd['被保険者氏名'], [320, 540, 280, 40], '被保険者氏名', { required: true, center: true });
  eraDate(w, fd['生年月日'], [641, 520, 37, 80], [[678, 520, 74, 80], [752, 520, 73, 80], [825, 520, 72, 80]], '生年月日');
  identifier(w, fd, [168, 612, 437, 105]);
  eraDate(w, fd['資格喪失年月日'], [168, 735, 37, 90], [[205, 735, 72, 90], [277, 735, 73, 90], [350, 735, 72, 90]], '資格喪失年月日');
  eraDate(w, fd['該当年月日'], [168, 847, 37, 105], [[205, 847, 72, 105], [277, 847, 73, 105], [350, 847, 72, 105]], '該当年月日');
  w.money(fd['報酬月額_通貨'], [470, 866, 145, 20], '報酬月額（通貨）', false, true);
  w.money(fd['報酬月額_現物'], [470, 930, 145, 20], '報酬月額（現物）');
  const total = fd['報酬月額_合計'];
  if (typeof total === 'number' && Number.isSafeInteger(total) && total >= 0) w.cells(total, [635, 880, 262, 45], 9, '報酬月額合計', true);
  else w.warnings.add('報酬月額合計が未登録、または整数の金額ではありません。');
}

/** 賞与支払届の1人分（サーバーの bonusFilingPerson と同じ形） */
export interface BonusPrintPerson {
  被保険者整理番号: string; 被保険者氏名: string; 生年月日: string; 賞与支払年月日: string;
  賞与額_通貨: number; 賞与額_現物: number; 賞与額_合計: number;
  /** 1=70歳以上被用者 3=同一月内の賞与合算 */
  備考区分?: number[]; 初回支払日?: number | null;
}

/** 1枚に記入する人数と、1人分の欄の高さ（原票を160%で測った値） */
const BONUS_ROWS = 10;
const BONUS_ROW_HEIGHT = 77.87;
/** 備考の番号に付ける丸（1人目の位置） */
const BONUS_NOTE_MARKS: Record<number, [number, number]> = { 1: [697, 532], 3: [800, 532] };

/** 賞与支払届の1人分の行。支払日は共通の支払日と違うときだけ書く（様式の注記） */
function bonusRow(w: Writer, p: BonusPrintPerson, offset: number, commonDate: unknown) {
  insuredNumber(w,p.被保険者整理番号,[58,482+offset,175,29]);
  w.text(p.被保険者氏名,[242,479+offset,298,29],'被保険者氏名',{required:true,center:true});
  w.text(eraText(p.生年月日),[550,481+offset,126,24],'生年月日',{size:9,required:true,center:true});
  if (p.賞与支払年月日 && p.賞与支払年月日 !== commonDate) {
    dateParts(w,p.賞与支払年月日,[[92,531+offset,22,19],[125,531+offset,48,19],[185,531+offset,42,19]],'賞与支払年月日');
  }
  w.money(p.賞与額_通貨,[243,531+offset,139,19],'賞与額（通貨）',false,true);
  w.money(p.賞与額_現物 || null,[395,531+offset,134,19],'賞与額（現物）');
  w.money(p.賞与額_合計,[551,531+offset,85,19],'賞与額合計（千円）',true,true);
  for (const code of p.備考区分 ?? []) {
    const mark = BONUS_NOTE_MARKS[code];
    if (mark) w.circle(mark[0], mark[1] + offset, 12, 11);
  }
  if (p.初回支払日) w.text(p.初回支払日,[864,531+offset,23,14],'初回支払日',{size:7,center:true});
  if (p.備考区分?.includes(1)) w.warnings.add('70歳以上被用者の人は、個人番号（または基礎年金番号）の欄を原票に記入してください。');
}

function bonus(w: Writer, fd: Data) {
  dateParts(w,fd['賞与支払年月日'],[[331.66,428.34,70.27,37.44],[401.93,428.34,70.27,37.44],[472.2,428.34,70.27,37.44]],'賞与支払年月日');
  bonusRow(w, {
    被保険者整理番号: String(fd['被保険者整理番号'] ?? ''), 被保険者氏名: String(fd['被保険者氏名'] ?? ''), 生年月日: String(fd['生年月日'] ?? ''),
    賞与支払年月日: String(fd['賞与支払年月日'] ?? ''), 賞与額_通貨: fd['賞与額_通貨'] as number, 賞与額_現物: fd['賞与額_現物'] as number,
    賞与額_合計: fd['賞与額_合計'] as number,
  }, 0, fd['賞与支払年月日']);
}

function leave(w: Writer, fd: Data, key: string) {
  const maternity=key==='maternity';
  insuredNumber(w,fd['被保険者整理番号'],maternity?[174,466,132,28]:[153,557,143,30]);
  identifier(w,fd,maternity?[397.23,452.15,438.23,47.62]:[393.2,542.39,472.51,54.34]);
  names(w,fd,maternity?[[175,521,132,24],[314,521,132,24]]:[[154,616,143,29],[303,616,143,29]],
    maternity?[[175,501,132,14],[314,501,132,14]]:[[154,598,143,14],[303,598,143,14]]);
  dateParts(w,fd['生年月日'],maternity?[[659.89,499.77,58.37,51.84],[718.26,499.77,58.36,51.84],[776.62,499.77,58.37,51.84]]:[[574.26,596.73,62.97,57.6],[637.23,596.73,62.98,57.6],[700.21,596.73,62.97,57.6]],'生年月日',
    maternity?{x:615,showa:515,heisei:527,reiwa:539}:{x:536,showa:610,heisei:622,reiwa:634});
  if(maternity) {
    dateParts(w,fd['出産予定年月日'],[[273.2,551.61,58.37,51.84],[331.57,551.61,58.37,51.84],[389.94,551.61,58.36,51.84]],'出産予定年月日');
    dateParts(w,fd['産前産後休業開始年月日'],[[273.2,603.45,58.37,51.84],[331.57,603.45,58.37,51.84],[389.94,603.45,58.36,51.84]],'産前産後休業開始年月日');
    dateParts(w,fd['産前産後休業終了予定年月日'],[[659.89,603.45,58.37,51.84],[718.26,603.45,58.36,51.84],[776.62,603.45,58.37,51.84]],'産前産後休業終了予定年月日');
    if(fd['出産年月日']) dateParts(w,fd['出産年月日'],[[273.2,676.99,58.37,51.84],[331.57,676.99,58.37,51.84],[389.94,676.99,58.36,51.84]],'出産年月日');
    w.warnings.add('出産種別の選択と休業期間を確認してください。');
  } else {
    if (fd['性別'] === '男' || fd['性別'] === 'male') w.circle(833,611,12,11);
    else if (fd['性別'] === '女' || fd['性別'] === 'female') w.circle(833,640,12,11);
    const childName=String(fd['養育する子の氏名']??'').split(/[\s　]+/);
    w.text(childName[0],[154,671,143,30],'養育する子の氏名',{required:true,center:true});
    w.text(childName.slice(1).join(' '),[303,671,143,30],'養育する子の氏名',{required:true,center:true});
    dateParts(w,fd['養育する子の生年月日'],[[574.26,654.33,62.97,57.6],[637.23,654.33,62.98,57.6],[700.21,654.33,62.97,57.6]],'養育する子の生年月日');
    dateParts(w,fd['育児休業等開始年月日'],[[212.14,769.34,78.72,60.67],[290.86,769.34,78.72,60.67],[369.58,769.34,78.72,60.67]],'育児休業等開始年月日');
    dateParts(w,fd['育児休業等終了予定年月日'],[[574.26,769.34,62.97,60.67],[637.23,769.34,62.98,60.67],[700.21,769.34,62.97,60.67]],'育児休業等終了予定年月日');
    if(key==='childcare-end') dateParts(w,fd['育児休業等終了年月日'],[[212.14,1005.5,78.72,55.3],[290.86,1005.5,78.72,55.3],[369.58,1005.5,78.72,55.3]],'育児休業等終了年月日');
    w.warnings.add('子の区分・性別・同月内の休業取得日数など、必要な選択欄を確認してください。');
  }
}

function dependent(w: Writer, fd: Data, dep: Data | undefined) {
  insuredNumber(w,fd['被保険者整理番号'],[159,393,50,27]);
  names(w,fd,[[247,391,106,31],[360,391,131,31]],[[247,371,106,14],[360,371,131,14]]);
  dateParts(w,fd['生年月日'],[[614.96,369.2,52.99,31.49],[667.95,369.2,52.99,31.49],[720.94,369.2,53,31.49]],'被保険者の生年月日',{x:581,showa:375,heisei:386,reiwa:397});
  identifier(w,fd,[571.28,400.69,317.1,29.57]);
  if (fd['性別'] === '男' || fd['性別'] === 'male') w.circle(823,385,12,11);
  else if (fd['性別'] === '女' || fd['性別'] === 'female') w.circle(860,385,12,11);
  if(!dep) { w.warnings.add('被扶養者情報が未登録です。'); return; }
  const spouse=['spouse','配偶者','夫','妻'].includes(String(dep['続柄']));
  const name=String(dep['氏名']??'').split(/[\s　]+/);
  w.text(name[0],spouse?[159,565,165,18]:[159,850,96,28],'被扶養者氏名',{required:true,center:true});
  w.text(name.slice(1).join(' '),spouse?[326,565,165,18]:[260,850,98,28],'被扶養者氏名',{required:true,center:true});
  if(spouse) {
    if (dep['性別'] === '男' || dep['性別'] === 'male') w.circle(823,513,12,11);
    else if (dep['性別'] === '女' || dep['性別'] === 'female') w.circle(860,513,12,11);
    dateParts(w,dep['生年月日'],[[614.96,501.29,52.99,37.44],[667.95,501.29,52.99,37.44],[720.94,501.29,53,37.44]],'配偶者の生年月日',{x:582,showa:507,heisei:520,reiwa:532});
    w.money(dep['年間収入'],[820,649,52,22],'被扶養者の年間収入');
  } else {
    if (dep['性別'] === '男' || dep['性別'] === 'male') w.circle(667,843,12,11);
    else if (dep['性別'] === '女' || dep['性別'] === 'female') w.circle(667,865,12,11);
    dateParts(w,dep['生年月日'],[[451.76,826.92,49.92,30.34],[501.68,826.92,52.22,30.34],[553.9,826.92,52.23,30.34]],'被扶養者の生年月日',{x:416,showa:833,heisei:845,reiwa:857});
    w.money(dep['年間収入'],[664,956,45,19],'被扶養者の年間収入');
    const relation: Record<string, number>={child:1,'子':1,parent:3,'父':3,'母':3};
    const code=relation[String(dep['続柄'])];
    if(code) w.circle(739,code===1?837:code===3?859:837,12,11);
    else w.warnings.add('被扶養者の続柄を原票で確認してください。');
  }
  w.warnings.add('被扶養者の異動区分・理由・該当日・住所等を確認してください。複数人は原票を分けて出力しています。');
}

/** 算定基礎届の1人分（サーバーの santeiFilingPerson と同じ形） */
export interface SanteiPrintPerson {
  被保険者整理番号: string; 被保険者氏名: string; 生年月日: string; 適用年月: string;
  従前の標準報酬月額_健康保険: number | null; 従前の標準報酬月額_厚生年金: number | null;
  months: { 月: number; 支払基礎日数: number; 通貨: number; 現物: number; 合計: number }[];
  総計: number; 平均額: number | null; 修正平均額: number | null; 備考: string;
  備考区分?: number[]; 備考その他?: string;
}

/** 備考欄の番号の位置（1人目。原票を160%で測った値） */
const SANTEI_NOTE_MARKS: Record<number, [number, number]> = { 1: [697, 524], 4: [777, 554], 6: [697, 572], 7: [882, 572], 9: [767, 589] };

/** 1枚に記入する人数と、1人分の欄の高さ（原票を160%で測った値） */
const SANTEI_ROWS = 5;
const SANTEI_ROW_HEIGHT = 155;

/** 1人分を、1人用の記入（remuneration）が読む形に直す */
function santeiPersonData(p: SanteiPrintPerson): Data {
  const fd: Data = {
    '被保険者整理番号': p.被保険者整理番号, '被保険者氏名': p.被保険者氏名, '生年月日': p.生年月日, '対象年': p.適用年月.slice(0, 4),
    '従前の標準報酬月額_健康保険': p.従前の標準報酬月額_健康保険, '従前の標準報酬月額_厚生年金': p.従前の標準報酬月額_厚生年金,
    '合計': p.平均額 === null ? null : p.総計, '平均額': p.平均額,
  };
  for (const m of p.months) {
    fd[`${m.月}月_支払基礎日数`] = m.支払基礎日数;
    fd[`${m.月}月_通貨`] = m.通貨;
    fd[`${m.月}月_現物`] = m.現物;
  }
  return fd;
}

/**
 * 算定基礎届（複数人）。1枚に SANTEI_ROWS 人ずつ記入し、多ければ2枚目以降に続ける。
 * 事業所の欄は各ページに記入する。
 */
export async function createSanteiFilingPdf(fields: Data, persons: SanteiPrintPerson[], meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = async path => {
    const response=await fetch(path);
    if(!response.ok) throw new Error('公式PDFまたは日本語フォントを読み込めませんでした。再読み込みしてください。');
    return new Uint8Array(await response.arrayBuffer());
  }): Promise<OfficialPdfResult> {
  if (!persons.length) throw new Error('届出に載っている人がいません。');
  if (persons.length > 3000) throw new Error('人数が多すぎます。');
  const form = OFFICIAL_FORMS['remunerationMonthlyAlgorithm'];
  const [template,fontBytes]=await Promise.all([loadAsset(`/filing-forms/${form.file}.pdf`),loadAsset('/filing-forms/fonts/NotoSansJP-Regular.ttf')]);
  const source=await PDFDocument.load(template);
  if(source.getPageCount()!==2) throw new Error('公式様式のページ構成が変更されています。テンプレートを確認してください。');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(fontBytes,{subset:false});
  const fontMetrics = fontkit.create(fontBytes);
  const warnings=new Set<string>();
  const placements: PrintPlacement[]=[];
  warnings.add('被保険者整理番号・事業所整理記号など、登録されていない欄は原票で確かめてください。');
  for (let start = 0, pageIndex = 0; start < persons.length; start += SANTEI_ROWS, pageIndex++) {
    const [page]=await pdf.copyPages(source,[0]);pdf.addPage(page);
    const w=new Writer(page,font,warnings,placements,pageIndex,fontMetrics);
    header(w,form.file,fields,meta);
    persons.slice(start, start + SANTEI_ROWS).forEach((p, i) => {
      const offset = i * SANTEI_ROW_HEIGHT;
      remuneration(w, santeiPersonData(p), true, offset, true);
      if (p.修正平均額 !== null) w.money(p.修正平均額,[553,605+offset,114,18],'修正平均額');
      for (const code of p.備考区分 ?? []) {
        const mark = SANTEI_NOTE_MARKS[code];
        if (mark) w.circle(mark[0], mark[1] + offset, 12, 11);
      }
      if (p.備考その他) w.text(p.備考その他,[816,581+offset,102,15],'備考（その他）',{size:7});
      if (p.修正平均額 !== null) warnings.add('遡及支払額の欄は記入していません。修正平均額のある人は、遡及支払の月と額を原票に記入してください。');
    });
  }
  const [instructions]=await pdf.copyPages(source,[1]);pdf.addPage(instructions);
  pdf.setTitle(form.title);pdf.setCreator('社会保険管理システム');
  pdf.setSubject('日本年金機構の公式様式（2026-10-28取得）への記入');
  return {bytes:await pdf.save(),warnings:[...warnings],placements};
}

/**
 * 賞与支払届（複数人）。1枚に BONUS_ROWS 人ずつ記入し、多ければ2枚目以降に続ける。
 * 事業所の欄と賞与支払年月日（共通）は各ページに記入する。
 */
export async function createBonusFilingPdf(fields: Data, persons: BonusPrintPerson[], meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = async path => {
    const response=await fetch(path);
    if(!response.ok) throw new Error('公式PDFまたは日本語フォントを読み込めませんでした。再読み込みしてください。');
    return new Uint8Array(await response.arrayBuffer());
  }): Promise<OfficialPdfResult> {
  if (!persons.length) throw new Error('届出に載っている人がいません。');
  if (persons.length > 3000) throw new Error('人数が多すぎます。');
  const form = OFFICIAL_FORMS['bonusPayment'];
  const [template,fontBytes]=await Promise.all([loadAsset(`/filing-forms/${form.file}.pdf`),loadAsset('/filing-forms/fonts/NotoSansJP-Regular.ttf')]);
  const source=await PDFDocument.load(template);
  if(source.getPageCount()!==2) throw new Error('公式様式のページ構成が変更されています。テンプレートを確認してください。');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(fontBytes,{subset:false});
  const fontMetrics = fontkit.create(fontBytes);
  const warnings=new Set<string>();
  const placements: PrintPlacement[]=[];
  const common = fields['賞与支払年月日'];
  for (let start = 0, pageIndex = 0; start < persons.length; start += BONUS_ROWS, pageIndex++) {
    const [page]=await pdf.copyPages(source,[0]);pdf.addPage(page);
    const w=new Writer(page,font,warnings,placements,pageIndex,fontMetrics);
    header(w,form.file,fields,meta);
    dateParts(w,common,[[331.66,428.34,70.27,37.44],[401.93,428.34,70.27,37.44],[472.2,428.34,70.27,37.44]],'賞与支払年月日（共通）');
    persons.slice(start, start + BONUS_ROWS).forEach((p, i) => bonusRow(w, p, i * BONUS_ROW_HEIGHT, common));
  }
  const [instructions]=await pdf.copyPages(source,[1]);pdf.addPage(instructions);
  pdf.setTitle(form.title);pdf.setCreator('社会保険管理システム');
  pdf.setSubject('日本年金機構の公式様式（2026-10-28取得）への記入');
  return {bytes:await pdf.save(),warnings:[...warnings],placements};
}

/**
 * 賞与不支給報告書（事業所ごとに1枚）。① 賞与支払年月（令和の年2桁＋月2桁）、② 支給の状況（「1. 不支給」は印刷済み）、
 * ③ 支給予定月の変更（変更後・変更前とも4か月まで。今後は支給しない場合は変更後をすべて「00」）
 */
export async function createBonusNonPaymentPdf(fields: Data, meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = async path => {
    const response=await fetch(path);
    if(!response.ok) throw new Error('公式PDFまたは日本語フォントを読み込めませんでした。再読み込みしてください。');
    return new Uint8Array(await response.arrayBuffer());
  }): Promise<OfficialPdfResult> {
  const form = OFFICIAL_FORMS['bonusNonPayment'];
  const [template,fontBytes]=await Promise.all([loadAsset(`/filing-forms/${form.file}.pdf`),loadAsset('/filing-forms/fonts/NotoSansJP-Regular.ttf')]);
  const source=await PDFDocument.load(template);
  if(source.getPageCount()!==2) throw new Error('公式様式のページ構成が変更されています。テンプレートを確認してください。');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(fontBytes,{subset:false});
  const fontMetrics = fontkit.create(fontBytes);
  const warnings=new Set<string>();
  const placements: PrintPlacement[]=[];
  const [page]=await pdf.copyPages(source,[0]);pdf.addPage(page);
  const w=new Writer(page,font,warnings,placements,0,fontMetrics);
  header(w,form.file,fields,meta);
  const postal = String(fields['郵便番号'] ?? '').trim();
  if (postal) w.text(postal,[172,199,140,16],'郵便番号',{ size:9 });
  else warnings.add('郵便番号が未登録です（設定の事業所一覧で登録できます）。');
  // ① 賞与支払年月：令和の年と月を2桁ずつ
  const ym = String(fields['賞与支払年月'] ?? '');
  const paid = parseDate(/^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : '');
  if (paid?.era === 9) w.digits(`${String(paid.eraYear).padStart(2,'0')}${String(paid.month).padStart(2,'0')}`,[229.4,551,89,38],4,'賞与支払年月',true);
  else warnings.add('賞与支払年月が未登録、または令和の年月ではありません。');
  // ③ 支給予定月の変更（変更するときだけ）
  const after = fields['変更後の支払予定月'];
  if (Array.isArray(after)) {
    const afterCells: Box[] = [[184.2,862,33.2,33],[218.7,862,32.7,33],[252.7,862,30.9,33],[285,862,32.6,33]];
    const beforeCells: Box[] = [[409,862,33.3,33],[443.6,862,32.6,33],[477.6,862,32.7,33],[511.6,862,38.6,33]];
    const values = fields['今後は支給しない'] ? ['00','00','00','00'] : (after as number[]).map(m => String(m).padStart(2,'0'));
    values.slice(0,4).forEach((v,i)=>w.text(v,afterCells[i],'変更後の賞与支払予定月',{ size:10, center:true }));
    const before = Array.isArray(fields['変更前の支払予定月']) ? fields['変更前の支払予定月'] as number[] : [];
    if (!before.length) warnings.add('変更前の賞与支払予定月が未登録です。');
    before.slice(0,4).forEach((m,i)=>w.text(String(m).padStart(2,'0'),beforeCells[i],'変更前の賞与支払予定月',{ size:10, center:true }));
  }
  const [instructions]=await pdf.copyPages(source,[1]);pdf.addPage(instructions);
  pdf.setTitle(form.title);pdf.setCreator('社会保険管理システム');
  pdf.setSubject('日本年金機構の公式様式（2026-10-30取得）への記入');
  return {bytes:await pdf.save(),warnings:[...warnings],placements};
}

/** Fills the bundled, unmodified Japan Pension Service PDF. No external data transmission. */
export async function createOfficialFilingPdf(filingType: string, formData: Data, meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = async path => {
    const response=await fetch(path);
    if(!response.ok) throw new Error('公式PDFまたは日本語フォントを読み込めませんでした。再読み込みしてください。');
    return new Uint8Array(await response.arrayBuffer());
  }): Promise<OfficialPdfResult> {
  const form=OFFICIAL_FORMS[filingType];
  if(!form) throw new Error('この届出に対応する公式様式がありません。');
  const [template,fontBytes]=await Promise.all([loadAsset(`/filing-forms/${form.file}.pdf`),loadAsset('/filing-forms/fonts/NotoSansJP-Regular.ttf')]);
  const source=await PDFDocument.load(template);
  if(source.getPageCount()!==2) throw new Error('公式様式のページ構成が変更されています。テンプレートを確認してください。');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // fontkit's CJK subsetting can silently omit glyphs; embed the static font intact.
  const font=await pdf.embedFont(fontBytes,{subset:false});
  const warnings=new Set<string>();
  if (meta.employeeNumber && String(formData['被保険者整理番号'] ?? '') === meta.employeeNumber) {
    formData = { ...formData, '被保険者整理番号': '' };
    warnings.add('被保険者整理番号に社員番号が転記されている可能性があるため空欄にしています。正式な整理番号を確認してください。');
  }
  const placements: PrintPlacement[]=[];
  const fontMetrics = fontkit.create(fontBytes);
  const deps=Array.isArray(formData['被扶養者一覧'])?formData['被扶養者一覧'].filter((d):d is Data=>!!d&&typeof d==='object'&&!Array.isArray(d)):[];
  const copies=filingType==='dependentChange'?Math.max(1,deps.length):1;
  if(copies>100) throw new Error('被扶養者の件数が多すぎます。');
  for(let i=0;i<copies;i++) {
    const [page]=await pdf.copyPages(source,[0]);pdf.addPage(page);
    const w=new Writer(page,font,warnings,placements,i,fontMetrics);
    header(w,form.file,formData,meta);
    switch(filingType) {
      case 'acquisitionNotification':acquisition(w,formData);break;
      case 'lossNotification':loss(w,formData);break;
      case 'remunerationMonthlyAlgorithm':remuneration(w,formData,true);break;
      case 'remunerationMonthlyChange':remuneration(w,formData,false);break;
      case 'bonusPayment':bonus(w,formData);break;
      case 'dependentChange':dependent(w,formData,deps[i]);break;
      case 'maternityLeaveEndChange':leaveEndRemuneration(w,formData,false);break;
      case 'childcareLeaveEndChange':leaveEndRemuneration(w,formData,true);break;
      case 'pensionLoss70':pensionLoss70(w,formData);break;
      default:leave(w,formData,form.file);
    }
  }
  const [instructions]=await pdf.copyPages(source,[1]);pdf.addPage(instructions);
  pdf.setTitle(form.title);pdf.setCreator('社会保険管理システム');
  pdf.setSubject('日本年金機構の公式様式（2026-10-28取得）への記入');
  return {bytes:await pdf.save(),warnings:[...warnings],placements};
}

export interface CorrectionRow { field: string; before: string; after: string }

/**
 * 訂正届・取消届（カタログ 届出⑩）。元の届出の公式様式に記入し（訂正届は訂正後の値、取消届は元の値）、
 * 1枚目の上の余白に赤で「訂正」「取消」と示し、最後に訂正箇所の一覧（項目・訂正前・訂正後）と理由のページを付ける
 */
export async function createCorrectionPdf(kind: 'correction' | 'cancellation', originalType: string, formData: Data,
  corrections: CorrectionRow[], reason: string, meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = defaultLoadAsset): Promise<OfficialPdfResult> {
  const base = await createOfficialFilingPdf(originalType, formData, meta, loadAsset);
  const title = OFFICIAL_FORMS[originalType]?.title ?? '届出';
  return decorateCorrection(base, kind, title, `事業所：${meta.officeName}　被保険者：${String(formData['被保険者氏名'] ?? '')}`,
    'この届出（上の様式に記入した内容）を取り消します。', corrections, reason, loadAsset);
}

/**
 * 算定基礎届・賞与支払届の訂正届・取消届。元の様式に、選んだ人の行だけ（訂正届は訂正後の値、取消届は元の値）を記入し、
 * 1枚目の上の余白に赤で「訂正届」「取消届」、最後に理由と訂正箇所（人ごと）の一覧を付ける
 */
export async function createRunCorrectionPdf(kind: 'correction' | 'cancellation', source: 'santei' | 'bonus', header: Data, persons: unknown[],
  corrections: CorrectionRow[], reason: string, meta: FilingPrintMeta,
  loadAsset: (path: string) => Promise<Uint8Array> = defaultLoadAsset): Promise<OfficialPdfResult> {
  const base = source === 'santei'
    ? await createSanteiFilingPdf(header, persons as SanteiPrintPerson[], meta, loadAsset)
    : await createBonusFilingPdf(header, persons as BonusPrintPerson[], meta, loadAsset);
  const title = OFFICIAL_FORMS[source === 'santei' ? 'remunerationMonthlyAlgorithm' : 'bonusPayment'].title;
  const names = (persons as { 被保険者氏名?: string }[]).map(p => p.被保険者氏名 ?? '').join('、');
  return decorateCorrection(base, kind, title, `事業所：${meta.officeName}　対象：${persons.length}名（${names}）`,
    '上の様式に記入した人の届出を取り消します。', corrections, reason, loadAsset, 'bottomRight');
}

async function defaultLoadAsset(path: string): Promise<Uint8Array> {
  const response=await fetch(path);
  if(!response.ok) throw new Error('公式PDFまたは日本語フォントを読み込めませんでした。再読み込みしてください。');
  return new Uint8Array(await response.arrayBuffer());
}

/** 記入済みの様式に「訂正届」「取消届」の表示と、理由・訂正箇所の一覧のページを付ける */
async function decorateCorrection(base: OfficialPdfResult, kind: 'correction' | 'cancellation', title: string, subject: string,
  cancelText: string, corrections: CorrectionRow[], reason: string, loadAsset: (path: string) => Promise<Uint8Array>,
  stampAt: 'top' | 'bottomRight' = 'top'): Promise<OfficialPdfResult> {
  const label = kind === 'correction' ? '訂正' : '取消';
  const pdf = await PDFDocument.load(base.bytes);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadAsset('/filing-forms/fonts/NotoSansJP-Regular.ttf'), { subset: false });
  const red = rgb(0.8, 0.1, 0.1);

  // 1枚目の余白に「訂正」「取消」の表示（様式の記入欄にかからない位置。算定基礎届・賞与支払届は上に余白がないので右下）
  const first = pdf.getPage(0);
  const media = first.getMediaBox();
  const stamp = `${label}届`;
  const stampSize = 12;
  const stampWidth = font.widthOfTextAtSize(stamp, stampSize) + 16;
  const sx = stampAt === 'top' ? media.x + media.width / 2 - stampWidth / 2 : media.x + media.width - stampWidth - 20;
  const sy = stampAt === 'top' ? media.y + media.height - 22 : media.y + 14;
  first.drawRectangle({ x: sx, y: sy - 4, width: stampWidth, height: stampSize + 8, borderColor: red, borderWidth: 1.2 });
  first.drawText(stamp, { x: sx + 8, y: sy, size: stampSize, font, color: red });

  // 訂正箇所の一覧（A4縦）。長い値は折り返し、ページに収まらなければ次のページへ
  const W = 595.28, H = 841.89, left = 48, right = W - 48;
  const cols = [left, left + 150, left + 150 + (right - left - 150) / 2, right];
  const wrap = (text: string, width: number, size: number) => {
    const lines: string[] = [];
    let line = '';
    for (const ch of [...(text || '（空欄）')]) {
      if (font.widthOfTextAtSize(line + ch, size) > width - 8) { lines.push(line); line = ch; } else line += ch;
    }
    lines.push(line);
    return lines;
  };
  let page = pdf.addPage([W, H]);
  let y = H - 56;
  const text = (t: string, x: number, size = 10, color = rgb(0, 0, 0)) => page.drawText(t, { x, y, size, font, color });
  text(`${label}届（${title}）`, left, 16, red);
  y -= 24;
  for (const line of wrap(subject, right - left, 10)) { text(line, left); y -= 15; }
  y += 15;
  y -= 18;
  for (const line of wrap(`${label}の理由：${reason}`, right - left, 10)) { text(line, left); y -= 15; }
  y -= 8;
  if (kind === 'cancellation') {
    text(cancelText, left);
  } else {
    const header = () => {
      page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 20, color: rgb(0.93, 0.93, 0.93) });
      ['項目', '訂正前', '訂正後'].forEach((h, i) => page.drawText(h, { x: cols[i] + 4, y, size: 10, font }));
      y -= 22;
    };
    header();
    for (const c of corrections) {
      const cells = [wrap(c.field, cols[1] - cols[0], 9), wrap(c.before, cols[2] - cols[1], 9), wrap(c.after, cols[3] - cols[2], 9)];
      const rows = Math.max(...cells.map(l => l.length));
      if (y - rows * 13 < 56) { page = pdf.addPage([W, H]); y = H - 56; header(); }
      cells.forEach((lines, i) => lines.forEach((l, n) => page.drawText(l, { x: cols[i] + 4, y: y - n * 13, size: 9, font, color: i === 2 ? red : rgb(0, 0, 0) })));
      y -= rows * 13 + 4;
      page.drawLine({ start: { x: left, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
      y -= 6;
    }
    if (!corrections.length) text('訂正箇所がありません。', left);
  }
  pdf.setTitle(`${label}届（${title}）`);
  const warnings = [...base.warnings];
  if (kind === 'correction' && !corrections.length) warnings.push('訂正箇所がありません。元の届出から直した項目を確かめてください。');
  return { bytes: await pdf.save(), warnings, placements: base.placements };
}
