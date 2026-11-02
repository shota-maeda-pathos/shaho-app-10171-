import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, WizardComponent, WizardStep } from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';

type Key = 'entry' | 'grade_approval' | 'correct' | 'settle' | 'done';
const KEYS: Key[] = ['entry', 'grade_approval', 'correct', 'settle'];

interface ImpactMonth {
  yearMonth: string; state: 'unconfirmed' | 'pending' | 'confirmed';
  beforeEmployee: number; beforeEmployer: number; afterEmployee: number | null; afterEmployer: number | null; collected: number | null; error: string | null; settlement: number;
}
interface Impact {
  before: null | { effectiveMonth: string; healthGradeNumber: number; healthStandardRemuneration: number; pensionGradeNumber: number; pensionStandardRemuneration: number; determinationType: string; filingId: string | null };
  nextGradeMonth: string | null;
  months: ImpactMonth[];
  totals: { employeeDiff: number; employerDiff: number; settlement: number };
  filings: { id: string; filingType: string; label: string; status: string }[];
  notes: string[];
}
interface Entry {
  reasonType: 'pensionOffice' | 'error'; reason: string; effectiveMonth: string | null; healthGradeNumber: number | null; pensionGradeNumber: number | null;
  before: { healthGradeNumber: number; pensionGradeNumber: number; healthStandardRemuneration: number; pensionStandardRemuneration: number } | null;
  correctedMonths: string[];
  diffs: { yearMonth: string; beforeEmployee: number; beforeEmployer: number; afterEmployee: number; afterEmployer: number; collected: number | null }[];
  settlement: { method: 'nextPayroll' | 'separate' | 'none'; payMonth: string | null; amount: number; note: string } | null;
}
interface View {
  procedure: { id: string; version: number; status: string; title: string; employeeName: string };
  current: Key;
  employee: { id: string; employeeNumber: string; name: string };
  entry: Entry;
  reasonLabel: string;
  approval: { status: string; comment: string | null } | null;
  impact: Impact | null;
  settlementTotal: number;
}

const STATE_LABEL = { unconfirmed: '未確定', pending: '確認を依頼中', confirmed: '確定済み' } as const;

/**
 * 等級の遡及訂正のウィザード（カタログ5章 修正等級・6章 訂正・遡及）。
 * 直す等級を入れて影響（月・差額・届出）を確かめ → 等級の承認 → 影響する月の保険料をまとめて直す → 精算の方法を記録する
 */
@Component({
  selector: 'app-grade-correction-wizard',
  standalone: true,
  imports: [DecimalPipe, NgTemplateOutlet, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule,
    WizardComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent],
  templateUrl: './grade-correction-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss'],
  styles: [`
    table.months { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); margin-bottom: var(--app-space-3); }
    table.months th, table.months td { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    table.months .num { text-align: right; }
    .plus { color: var(--app-status-action-fg); } .minus { color: var(--app-status-done-fg); }
  `],
})
export class GradeCorrectionWizardComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  procedureId = '';
  view = signal<View | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);
  stateLabel(s: string) { return STATE_LABEL[s as keyof typeof STATE_LABEL] ?? s; }

  effectiveMonth = '';
  healthGradeNumber: number | null = null;
  pensionGradeNumber: number | null = null;
  reasonType: 'pensionOffice' | 'error' = 'pensionOffice';
  reason = '';
  preview = signal<Impact | null>(null);
  previewError = signal('');
  failures = signal<{ yearMonth: string; message: string }[]>([]);
  method: 'nextPayroll' | 'separate' | 'none' = 'nextPayroll';
  payMonth = '';
  note = '';

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  rejected = computed(() => this.view()?.approval?.status === 'rejected' && this.view()?.current === 'entry');

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    return [
      { key: 'entry', label: '直す等級', done: done || cur > 0, attention: this.rejected(),
        what: '直す等級と適用月、理由を入れます。どの月の保険料がいくら変わるかをシステムが出します。',
        caution: '承認されると、その月の等級が書き換わります。' },
      { key: 'grade_approval', label: '等級の承認', done: done || cur > 1, waitingFor: cur === 1 && !done ? '承認者' : undefined,
        what: '別の担当者が等級を確かめて承認します。承認されると等級が確定します。' },
      { key: 'correct', label: '保険料を直す', done: done || cur > 2,
        what: '影響する月の保険料を、確定済みなら訂正して計算し直し、確認を依頼します。前の内容は訂正の履歴に残ります。',
        caution: '確定済みの月は、承認し直すまで本人のポータルで「未確定」になります。' },
      { key: 'settle', label: '差額の精算', done,
        what: '本人から追加で集める額・返す額の精算の方法を記録して、手続きを完了にします。実際の控除・入金は毎月の処理の「徴収の記録」で記録します。' },
    ];
  });

  nextLabel(): string | undefined {
    if (!this.view() || this.isDone() || this.index() < this.currentIndex()) return undefined;
    switch (this.key()) {
      case 'entry': return '等級の承認を依頼する';
      case 'correct': return this.failures().length ? '残りの月を直す' : '影響する月の保険料を直す';
      case 'settle': return '記録して完了する';
      default: return undefined;
    }
  }

  hideNext() {
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (this.index() < this.currentIndex()) return false;
    return this.key() === 'grade_approval';
  }

  nextDisabled() {
    if (this.index() < this.currentIndex()) return false;
    if (this.key() === 'entry') return !this.effectiveMonth || !this.healthGradeNumber || !this.pensionGradeNumber || !this.reason.trim() || !this.preview();
    if (this.key() === 'settle') return this.method === 'nextPayroll' && !this.payMonth;
    return false;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (id === 'new') {
      try {
        const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'gradeCorrectionStart')({
          companyId: this.auth.companyId, employeeId: this.route.snapshot.queryParamMap.get('employeeId') ?? '',
        });
        this.procedureId = data.procedureId;
        await this.router.navigate(['/grade-corrections', data.procedureId], { replaceUrl: true });
      } catch (e) {
        this.loading.set(false);
        this.loadError.set(errorMessage(e, '手続きを始められませんでした'));
        return;
      }
    } else {
      this.procedureId = id;
    }
    await this.load(true);
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, View>(this.functions, 'gradeCorrectionGet')({ companyId: this.auth.companyId, procedureId: this.procedureId });
      this.view.set(data);
      const e = data.entry;
      if (e.effectiveMonth && !this.effectiveMonth) {
        this.effectiveMonth = e.effectiveMonth; this.healthGradeNumber = e.healthGradeNumber; this.pensionGradeNumber = e.pensionGradeNumber;
        this.reasonType = e.reasonType; this.reason = e.reason;
        if (data.current === 'entry') void this.changed();
      }
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  async changed() {
    this.preview.set(null);
    if (!this.effectiveMonth || !this.healthGradeNumber || !this.pensionGradeNumber) return;
    try {
      const { data } = await httpsCallable<object, Impact>(this.functions, 'gradeCorrectionPreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, effectiveMonth: this.effectiveMonth,
        healthGradeNumber: Number(this.healthGradeNumber), pensionGradeNumber: Number(this.pensionGradeNumber),
      });
      this.preview.set(data);
      this.previewError.set('');
    } catch (e) {
      this.previewError.set(errorMessage(e, '影響を出せませんでした'));
    }
  }

  async advance() {
    if (this.index() < this.currentIndex()) { this.index.set(this.index() + 1); return; }
    switch (this.key()) {
      case 'entry':
        await this.run('entry', {
          effectiveMonth: this.effectiveMonth, healthGradeNumber: Number(this.healthGradeNumber), pensionGradeNumber: Number(this.pensionGradeNumber),
          reasonType: this.reasonType, reason: this.reason,
        }, '等級の承認を依頼しました');
        return;
      case 'correct': {
        const r = await this.run<{ corrected: number; failures: { yearMonth: string; message: string }[] }>('correct', {}, '');
        if (r) {
          this.failures.set(r.failures);
          this.snackBar.open(r.failures.length ? `${r.corrected}か月を直しました。${r.failures.length}か月が残っています` : `${r.corrected}か月の保険料を直し、確認を依頼しました`, '閉じる', { duration: 6000 });
        }
        return;
      }
      case 'settle':
        await this.run('settle', { method: this.method, payMonth: this.method === 'nextPayroll' ? this.payMonth : null, note: this.note }, '手続きを完了にしました');
        return;
    }
  }

  private async run<T = unknown>(step: string, payload: object, done: string): Promise<T | null> {
    const v = this.view();
    if (!v) return null;
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, T>(this.functions, 'gradeCorrectionUpdate')({ companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload });
      if (done) this.snackBar.open(done, '閉じる', { duration: 5000 });
      await this.load(true);
      return data;
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  signed(n: number) { return `${n > 0 ? '+' : ''}${n.toLocaleString('ja-JP')}円`; }
  settlementText(n: number) { return n > 0 ? `本人から ${n.toLocaleString('ja-JP')}円 を追加で集める` : n < 0 ? `本人に ${(-n).toLocaleString('ja-JP')}円 を返す` : '本人との差額はありません'; }
  diffTotal(e: Entry) { return e.diffs.reduce((a, d) => a + d.afterEmployee - d.beforeEmployee, 0); }
}
