import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext } from '../middleware/auth';
import { InsuranceRateDoc } from '../types/firestore';
import { findAllRates, findApplicableRate } from '../utils/insurance-rate';
import { invalidArg } from '../utils/errors';
import { resolveGradeTable, splitPremium } from '../insurance/calculator';
import { splitCsvLine } from '../monthly/rules';
import { RATE_TYPE_LABELS, RateRow, parseRateCsv, previousMonth } from './rules';

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
  return { items, errors };
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
    batch.set(col.doc(), {
      insuranceType: r.insuranceType, insurerId: r.insurerId, prefectureCode: r.prefectureCode, appliedFrom: r.appliedFrom, appliedUntil: null,
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
  return { added: rows.length, closedPrevious: closed };
}

/** 料率の履歴（新しい順） */
export async function rateHistory(auth: AuthContext) {
  const snap = await db.collection(`companies/${auth.companyId}/insuranceRates`).get();
  return {
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
