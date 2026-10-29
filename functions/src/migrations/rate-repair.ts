import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { addMonths } from '../insurance/calculator';

const Schema = z.object({
  companyId: z.string().min(1).regex(/^[^/]+$/),
  /** true（既定）は変更せず、直す内容だけを返す */
  dryRun: z.boolean().default(true),
});

/**
 * 協会けんぽの公表料率（‰。労使折半）。出典：協会けんぽ「都道府県単位保険料率」令和7年度・令和8年度。
 * どちらも3月分（4月納付分）から適用。介護保険は全国一律
 */
const OFFICIAL_HEALTH: Record<string, { appliedFrom: string; total: number }[]> = {
  '13': [{ appliedFrom: '2025-03', total: 99.1 }, { appliedFrom: '2026-03', total: 98.5 }],
  '27': [{ appliedFrom: '2025-03', total: 102.4 }, { appliedFrom: '2026-03', total: 101.3 }],
  '28': [{ appliedFrom: '2025-03', total: 101.6 }, { appliedFrom: '2026-03', total: 101.2 }],
};
const OFFICIAL_LONG_TERM_CARE = [{ appliedFrom: '2025-03', total: 15.9 }, { appliedFrom: '2026-03', total: 16.2 }];

const RATE_KEYS = ['totalRate', 'employeeRate', 'employerRate'] as const;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface RatePlanItem {
  id: string;
  change: 'unit' | 'add' | 'close';
  insuranceType: string;
  prefectureCode: string;
  insurerId: string;
  appliedFrom: string;
  before: { totalRate?: number; employeeRate?: number; employerRate?: number; appliedUntil?: string | null } | null;
  after: { totalRate?: number; employeeRate?: number; employerRate?: number; appliedUntil?: string | null };
}

interface RateRow { id: string; insuranceType: string; prefectureCode: string; insurerId: string; appliedFrom: string; appliedUntil: string | null; totalRate: number | null; employeeRate: number; employerRate: number }

/** 直す内容を決める（Firestore に触れない） */
export function planRateRepair(rows: RateRow[]): RatePlanItem[] {
  const plan: RatePlanItem[] = [];
  const current = rows.map(r => ({ ...r }));

  // 1. 小数（0.0991など）で入っている料率を‰に直す
  for (const r of current) {
    if (!RATE_KEYS.some(k => { const v = r[k]; return v !== null && v > 0 && v < 1; })) continue;
    // Firestore は undefined を書けないため、空の合計は項目ごと省く
    const before = { ...(r.totalRate !== null ? { totalRate: r.totalRate } : {}), employeeRate: r.employeeRate, employerRate: r.employerRate };
    r.employeeRate = round3(r.employeeRate * 1000);
    r.employerRate = round3(r.employerRate * 1000);
    // 合計の料率が空の旧データは、本人分と会社分の合計を入れる
    r.totalRate = r.totalRate ? round3(r.totalRate * 1000) : round3(r.employeeRate + r.employerRate);
    plan.push({ id: r.id, change: 'unit', insuranceType: r.insuranceType, prefectureCode: r.prefectureCode, insurerId: r.insurerId, appliedFrom: r.appliedFrom, before, after: { totalRate: r.totalRate, employeeRate: r.employeeRate, employerRate: r.employerRate } });
  }

  // 2. 令和7年度・8年度の料率がなければ足す（既にある健康保険・介護保険の登録と同じ都道府県・保険者で）
  const groups = new Map<string, RateRow[]>();
  for (const r of current) {
    if (r.insuranceType !== 'health' && r.insuranceType !== 'longTermCare') continue;
    // サンプル事業所用の架空の保険者には、公表料率を足さない
    if (r.insurerId.startsWith('sample')) continue;
    if (r.insuranceType === 'health' && !OFFICIAL_HEALTH[r.prefectureCode]) continue;
    const key = `${r.insuranceType}|${r.prefectureCode}|${r.insurerId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // 健康保険の料率が1件もない都道府県（事業所があるのに計算できない）にも足す
  for (const prefectureCode of Object.keys(OFFICIAL_HEALTH)) {
    if (![...groups.keys()].some(k => k.startsWith(`health|${prefectureCode}|`))) groups.set(`health|${prefectureCode}|`, []);
  }
  for (const [key, members] of groups) {
    const [insuranceType, prefectureCode, insurerId] = key.split('|');
    const official = insuranceType === 'health' ? OFFICIAL_HEALTH[prefectureCode] : OFFICIAL_LONG_TERM_CARE;
    for (const o of official) {
      if (members.some(m => m.appliedFrom === o.appliedFrom)) continue;
      const half = round3(o.total / 2);
      const added: RateRow = {
        id: `${insuranceType}_${prefectureCode || 'all'}_${insurerId || 'none'}_${o.appliedFrom}`,
        insuranceType, prefectureCode, insurerId, appliedFrom: o.appliedFrom, appliedUntil: null,
        totalRate: o.total, employeeRate: half, employerRate: half,
      };
      members.push(added);
      plan.push({ id: added.id, change: 'add', insuranceType, prefectureCode, insurerId, appliedFrom: o.appliedFrom, before: null, after: { totalRate: o.total, employeeRate: half, employerRate: half, appliedUntil: null } });
    }
    // 3. 次の料率が始まる前月で、前の料率を終わらせる（終わりが未設定のものだけ）
    members.sort((a, b) => a.appliedFrom.localeCompare(b.appliedFrom));
    members.forEach((m, i) => {
      const next = members[i + 1];
      if (!next || m.appliedUntil) return;
      const until = addMonths(next.appliedFrom, -1);
      m.appliedUntil = until;
      const added = plan.find(p => p.id === m.id && p.change === 'add');
      if (added) added.after.appliedUntil = until;
      else plan.push({ id: m.id, change: 'close', insuranceType, prefectureCode, insurerId, appliedFrom: m.appliedFrom, before: { appliedUntil: null }, after: { appliedUntil: until } });
    });
  }
  return plan;
}

/**
 * 料率マスタの修正。小数で入った料率を‰に直し、協会けんぽの令和7年度・8年度の料率（東京・大阪・兵庫の健康保険、介護保険）を足す。
 * 既定はドライランで、直す内容だけを返す。
 */
export async function repairRates(input: z.infer<typeof Schema>, auth: AuthContext) {
  const snap = await db.collection(`companies/${auth.companyId}/insuranceRates`).get();
  const rows: RateRow[] = snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id, insuranceType: x.insuranceType, prefectureCode: x.prefectureCode ?? '', insurerId: x.insurerId ?? '',
      appliedFrom: x.appliedFrom, appliedUntil: x.appliedUntil ?? null,
      totalRate: typeof x.totalRate === 'number' ? x.totalRate : null, employeeRate: x.employeeRate ?? 0, employerRate: x.employerRate ?? 0,
    };
  });
  const plan = planRateRepair(rows);
  if (!input.dryRun && plan.length) {
    const now = Timestamp.now();
    const batch = db.batch();
    const ref = (id: string) => db.doc(`companies/${auth.companyId}/insuranceRates/${id}`);
    for (const p of plan) {
      if (p.change === 'add') {
        batch.set(ref(p.id), {
          insuranceType: p.insuranceType, prefectureCode: p.prefectureCode, insurerId: p.insurerId, appliedFrom: p.appliedFrom,
          ...p.after, gradeTable: null, note: '協会けんぽの公表料率（料率マスタの修正で追加）', createdAt: now, updatedAt: now,
        });
      } else {
        batch.update(ref(p.id), { ...p.after, updatedAt: now });
      }
      batch.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
        entity: 'insuranceRate', entityId: p.id, action: p.change === 'add' ? 'create' : 'update',
        changes: { rate: { from: p.before, to: p.after } }, note: '料率マスタの修正', performedBy: auth.uid, performedAt: now,
      });
    }
    await batch.commit();
  }
  return { dryRun: input.dryRun, plan, total: rows.length };
}

export const migrateInsuranceRates = onCall(async (request) => {
  const input = validate(Schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return repairRates(input, auth);
});
