import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { invalidArg } from '../../utils/errors';
import { addDays } from '../summary/rules';
import { CalendarEvent, DEFAULT_REMINDER_DAYS, annualEvents, bonusEvents, monthlyChecklist } from './rules';
import { listHomeTodos } from '../../home/service';

const FILING_LABELS: Record<string, string> = {
  acquisitionNotification: '資格取得届', lossNotification: '資格喪失届', remunerationMonthlyAlgorithm: '算定基礎届',
  remunerationMonthlyChange: '月額変更届', bonusPayment: '賞与支払届', dependentChange: '被扶養者（異動）届',
};

async function officesInScope(auth: AuthContext) {
  const snap = await db.collection(`companies/${auth.companyId}/offices`).where('isActive', '==', true).get();
  return snap.docs.filter(o => auth.roles.includes('admin') || auth.officeIds.includes(o.id));
}

/** その年のカレンダー：毎年の予定・賞与の予定月・まだ出していない届出の期限・進行中の手続きの期限（ホームの「今後の期限」と同じ） */
export async function getCalendar(auth: AuthContext, year: number): Promise<{ events: CalendarEvent[] }> {
  const offices = await officesInScope(auth);
  const ids = new Set(offices.map(o => o.id));
  const filings = await db.collection(`companies/${auth.companyId}/filingIndex`).where('open', '==', true).get();
  const deadlines: CalendarEvent[] = filings.docs.map(d => d.data())
    .filter(f => ids.has(f.officeId) && typeof f.deadline === 'string' && f.deadline.startsWith(String(year)))
    .map(f => ({ start: f.deadline, end: null, title: `${FILING_LABELS[f.filingType] ?? f.filingType}の期限（${f.employeeName || `${f.personCount}名`}）`, kind: 'deadline' as const, officeName: f.officeName }));
  const todos = await listHomeTodos(auth);
  const procedures: CalendarEvent[] = todos.items
    .filter(t => typeof t.deadline === 'string' && t.deadline.startsWith(String(year)))
    .map(t => ({ start: t.deadline!, end: null, title: `${t.title}：${t.next}`, kind: 'deadline' as const, officeName: t.officeName }));
  const events = [...annualEvents(year), ...bonusEvents(year, offices.map(o => ({ name: o.data().name, bonusMonths: o.data().bonusMonths }))), ...deadlines, ...procedures];
  return { events: events.sort((a, b) => a.start.localeCompare(b.start)) };
}

/** 今月やること（会社×月で完了を記録） */
export async function getChecklist(auth: AuthContext, ym: string) {
  const offices = await officesInScope(auth);
  const bonusMonth = offices.some(o => (o.data().bonusMonths ?? []).includes(Number(ym.slice(5, 7))));
  const snap = await db.doc(`companies/${auth.companyId}/monthlyChecklists/${ym}`).get();
  const done = (snap.data()?.done ?? {}) as Record<string, { at: Timestamp; byName: string }>;
  return {
    yearMonth: ym,
    items: monthlyChecklist(ym, bonusMonth).map(i => ({ ...i, done: !!done[i.key], doneAt: done[i.key]?.at?.toDate().toISOString() ?? null, doneBy: done[i.key]?.byName ?? null })),
  };
}

export async function setChecklistItem(auth: AuthContext, ym: string, key: string, done: boolean) {
  const user = await db.doc(`companies/${auth.companyId}/users/${auth.uid}`).get();
  const ref = db.doc(`companies/${auth.companyId}/monthlyChecklists/${ym}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const cur = { ...(snap.data()?.done ?? {}) };
    if (done) cur[key] = { at: Timestamp.now(), by: auth.uid, byName: user.data()?.displayName ?? '' };
    else delete cur[key];
    tx.set(ref, { done: cur, updatedAt: Timestamp.now() }, { merge: true });
  });
  return { success: true };
}

export async function getReminderDays(companyId: string): Promise<number> {
  const snap = await db.doc(`companies/${companyId}/settings/reminders`).get();
  const v = snap.data()?.daysBefore;
  return typeof v === 'number' ? v : DEFAULT_REMINDER_DAYS;
}

export async function setReminderDays(auth: AuthContext, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 60) throw invalidArg('1〜60日で指定してください');
  await db.doc(`companies/${auth.companyId}/settings/reminders`).set({ daysBefore: days, updatedAt: Timestamp.now(), updatedBy: auth.uid }, { merge: true });
  return { success: true };
}

/**
 * 毎朝：期限が「何日前」の日にちょうど当たる届出を、事業所あてのお知らせにする（同じ日に二重に出さない）。
 * メールは送らない（送る仕組みがないため。docs/stage9-plan.md の#5）
 */
export async function sendDeadlineReminders(companyId: string): Promise<number> {
  const days = await getReminderDays(companyId);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const target = addDays(today, days);
  const filings = await db.collection(`companies/${companyId}/filingIndex`).where('open', '==', true).get();
  const due = filings.docs.map(d => d.data()).filter(f => f.deadline === target);
  if (due.length === 0) return 0;
  const byOffice = new Map<string, typeof due>();
  for (const f of due) byOffice.set(f.officeId, [...(byOffice.get(f.officeId) ?? []), f]);
  const batch = db.batch();
  const now = Timestamp.now();
  for (const [officeId, list] of byOffice) {
    batch.set(db.doc(`companies/${companyId}/notifications/reminder_${today}_${officeId}`), {
      title: `${days}日後（${target}）が期限の届出が${list.length}件あります`,
      body: list.slice(0, 5).map(f => `${FILING_LABELS[f.filingType] ?? f.filingType}（${f.employeeName || `${f.personCount}名`}）`).join('、') + (list.length > 5 ? ` ほか${list.length - 5}件` : ''),
      category: 'action', targetType: 'office', targetId: officeId, createdBy: 'system', createdAt: now, updatedAt: now,
    });
  }
  await batch.commit();
  return due.length;
}
