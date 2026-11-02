import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext } from '../middleware/auth';
import { InsuranceRateDoc, OfficeDoc } from '../types/firestore';
import { findAllRates, findApplicableRate, rateMatchScore } from '../utils/insurance-rate';
import { invalidArg } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { notify } from '../utils/notify';
import { resolveGradeTable, splitPremium } from '../insurance/calculator';
import { splitCsvLine } from '../monthly/rules';
import { CSV_HEADER, RATE_TYPE_LABELS, RateRow, parseRateCsv, previousMonth } from './rules';
import { missingKyokaiCsv } from './kyokai-rates';

/**
 * 料率の CSV 取込と切替（カタログ1章・6章）。取り込む前に今の料率との差を見せ、
 * 切り替えると前の料率に「いつまで」を付けて履歴として残す（過去の計算の見直しに使う）
 */
export async function previewRates(auth: AuthContext, csv: string) {
  const { rows, errors } = parseRateCsv(csv, splitCsvLine);
  const items = await Promise.all(rows.map(async r => {
    const current = await findApplicableRate({ companyId: auth.companyId, insuranceType: r.insuranceType, yearMonth: r.appliedFrom, prefectureCode: r.prefectureCode || undefined, insurerId: r.insurerId || undefined });
    const same = current && current.appliedFrom === r.appliedFrom;
    return {
      ...r, typeLabel: RATE_TYPE_LABELS[r.insuranceType],
      current: current ? { totalRate: current.totalRate, appliedFrom: current.appliedFrom } : null,
      change: current ? Math.round((r.totalRate - current.totalRate) * 1000) / 1000 : null,
      duplicate: !!same,
    };
  }));
  return { items, errors, impact: rows.length ? await calculatedImpact(auth, rows) : [] };
}

export interface ImpactRow { officeId: string; officeName: string; kind: 'monthly' | 'bonus'; yearMonth: string; unconfirmed: number; pending: number; confirmed: number }

/**
 * 切替月以降で、すでに計算した保険料（カタログ6章 料率改定時の切替）。事業所×月×毎月・賞与ごとに、未確定・依頼中・確定済みの人数を数える。
 * 未確定は「計算し直しが必要」、確定済みは「訂正が必要」として毎月の処理に出る（同じ値の料率なら出ない）
 */
export async function calculatedImpact(auth: AuthContext, rows: RateRow[]): Promise<ImpactRow[]> {
  const base = `companies/${auth.companyId}`;
  const offices = (await db.collection(`${base}/offices`).get()).docs;
  // 事業所ごとに、この CSV の料率が当てはまる一番早い開始月
  const fromOf = new Map<string, string>();
  for (const o of offices) {
    const od = o.data() as OfficeDoc;
    for (const r of rows) {
      if (rateMatchScore(r, { insuranceType: r.insuranceType, prefectureCode: od.prefectureCode, insurerId: od.insurerId }) === null) continue;
      const cur = fromOf.get(o.id);
      if (!cur || r.appliedFrom < cur) fromOf.set(o.id, r.appliedFrom);
    }
  }
  const counts = new Map<string, ImpactRow>();
  for (const o of offices.filter(x => fromOf.has(x.id))) {
    const from = fromOf.get(o.id)!;
    const employees = await db.collection(`${base}/employees`).where('officeId', '==', o.id).where('deletedAt', '==', null).get();
    await mapConcurrent(employees.docs, 20, async e => {
      const [m, b] = await Promise.all((['monthlyInsurance', 'bonusInsurance'] as const).map(c =>
        db.collection(`${e.ref.path}/${c}`).where('yearMonth', '>=', from).select('yearMonth', 'isConfirmed', 'approvalPending').get()));
      for (const [kind, snap] of [['monthly', m], ['bonus', b]] as const) {
        for (const d of snap.docs) {
          const ym = d.data().yearMonth as string;
          const key = `${o.id}|${kind}|${ym}`;
          const row = counts.get(key) ?? { officeId: o.id, officeName: (o.data().name as string) ?? '', kind, yearMonth: ym, unconfirmed: 0, pending: 0, confirmed: 0 };
          if (d.data().isConfirmed === true) row.confirmed++;
          else if (d.data().approvalPending === true) row.pending++;
          else row.unconfirmed++;
          counts.set(key, row);
        }
      }
    });
  }
  return [...counts.values()].sort((a, b) => a.officeName.localeCompare(b.officeName, 'ja') || a.yearMonth.localeCompare(b.yearMonth) || a.kind.localeCompare(b.kind));
}

const keyOf = (r: Pick<RateRow, 'insuranceType' | 'prefectureCode' | 'insurerId'>) => `${r.insuranceType}|${r.prefectureCode}|${r.insurerId}`;

export async function applyRates(auth: AuthContext, csv: string) {
  const { rows, errors } = parseRateCsv(csv, splitCsvLine);
  if (errors.length) throw invalidArg(`CSV に直すところがあります：${errors.slice(0, 3).join('／')}`);
  if (!rows.length) throw invalidArg('取り込む行がありません');
  const col = db.collection(`companies/${auth.companyId}/insuranceRates`);
  const existing = (await col.get()).docs;
  const now = Timestamp.now();
  const batch = db.batch();
  let closed = 0;
  for (const r of rows) {
    if (existing.some(d => keyOf(d.data() as InsuranceRateDoc) === keyOf(r) && d.data().appliedFrom === r.appliedFrom)) {
      throw invalidArg(`${r.line}行目：同じ開始月の料率がもう登録されています（${RATE_TYPE_LABELS[r.insuranceType]}・${r.appliedFrom}）`);
    }
    // 前の料率の終わりを新しい料率の前の月にする（新しいものより後に始まる料率はそのまま）
    for (const d of existing) {
      const x = d.data() as InsuranceRateDoc;
      if (keyOf(x) !== keyOf(r) || x.appliedFrom >= r.appliedFrom) continue;
      if (x.appliedUntil && x.appliedUntil < r.appliedFrom) continue;
      batch.update(d.ref, { appliedUntil: previousMonth(r.appliedFrom), updatedAt: now });
      closed++;
    }
    // もっと後に始まる料率が登録済みなら、その前の月で終わらせる（期間を重ねない）
    const later = [...existing.map(d => d.data() as InsuranceRateDoc), ...rows.filter(x => x !== r)]
      .filter(x => keyOf(x) === keyOf(r) && x.appliedFrom > r.appliedFrom).map(x => x.appliedFrom).sort()[0];
    batch.set(col.doc(), {
      insuranceType: r.insuranceType, insurerId: r.insurerId, prefectureCode: r.prefectureCode, appliedFrom: r.appliedFrom, appliedUntil: later ? previousMonth(later) : null,
      totalRate: r.totalRate, employeeRate: r.employeeRate, employerRate: r.employerRate, gradeTable: null, note: r.note || 'CSVで取込',
      createdAt: now, updatedAt: now, importedBy: auth.uid,
    });
  }
  batch.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
    entity: 'insuranceRate', entityId: 'csvImport', action: 'create',
    changes: { rates: rows.map(r => `${RATE_TYPE_LABELS[r.insuranceType]}${r.prefectureCode ? `（${r.prefectureCode}）` : ''} ${r.appliedFrom}〜 ${r.totalRate}‰`), closedPrevious: closed },
    performedBy: auth.uid, performedAt: now, version: 0,
  });
  await batch.commit();
  const from = rows.map(r => r.appliedFrom).sort()[0];
  await notify({
    // targetType はお知らせを見せる相手（all・office・employee）
    companyId: auth.companyId, category: 'system', targetType: 'all', targetId: 'insuranceRate', createdBy: auth.uid,
    title: '料率を切り替えました',
    body: `${from}分以降の保険料に新しい料率を使います。すでに計算した月は、毎月の処理で「計算し直しが必要」「訂正が必要」と出た人を確かめてください。`,
  });
  return { added: rows.length, closedPrevious: closed };
}

/**
 * 組合健保の料率を画面から登録する（カタログ1章 組合健保の設定）。本人と会社の負担割合が折半でなくてもよい。
 * CSV の取り込みと同じ確かめ方（単位・合計・重複）と切替（前の料率に終わりの月を付ける）を使う
 */
export async function addUnionRates(auth: AuthContext, input: {
  insurerId: string; appliedFrom: string; healthTotal: number; healthEmployee: number; careTotal: number | null; careEmployee: number | null; note: string;
}) {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const line = (type: string, total: number, employee: number) => `${type},,${input.insurerId},${input.appliedFrom},${total},${employee},${round(total - employee)},${input.note.replace(/[,\r\n]/g, ' ') || '組合健保'}`;
  if (input.healthEmployee > input.healthTotal) throw invalidArg('本人負担が料率を超えています');
  const lines = [line('健康保険', input.healthTotal, input.healthEmployee)];
  if (input.careTotal !== null) {
    if (input.careEmployee === null || input.careEmployee > input.careTotal) throw invalidArg('介護保険の本人負担を確かめてください');
    lines.push(line('介護保険', input.careTotal, input.careEmployee));
  }
  return applyRates(auth, lines.join('\n'));
}

/** 料率の履歴（新しい順）と、まだ登録していない協会けんぽの料率（47都道府県の公表値。取り込む CSV にして返す） */
export async function rateHistory(auth: AuthContext) {
  const snap = await db.collection(`companies/${auth.companyId}/insuranceRates`).get();
  return {
    kyokaiMissing: missingKyokaiCsv(snap.docs.map(d => d.data() as InsuranceRateDoc), CSV_HEADER),
    items: snap.docs.map(d => d.data() as InsuranceRateDoc).map(r => ({
      insuranceType: r.insuranceType, typeLabel: RATE_TYPE_LABELS[r.insuranceType] ?? r.insuranceType, prefectureCode: r.prefectureCode ?? '', insurerId: r.insurerId ?? '',
      appliedFrom: r.appliedFrom, appliedUntil: r.appliedUntil ?? null, totalRate: r.totalRate, employeeRate: r.employeeRate, employerRate: r.employerRate, note: r.note ?? '',
    })).sort((a, b) => b.appliedFrom.localeCompare(a.appliedFrom) || a.insuranceType.localeCompare(b.insuranceType) || a.prefectureCode.localeCompare(b.prefectureCode)),
  };
}

/** 保険料額表（協会けんぽの額表と同じ並び）：等級・標準報酬月額・報酬月額の範囲・健保（介護なし／あり）・厚年の全額と折半額 */
export async function gradeTableView(auth: AuthContext, prefectureCode: string, yearMonth: string, insurerId?: string) {
  const rates = await findAllRates(auth.companyId, yearMonth, prefectureCode, insurerId);
  if (!rates.health) throw invalidArg('その都道府県・年月の健康保険料率がありません');
  const healthTable = resolveGradeTable('health', rates.health.gradeTable);
  const pensionTable = rates.pension ? resolveGradeTable('pension', rates.pension.gradeTable) : [];
  const half = (std: number, r: InsuranceRateDoc | null) => (r ? splitPremium(std, r.employeeRate, r.employerRate, 'statutory', r.totalRate).employeeAmount : null);
  const full = (std: number, r: InsuranceRateDoc | null) => (r ? Math.round((std * r.totalRate) / 10) / 100 : null);
  const careTotal = rates.health && rates.longTermCare ? { ...rates.health, totalRate: rates.health.totalRate + rates.longTermCare.totalRate, employeeRate: rates.health.employeeRate + rates.longTermCare.employeeRate, employerRate: rates.health.employerRate + rates.longTermCare.employerRate } : null;
  return {
    yearMonth, prefectureCode,
    rates: { health: rates.health.totalRate, longTermCare: rates.longTermCare?.totalRate ?? null, pension: rates.pension?.totalRate ?? null, healthFrom: rates.health.appliedFrom },
    rows: healthTable.map(g => {
      const p = pensionTable.find(x => x.standardRemuneration === g.standardRemuneration) ?? (g.standardRemuneration < (pensionTable[0]?.standardRemuneration ?? 0) ? pensionTable[0] : g.standardRemuneration > (pensionTable.at(-1)?.standardRemuneration ?? Infinity) ? pensionTable.at(-1) : null);
      return {
        // 最高等級の上限は無限大（JSON で返せないので null）
        healthGrade: g.gradeNumber, pensionGrade: p?.gradeNumber ?? null, standardRemuneration: g.standardRemuneration, lowerBound: g.lowerBound, upperBound: Number.isFinite(g.upperBound) ? g.upperBound : null,
        healthFull: full(g.standardRemuneration, rates.health), healthHalf: half(g.standardRemuneration, rates.health),
        careFull: full(g.standardRemuneration, careTotal), careHalf: half(g.standardRemuneration, careTotal),
        pensionFull: p ? full(p.standardRemuneration, rates.pension) : null, pensionHalf: p ? half(p.standardRemuneration, rates.pension) : null,
      };
    }),
  };
}
