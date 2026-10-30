import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { FilingAttachmentsComponent } from '../filings/attachments/filing-attachments';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import {
  BulkAction, BulkRun, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusTone, StepLeadComponent, StepperComponent, StepperItem,
  TargetCellDirective, TargetDetailDirective, TargetListComponent, TargetRow, TermComponent, needsMe,
} from '../../shared/ui';
import { ConfirmService } from '../../shared/confirm-dialog/confirm-dialog';
import { SanteiInputDialogComponent } from '../santei/santei-dialogs';
import {
  ACTION_STEP, BonusAction, BonusPayment, BonusRow, FILING_STATUS_LABELS, FilingDetail, FilingSummary, ImportResult, JobSummary, monthLabel, Overview,
  StepKey, stepState,
} from './bonus.types';
import { BonusFilingDialogComponent, BonusPersonComponent } from './bonus-dialogs';

/** ステップ。what は本体の見出しの横に出す1行。注意は操作バーの主ボタンの横に出す（BulkAction の caution） */
interface StepDef { key: StepKey; label: string; what: string }

const STEPS: StepDef[] = [
  { key: 'entry', label: '賞与の登録', what: 'この月に支給した賞与を、CSV・表の貼り付け・1人ずつのどれかで登録します。' },
  { key: 'review', label: '賞与額の承認', what: '登録した賞与額を確かめて、別の担当者に承認してもらいます。' },
  { key: 'premium', label: '保険料の計算', what: '標準賞与額から保険料を計算し、承認してもらいます。' },
  { key: 'filing', label: '届出の提出', what: '保険料が承認された人をまとめて賞与支払届を作り、承認を受けて提出します。' },
];

/**
 * 賞与（一括型）。事業所×支給月ごとに、4つのステップを順に進める。
 * 判定はすべてサーバーで行い、各ステップでは要対応の人だけを先に表示して、全員にまとめて操作する。
 */
@Component({
  selector: 'app-bonus',
  standalone: true,
  imports: [
    DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule,
    TargetListComponent, TargetCellDirective, TargetDetailDirective, ErrorStateComponent, LoadingStateComponent, TermComponent, FilingSubmissionComponent, FilingAttachmentsComponent,
    PageHeadComponent, StepperComponent, StepLeadComponent, BonusPersonComponent,
  ],
  templateUrl: './bonus.html',
  styleUrl: './bonus.scss',
})
export class BonusComponent implements OnInit {
  office = inject(OfficeContextService);
  private auth = inject(AuthService);
  private functions = inject(Functions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);
  private destroyRef = inject(DestroyRef);

  readonly steps = STEPS;
  readonly statusLabels = FILING_STATUS_LABELS;
  readonly monthLabel = monthLabel;
  payMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  data = signal<Overview | null>(null);
  loading = signal(false);
  error = signal('');
  busy = signal(false);
  job = signal<JobSummary | null>(null);
  failures = signal<{ step: StepKey; action: BonusAction; byId: Record<string, string> } | null>(null);
  selectedStep = signal<StepKey | null>(null);
  importResult = signal<ImportResult | null>(null);
  csvName = signal('');
  pasting = signal(false);
  pasteText = '';
  private csvText = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  canApprove = computed(() => this.data()?.me.canApprove ?? false);
  rowsById = computed(() => new Map((this.data()?.rows ?? []).map(r => [r.employeeId, r])));
  /** 賞与支払届（不支給報告書は別に扱う） */
  activeFilings = computed(() => (this.data()?.filings ?? []).filter(f => f.status !== 'cancelled' && (f.filingType ?? 'bonusPayment') === 'bonusPayment'));
  cancelledFilings = computed(() => (this.data()?.filings ?? []).filter(f => f.status === 'cancelled' && (f.filingType ?? 'bonusPayment') === 'bonusPayment'));
  /** この月の賞与不支給報告書（取り消したものは除く） */
  nonPaymentReport = computed(() => (this.data()?.filings ?? []).find(f => f.filingType === 'bonusNonPayment' && f.status !== 'cancelled') ?? null);
  /** 届出に載せられる人（保険料が承認され、まだ届出に載っていない人） */
  toFile = computed(() => (this.data()?.rows ?? []).filter(r => !r.hold && stepState('filing', r)?.label === '届出 未作成'));
  paidCount = computed(() => (this.data()?.rows ?? []).filter(r => r.bonus).length);
  /** 支給予定月なのに賞与がない（終わった月は不支給報告書が必要） */
  nonPayment = computed(() => {
    const d = this.data();
    // 報告書で支給予定月を変えた後も、作った報告書は表示する
    if (!d || this.paidCount() > 0 || (!d.scheduled && !this.nonPaymentReport())) return null;
    return { ended: d.monthEnded, reported: d.nonPayment };
  });

  /** 承認待ちを自分が承認できるか（自分が依頼したものは承認できない） */
  approvable(step: 'review' | 'premium') {
    const review = step === 'review' ? this.data()?.reviews.bonus : this.data()?.reviews.premium;
    return this.canApprove() && !review?.mine;
  }

  /** 1人分の状態。承認者には、承認待ちの人を「あなたの番」として見せる */
  stateFor(step: StepKey, r: BonusRow) {
    const state = stepState(step, r);
    if (state?.label === '承認待ち' && (step === 'review' || step === 'premium') && this.approvable(step)) return { tone: 'yours' as StatusTone, label: 'あなたの承認待ち' };
    return state;
  }

  filingTone(f: FilingSummary): StatusTone {
    if (f.status === 'submitted') return 'done';
    if (f.status === 'approved' && ['sent', 'received', 'processing'].includes(f.mockStatus ?? '')) return 'waiting';
    if (f.status === 'approved' && ['failed', 'returned'].includes(f.mockStatus ?? '')) return 'error';
    if (f.status === 'pending') return this.canApprove() && !f.mine ? 'yours' : 'waiting';
    return f.rejection && f.status === 'draft' ? 'attention' : 'yours';
  }

  summaries = computed(() => STEPS.map(step => {
    const fails = this.failures()?.step === step.key ? this.failures()!.byId : {};
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold).flatMap(r => {
      const s = this.stateFor(step.key, r);
      return s ? [fails[r.employeeId] ? { ...s, tone: 'error' as StatusTone } : s] : [];
    });
    let todo = rows.filter(s => needsMe(s.tone)).length;
    let attention = rows.filter(s => s.tone === 'attention' || s.tone === 'error').length;
    let waiting = rows.filter(s => s.tone === 'waiting').length;
    let total = rows.length;
    if (step.key === 'filing') {
      // 届出のステップは、届出に載っていない人と、承認・提出の終わっていない届出を数える
      const tones = this.activeFilings().map(f => this.filingTone(f));
      todo += tones.filter(t => needsMe(t)).length;
      attention += tones.filter(t => t === 'attention' || t === 'error').length;
      waiting += tones.filter(t => t === 'waiting').length;
      total += tones.length;
    }
    return { key: step.key, total, todo, attention, waiting, done: total > 0 && todo === 0 && waiting === 0, empty: total === 0 };
  }));
  /** 横並びのステップ。数字は1つだけ（要確認 → 残り → 承認待ち → 完了 → —） */
  stepItems = computed<StepperItem[]>(() => this.summaries().map((s, i) => {
    const step = STEPS[i];
    const unit = s.key === 'filing' && !this.toFile().length ? '件' : '名';
    const note = s.attention ? `要確認 ${s.attention}${unit}`
      : s.key === 'entry' && this.paidCount() ? `${this.paidCount()}名 登録済み`
      : s.key === 'filing' && this.toFile().length ? `${this.toFile().length}名 届出 未作成`
      : s.todo ? `残り ${s.todo}${unit}`
      : s.waiting ? `承認待ち ${s.waiting}${unit}`
      : s.done ? '完了' : '—';
    const state = s.attention ? 'attention' : s.done || (s.key === 'entry' && this.paidCount() && !s.todo) ? 'done' : !s.todo && s.waiting ? 'waiting' : 'todo';
    return { key: step.key, label: step.label, state, note };
  }));
  /** 開くステップ。承認を頼まれていればそのステップ、なければ自分がやることのある最初のステップ、それもなければ最初の未完了ステップ */
  firstOpen = computed<StepKey>(() => {
    const sums = this.summaries();
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold);
    for (const step of ['review', 'premium'] as const) {
      if (rows.some(r => this.stateFor(step, r)?.label === 'あなたの承認待ち')) return step;
    }
    if (this.activeFilings().some(f => f.status === 'pending' && this.filingTone(f) === 'yours')) return 'filing';
    if (!this.paidCount()) return 'entry';
    return sums.find(s => s.todo > 0)?.key ?? sums.find(s => !s.done && !s.empty)?.key ?? 'filing';
  });
  current = computed(() => this.selectedStep() ?? this.firstOpen());
  currentDef = computed(() => STEPS.find(s => s.key === this.current())!);
  /** すべて提出済みで、残りの人もいない */
  complete = computed(() => {
    const sums = this.summaries();
    return this.activeFilings().length > 0 && sums.every(s => s.todo === 0 && s.waiting === 0);
  });

  actions = computed<BulkAction[]>(() => {
    const month = monthLabel(this.payMonth);
    const approve = (key: BonusAction, what: string): BulkAction[] => this.canApprove() ? [{
      key, label: '承認する', appliesTo: (r: TargetRow) => r.statusLabel === 'あなたの承認待ち',
      caution: `承認した${what}は、差し戻さないと直せません。`,
      confirm: { title: `${month}支給の${what}を承認する`, message: `一覧で内容を確かめた人の${what}を承認します。`, notice: `承認した${what}は、差し戻さないと直せません。` },
    }] : [];
    switch (this.current()) {
      case 'review':
        return [{
          key: 'requestBonusApproval', label: '承認を依頼する', appliesTo: r => ['依頼前', '差し戻し'].includes(r.statusLabel),
          caution: '承認された賞与額だけが保険料と届出に使われます。依頼中は直せません。',
          confirm: { title: `${month}支給の賞与額の承認を依頼する`, message: '別の担当者（管理者・承認者）に、賞与額の承認を依頼します。承認者には通知が届きます。', notice: '依頼中は賞与額を直せません。直すときは差し戻してもらいます。' },
        }, ...approve('approveBonus', '賞与額')];
      case 'premium':
        return [
          { key: 'calculate', label: '保険料を計算する', appliesTo: r => ['未計算', '計算し直し', '差し戻し'].includes(r.statusLabel),
            caution: '上限（健保は年度累計573万円・厚年は月150万円）・産休育休の免除・70歳以上はシステムが判定します。' },
          { key: 'requestPremiumApproval', label: '承認を依頼する', appliesTo: r => ['依頼前', '差し戻し'].includes(r.statusLabel),
            caution: '賞与から控除する保険料です。承認されると届出に載せられます。',
            confirm: { title: `${month}支給の保険料の承認を依頼する`, message: '計算した保険料の承認を、別の担当者（管理者・承認者）に依頼します。', notice: '依頼中は計算し直せません。' } },
          ...approve('approvePremium', '保険料'),
        ];
      default:
        return [];
    }
  });
  /** 操作バーの文言（一括操作のないステップ） */
  barInfo = computed(() => {
    if (!this.data()) return '';
    switch (this.current()) {
      case 'entry': return `${this.paidCount()}名の賞与を登録済み。名前を押すと1人ずつ直せます。`;
      case 'filing': return this.toFile().length ? `${this.toFile().length}名が届出にまだ載っていません`
        : this.activeFilings().length ? `賞与支払届 ${this.activeFilings().length}件` : '届出に載せる人はいません（保険料が承認された人が対象です）';
      default: return '';
    }
  });
  cellHeader = computed(() => ({ entry: '賞与額', review: '賞与額 / 標準賞与額', premium: '保険料（本人 / 会社）', filing: '標準賞与額' })[this.current()]);

  targetRows = computed<TargetRow[]>(() => {
    const step = this.current();
    const fails = this.failures()?.step === step ? this.failures()!.byId : {};
    return (this.data()?.rows ?? []).flatMap(r => {
      let state = this.stateFor(step, r);
      if (!state && step === 'entry' && r.inPeriod) state = { tone: 'done', label: '支給なし' };
      if (!state) return [];
      const rejection = step === 'review' || step === 'entry' ? r.rejected.bonus : step === 'premium' ? r.rejected.premium : null;
      const reason = state.tone === 'done' && step !== 'entry' ? undefined
        : rejection && !r.bonus?.pending && !(step === 'premium' ? r.premium?.pending : r.bonus?.confirmed) ? `差し戻しの理由：${rejection}`
        : [...r.issues, ...(r.target === 'excluded' ? [r.targetReason] : []), ...r.warnings].join('／') || undefined;
      return [{ id: r.employeeId, name: r.name, sub: r.employeeNumber, tone: state.tone, statusLabel: state.label, reason, held: r.hold ?? undefined, error: fails[r.employeeId] }];
    });
  });

  reviewNote = computed(() => {
    const d = this.data();
    const step = this.current();
    if (!d || (step !== 'review' && step !== 'premium')) return null;
    const waiting = d.rows.filter(r => !r.hold && stepState(step, r)?.label === '承認待ち');
    if (!waiting.length) return null;
    const what = step === 'review' ? '賞与額' : '保険料';
    if (!this.approvable(step)) return { mine: true, text: `${waiting.length}名の${what}が承認待ちです。別の担当者（管理者・承認者）の承認を待っています。承認者には通知が届いています。` };
    return { mine: false, text: `${waiting.length}名の${what}の確認を頼まれています。一覧で内容を確かめ、問題がなければ「承認する」を押してください。直したい人は、承認の画面から差し戻せます。` };
  });

  constructor() {
    effect(() => {
      const officeId = this.office.selected();
      untracked(() => {
        this.data.set(null);
        this.selectedStep.set(null);
        this.failures.set(null);
        this.importResult.set(null);
        this.stopPolling();
        this.busy.set(false);
        if (officeId) void this.load();
      });
    });
  }

  ngOnInit() {
    const month = this.route.snapshot.queryParamMap.get('month');
    if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) this.payMonth = month;
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  row(id: string) { return this.rowsById().get(id); }

  async changeMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    this.payMonth = value;
    this.selectedStep.set(null);
    this.failures.set(null);
    this.importResult.set(null);
    await this.router.navigate([], { queryParams: { month: value }, queryParamsHandling: 'merge' });
    await this.load();
  }

  chooseOffice(id: string) { void this.office.change(id); }
  selectStep(key: StepKey) { this.selectedStep.set(key); }

  private call<T>(name: string, data: object, timeout = 70_000) {
    return httpsCallable<object, T>(this.functions, name, { timeout })({ companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, ...data });
  }

  /** 届出の提出の部品に渡す run のID（サーバーの bonusRunId と同じ形） */
  runId = () => `${this.office.selected()}_${this.payMonth}`;

  async load() {
    if (!this.office.selected()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await this.call<Overview>('bonusRunOverview', {}, 120_000);
      this.data.set(data);
      this.job.set(data.job);
      if (data.job?.status === 'running') this.startPolling(data.job.id);
      else if (data.job && data.job.failed > 0 && !this.failures()) await this.restoreFailures(data.job);
    } catch (e) {
      this.error.set(message(e, '状況を読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  /** 画面を開き直しても、直前の一括処理で失敗した人を一覧に出し、その人だけ再実行できるようにする */
  private async restoreFailures(job: JobSummary) {
    try {
      const { data } = await this.call<{ failures: { employeeId: string; message: string }[] }>('bonusJobGet', { jobId: job.id });
      const step = ACTION_STEP[job.action];
      const open = new Set((this.data()?.rows ?? []).filter(r => { const st = this.stateFor(step, r); return !!st && st.tone !== 'done'; }).map(r => r.employeeId));
      const byId = Object.fromEntries(data.failures.filter(f => open.has(f.employeeId)).map(f => [f.employeeId, f.message]));
      if (Object.keys(byId).length) {
        this.failures.set({ step, action: job.action, byId });
        if (!this.selectedStep()) this.selectedStep.set(step);
      }
    } catch {
      // 失敗の一覧が取れなくても、画面の表示は続ける
    }
  }

  // ---- 賞与の登録 ----

  /** 取込用のCSV（在籍している人の社員番号・氏名入り） */
  downloadTemplate() {
    const rows = (this.data()?.rows ?? []).filter(r => r.inPeriod);
    const day = `${this.payMonth}-10`;
    const lines = [['社員番号', '氏名', '支給日', '賞与額', '現物'], ...rows.map(r => [r.employeeNumber, r.name, day, '', ''])]
      .map(cells => cells.map(csvCell).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `賞与_${this.payMonth}_${this.data()?.office.name ?? ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async pickCsv(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!file) return;
    if (file.size > 2_000_000) { this.snackBar.open('ファイルが大きすぎます（2MBまで）', '閉じる', { duration: 5000 }); return; }
    const buffer = await file.arrayBuffer();
    // Excel で保存した CSV（Shift_JIS）にも対応する
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buffer);
    this.csvText = text;
    this.csvName.set(file.name);
    await this.importCsv(true);
  }

  /** Excel などから貼り付けた表（タブ区切りもカンマ区切りに直す） */
  async checkPasted() {
    const text = this.pasteText.trim();
    if (!text) return;
    this.csvText = text.split(/\r?\n/).map(line => line.includes('\t') ? line.split('\t').map(csvCell).join(',') : line).join('\n');
    this.csvName.set('貼り付けた表');
    await this.importCsv(true);
  }

  async importCsv(dryRun: boolean) {
    this.busy.set(true);
    try {
      const { data } = await this.call<ImportResult>('bonusRunImport', { csv: this.csvText, dryRun }, 300_000);
      this.importResult.set(data);
      if (!dryRun) {
        this.csvText = '';
        this.pasteText = '';
        this.pasting.set(false);
        this.snackBar.open(`${data.imported}名の賞与を取り込みました`, '閉じる', { duration: 5000 });
      }
    } catch (e) {
      this.snackBar.open(message(e, '取り込めませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    if (!dryRun) await this.load();
  }

  cancelImport() {
    this.importResult.set(null);
    this.csvText = '';
    this.csvName.set('');
  }

  async recordNonPayment(undo = false) {
    let reportedOn: string | null = null;
    if (!undo) {
      const value = await firstValueFrom(this.dialog.open(SanteiInputDialogComponent, {
        width: '460px',
        data: { title: '賞与不支給報告書を提出した日を記録する', label: '提出した日', type: 'date', button: '記録する', required: true,
          text: `${monthLabel(this.payMonth)}は賞与を支給しなかったものとして記録します。報告書は年金事務所に提出してください（この画面での作成は今後対応します）。` },
      }).afterClosed());
      if (!value) return;
      reportedOn = value;
    }
    this.busy.set(true);
    try {
      await this.call('bonusRunNonPayment', { reportedOn });
      this.snackBar.open(undo ? '記録を取り消しました' : '不支給報告書を提出したことを記録しました', '閉じる', { duration: 4000 });
    } catch (e) {
      this.snackBar.open(message(e, '記録できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // ---- 一括操作 ----

  async run(req: BulkRun) {
    await this.startJob(req.action as BonusAction, req.ids);
  }

  retry(ids: string[]) {
    const f = this.failures();
    if (f) void this.startJob(f.action, ids);
  }

  private async startJob(action: BonusAction, ids: string[]) {
    this.busy.set(true);
    try {
      const { data } = await this.call<{ jobId: string }>('bonusJobStart', { action, employeeIds: ids });
      this.failures.set({ step: ACTION_STEP[action], action, byId: {} });
      this.job.set({ id: data.jobId, action, label: '', total: ids.length, processed: 0, succeeded: 0, failed: 0, status: 'running', createdAt: null, completedAt: null });
      this.startPolling(data.jobId);
    } catch (e) {
      this.snackBar.open(message(e, '処理を始められませんでした'), '閉じる', { duration: 6000 });
      this.busy.set(false);
    }
  }

  private startPolling(jobId: string) {
    this.stopPolling();
    this.busy.set(true);
    this.timer = setInterval(() => void this.poll(jobId), 2000);
    void this.poll(jobId);
  }

  private stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private polling = false;
  private async poll(jobId: string) {
    if (this.polling) return;
    this.polling = true;
    try {
      const { data } = await this.call<{ job: JobSummary; failures: { employeeId: string; message: string }[] }>('bonusJobGet', { jobId });
      this.job.set(data.job);
      if (data.job.status === 'running') return;
      this.stopPolling();
      this.failures.set({ step: ACTION_STEP[data.job.action], action: data.job.action, byId: Object.fromEntries(data.failures.map(f => [f.employeeId, f.message])) });
      this.busy.set(false);
      this.snackBar.open(
        data.job.status === 'stalled' ? '処理が途中で止まりました。状況を読み込み直し、残った人をもう一度実行してください'
          : data.job.failed ? `${data.job.succeeded}名が終わりました。${data.job.failed}名は失敗しました（一覧に理由を表示）` : `${data.job.label}：${data.job.succeeded}名が終わりました`,
        '閉じる', { duration: 6000 });
      this.selectedStep.set(null);
      await this.load();
      if (data.job.failed) this.selectedStep.set(ACTION_STEP[data.job.action]);
    } catch (e) {
      this.stopPolling();
      this.busy.set(false);
      this.snackBar.open(message(e, '進み具合を確認できませんでした。読み込み直してください'), '閉じる', { duration: 6000 });
    } finally {
      this.polling = false;
    }
  }

  // ---- 保留 ----

  async hold(id: string, reason: string | null) {
    this.busy.set(true);
    try {
      await this.call('bonusRunHold', { employeeId: id, reason });
      this.data.update(d => d && { ...d, rows: d.rows.map(r => r.employeeId === id ? { ...r, hold: reason ? { reason } : null } : r) });
      const name = this.row(id)?.name ?? '';
      this.snackBar.open(reason ? `${name}さんを保留にしました。まとめて行う操作と届出の対象から外れます` : `${name}さんの保留を解除しました`, '閉じる', { duration: 4000 });
    } catch (e) {
      this.snackBar.open(message(e, '保留を変更できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // ---- 届出 ----

  /** 届出のステップの注意（期限） */
  filingCaution = computed(() => {
    const d = this.data();
    return d?.deadline ? `賞与支払届の期限は ${d.deadline}（支給日から5日以内）。保留中の人と保険料が未承認の人は載りません。` : '保留中の人と保険料が未承認の人は載りません。';
  });

  /** 期限の色（過ぎた・3日以内） */
  dueClass(date: string | null) {
    if (!date) return '';
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (date < today) return 'due-over';
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 3);
    return date <= soon.toISOString().slice(0, 10) ? 'due-soon' : '';
  }

  async createFiling() {
    this.busy.set(true);
    try {
      const { data } = await this.call<{ filingIds: string[]; persons: number }>('bonusFilingCreate', {}, 300_000);
      this.snackBar.open(`${data.persons}名の賞与支払届を作りました。内容を確かめて承認を依頼してください`, '閉じる', { duration: 6000 });
    } catch (e) {
      this.snackBar.open(message(e, '届出を作れませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  async updateFiling(f: FilingSummary, action: 'requestApproval' | 'approve' | 'reject' | 'cancel' | 'mockSubmit' | 'paperSubmit') {
    let extra: { comment?: string; date?: string } = {};
    if (action === 'reject' || action === 'paperSubmit' || action === 'cancel') {
      const value = await firstValueFrom(this.dialog.open(SanteiInputDialogComponent, {
        width: '460px',
        data: action === 'reject' ? { title: '届出を差し戻す', label: '差し戻しの理由', type: 'text', button: '差し戻す', required: true }
          : action === 'cancel' ? { title: '届出を取り消す', label: '', type: 'none', button: '取り消す', required: false,
            text: `${f.number}件目の届出（${f.personCount}名）を取り消します。載っていた人は「届出 未作成」に戻り、作り直せます。` }
          : { title: '紙で提出したことを記録する', label: '提出した日', type: 'date', button: '記録する', required: true },
      }).afterClosed());
      if (value === undefined || value === null) return;
      extra = action === 'reject' ? { comment: value } : action === 'paperSubmit' ? { date: value } : {};
    } else if (action === 'requestApproval' || action === 'approve') {
      const report = f.filingType === 'bonusNonPayment';
      const what = report ? '賞与不支給報告書' : `${f.number}件目の賞与支払届`;
      const count = report ? '1件' : `${f.personCount}名`;
      const ok = await this.confirm.ask(action === 'requestApproval'
        ? { title: `${what}の承認を依頼する`, count, message: '別の担当者（管理者・承認者）に、届出の承認を依頼します。', notice: '依頼中は届出を直せません。直すときは差し戻してもらいます。', confirmLabel: '承認を依頼する' }
        : { title: `${what}を承認する`, count, message: '内容とPDFを確かめた届出を承認します。承認すると提出できるようになります。', notice: '承認したあとに直すときは、承認を取り消します。', confirmLabel: '承認する' });
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const { data } = await this.call<{ success: boolean; mockErrors?: string[] }>('bonusFilingUpdate', { filingId: f.id, expectedVersion: f.version, action, ...extra });
      if (data.mockErrors?.length) {
        this.snackBar.open(`模擬電子申請で受け付けられませんでした：${data.mockErrors.slice(0, 3).join('／')}${data.mockErrors.length > 3 ? ` ほか${data.mockErrors.length - 3}件` : ''}`, '閉じる', { duration: 10000 });
      } else {
        this.snackBar.open(({
          requestApproval: '届出の承認を依頼しました', approve: '届出を承認しました', reject: '届出を差し戻しました', cancel: '届出を取り消しました',
          mockSubmit: '模擬電子申請で受け付けられました', paperSubmit: '紙で提出したことを記録しました',
        })[action], '閉じる', { duration: 5000 });
      }
    } catch (e) {
      this.snackBar.open(message(e, '届出を更新できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // ---- 賞与不支給報告書 ----

  npDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  npChange: 'keep' | 'change' | 'remove' = 'keep';
  npMonths = signal(new Set<number>());
  readonly allMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  toggleNpMonth(m: number, on: boolean) {
    const next = new Set(this.npMonths());
    if (on) next.add(m); else next.delete(m);
    this.npMonths.set(next);
  }

  monthsText(months: number[]) { return months.length ? months.map(m => `${m}月`).join('・') : 'なし'; }

  async createNonPayment() {
    const change = this.npChange === 'change' ? { kind: 'change', months: [...this.npMonths()].sort((a, b) => a - b) } : { kind: this.npChange };
    this.busy.set(true);
    try {
      await this.call('bonusNonPaymentFilingCreate', { change, reportDate: this.npDate });
      this.snackBar.open('賞与不支給報告書を作りました。内容とPDFを確かめて承認を依頼してください', '閉じる', { duration: 6000 });
    } catch (e) {
      this.snackBar.open(message(e, '報告書を作れませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  async nonPaymentPdf(f: FilingSummary) {
    this.busy.set(true);
    try {
      const { data } = await this.call<FilingDetail>('bonusFilingGet', { filingId: f.id });
      const [{ createBonusNonPaymentPdf, OFFICIAL_FORMS }, { OfficialPdfPreviewComponent }] = await Promise.all([
        import('../filings/templates/official-filing-pdf'), import('../filings/templates/official-pdf-preview'),
      ]);
      const h = data.header;
      const output = await createBonusNonPaymentPdf(h, {
        companyName: String(h['会社名'] ?? ''), officeName: String(h['事業所名称'] ?? ''), officeNumber: String(h['事業所整理記号'] ?? ''),
        officeAddress: String(h['事業所所在地'] ?? ''), officePhone: String(h['電話番号'] ?? ''), representativeName: String(h['事業主氏名'] ?? ''),
        effectiveDate: String(h['届出年月日'] ?? ''),
      });
      const form = OFFICIAL_FORMS['bonusNonPayment'];
      this.dialog.open(OfficialPdfPreviewComponent, {
        width: '1100px', height: '94vh', maxWidth: '96vw',
        data: { ...output, title: form.title, filename: `${form.title}_${this.payMonth}.pdf`,
          sourceUrl: `https://www.nenkin.go.jp/shinsei/kounen/tekiyo/${form.source}`, originalUrl: `/filing-forms/${form.file}.pdf` },
      });
    } catch (e) {
      this.snackBar.open(message(e, 'PDFを作れませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async openFiling(f: FilingSummary) {
    try {
      this.busy.set(true);
      const { data } = await this.call<FilingDetail>('bonusFilingGet', { filingId: f.id });
      this.dialog.open(BonusFilingDialogComponent, { data: { filing: data, payMonth: this.payMonth }, width: '1000px', maxWidth: '96vw' });
    } catch (e) {
      this.snackBar.open(message(e, '届出を読み込めませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  /** 右のパネルで直した1人分の賞与を保存する（2回目の支給の追加もここで行う。空の一覧は登録を消す） */
  async savePerson(id: string, payments: BonusPayment[]) {
    const r = this.row(id);
    if (!r) return;
    if (!payments.length && !(await this.confirm.ask({ title: `${r.name}さんの賞与の登録を消す`, message: `${monthLabel(this.payMonth)}の支給をすべて消します。`, confirmLabel: '登録を消す', warn: true }))) return;
    this.busy.set(true);
    try {
      const { data } = await this.call<{ warnings: string[] }>('bonusRunEntry', { employeeId: id, payments, expectedVersion: r.bonus?.version ?? 0 });
      this.snackBar.open(payments.length ? `${r.name}さんの賞与を保存しました${data.warnings.length ? `（${data.warnings[0]}）` : ''}` : `${r.name}さんの賞与の登録を消しました`, '閉じる', { duration: 6000 });
    } catch (e) {
      this.snackBar.open(message(e, '保存できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}

function csvCell(v: string) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function message(e: unknown, fallback: string) {
  return e instanceof Error && e.message && e.message !== 'INTERNAL' ? e.message : fallback;
}
