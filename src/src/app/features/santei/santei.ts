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
  BulkAction, BulkRun, ErrorStateComponent, LoadingStateComponent, StatusTone, TargetCellDirective, TargetListComponent, TargetRow, TermComponent,
} from '../../shared/ui';
import {
  ACTION_STEP, defaultSanteiYear, FILING_STATUS_LABELS, FilingDetail, FilingSummary, gradeChangeText, JobSummary, Overview, SanteiAction, SanteiRow,
  StepKey, stepState,
} from './santei.types';
import { SanteiDetailDialogComponent, SanteiFilingDialogComponent, SanteiInputDialogComponent } from './santei-dialogs';

interface StepDef { key: StepKey; label: string; what: string; why: string; next: string }

const STEPS: StepDef[] = [
  { key: 'target', label: '対象者を確かめる', what: '4〜6月に支払った承認済みの給与から、対象の人と対象外の人をシステムが分けます。給与が未承認・未登録の人は毎月の処理で承認するか、決められない人（無給の休職など）は保留にします。支払基礎日数が足りない人は決め方を選びます。', why: '6月1日以降に資格を取った人や、7〜9月に随時改定がある人は定時決定の対象外です。給与の誤りがあると等級を誤るため、承認済みの給与だけを使います。', next: '対象の人の新しい等級を確かめ、承認を依頼します。' },
  { key: 'review', label: '等級の承認', what: '4〜6月の平均と、今の等級・新しい等級を見比べ、別の担当者に承認を依頼します。承認者はこの画面で内容を見て、まとめて承認します。', why: '新しい等級は9月分から1年間の保険料を決めるため、作った人とは別の目で確かめます。', next: '承認された等級は9月分から使われます。承認された人で算定基礎届を作ります。' },
  { key: 'filing', label: '算定基礎届を作る', what: '等級が承認された人をまとめて、事業所の算定基礎届を1件作ります。後から承認された人は、追加の届出にします。', why: '届出は承認された値から作るため、手で書き写す必要がありません。', next: '届出の承認を依頼し、提出します。' },
  { key: 'submit', label: '届出の承認と提出', what: '届出の内容を確かめて承認を依頼し、承認されたら模擬電子申請するか、紙で提出したことを記録します。', why: '算定基礎届は毎年7月1日〜10日に、事業所の全員分をまとめて提出します。', next: 'すべて提出すれば、この年の算定基礎届は完了です。' },
];

/**
 * 算定基礎届（一括型）。事業所×年ごとに、4つのステップを順に進める。
 * 判定はすべてサーバーで行い、各ステップでは要対応の人だけを先に表示して、全員にまとめて操作する。
 */
@Component({
  selector: 'app-santei',
  standalone: true,
  imports: [
    DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule,
    TargetListComponent, TargetCellDirective, ErrorStateComponent, LoadingStateComponent, TermComponent, FilingSubmissionComponent, FilingAttachmentsComponent,
  ],
  templateUrl: './santei.html',
  styleUrl: './santei.scss',
})
export class SanteiComponent implements OnInit {
  office = inject(OfficeContextService);
  private auth = inject(AuthService);
  private functions = inject(Functions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  readonly steps = STEPS;
  readonly statusLabels = FILING_STATUS_LABELS;
  readonly thisYear = new Date().getFullYear();
  readonly years = [this.thisYear - 2, this.thisYear - 1, this.thisYear];
  year = defaultSanteiYear();
  data = signal<Overview | null>(null);
  loading = signal(false);
  error = signal('');
  busy = signal(false);
  job = signal<JobSummary | null>(null);
  failures = signal<{ step: StepKey; action: SanteiAction | 'decide'; byId: Record<string, string> } | null>(null);
  selectedStep = signal<StepKey | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  canApprove = computed(() => this.data()?.me.canApprove ?? false);
  rowsById = computed(() => new Map((this.data()?.rows ?? []).map(r => [r.employeeId, r])));
  activeFilings = computed(() => (this.data()?.filings ?? []).filter(f => f.status !== 'cancelled'));
  cancelledFilings = computed(() => (this.data()?.filings ?? []).filter(f => f.status === 'cancelled'));
  /** 届出に載せられる人（等級が承認され、まだ届出に載っていない人） */
  toFile = computed(() => (this.data()?.rows ?? []).filter(r => !r.hold && stepState('filing', r)?.label === '届出 未作成'));

  /** 承認待ちの人のうち、自分が承認できる人（自分が依頼した人は除く） */
  approvable(r: SanteiRow) {
    return this.canApprove() && r.approval.status === 'pending' && r.approval.requestedBy !== this.data()?.me.uid;
  }

  /** 1人分の状態。承認者には、承認待ちの人を「あなたの番」として見せる */
  stateFor(step: StepKey, r: SanteiRow) {
    if (step === 'submit') return null;
    const state = stepState(step, r);
    if (state?.label === '承認待ち' && this.approvable(r)) return { tone: 'yours' as StatusTone, label: 'あなたの承認待ち' };
    return state;
  }

  filingTone(f: FilingSummary): StatusTone {
    if (f.status === 'submitted') return 'done';
    if (f.status === 'approved' && ['sent', 'received', 'processing'].includes(f.mockStatus ?? '')) return 'waiting';
    if (f.status === 'pending') return this.canApprove() && !f.mine ? 'yours' : 'waiting';
    return 'action';
  }

  summaries = computed(() => STEPS.map(step => {
    if (step.key === 'submit') {
      const filings = this.activeFilings();
      const tones = filings.map(f => this.filingTone(f));
      const todo = tones.filter(t => t === 'action' || t === 'yours').length;
      const waiting = tones.filter(t => t === 'waiting').length;
      return { key: step.key, total: filings.length, todo, waiting, done: filings.length > 0 && todo === 0 && waiting === 0 && this.toFile().length === 0, empty: filings.length === 0, unit: '件' };
    }
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold).map(r => this.stateFor(step.key, r)).filter(s => s !== null);
    const todo = rows.filter(s => s!.tone === 'action' || s!.tone === 'yours').length;
    const waiting = rows.filter(s => s!.tone === 'waiting').length;
    return { key: step.key, total: rows.length, todo, waiting, done: rows.length > 0 && todo === 0 && waiting === 0, empty: rows.length === 0, unit: '名' };
  }));
  /** 開くステップ。承認を頼まれていればそのステップ、なければ自分がやることのある最初のステップ、それもなければ最初の未完了ステップ */
  firstOpen = computed<StepKey>(() => {
    const sums = this.summaries();
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold);
    if (rows.some(r => this.approvable(r))) return 'review';
    if (this.activeFilings().some(f => this.filingTone(f) === 'yours')) return 'submit';
    return sums.find(s => s.todo > 0)?.key ?? sums.find(s => !s.done && !s.empty)?.key ?? 'submit';
  });
  current = computed(() => this.selectedStep() ?? this.firstOpen());
  currentDef = computed(() => STEPS.find(s => s.key === this.current())!);
  /** すべて提出済みで、残りの人もいない */
  complete = computed(() => {
    const sums = this.summaries();
    return sums.find(s => s.key === 'submit')!.done && sums.every(s => s.todo === 0 && s.waiting === 0);
  });
  changedCounts = computed(() => {
    const filed = (this.data()?.rows ?? []).filter(r => r.approval.status === 'approved' && r.proposed);
    const up = filed.filter(r => r.current && r.proposed!.healthGradeNumber > r.current.healthGradeNumber).length;
    const down = filed.filter(r => r.current && r.proposed!.healthGradeNumber < r.current.healthGradeNumber).length;
    return { total: filed.length, up, down, same: filed.length - up - down };
  });

  actions = computed<BulkAction[]>(() => {
    switch (this.current()) {
      case 'target':
        return [{ key: 'decidePrevious', label: '従前の等級で決める', appliesTo: r => r.statusLabel === '決め方が必要' && !!this.rowsById().get(r.id)?.current }];
      case 'review':
        return [
          { key: 'requestGradeApproval', label: '承認を依頼', appliesTo: r => r.tone === 'action' },
          ...(this.canApprove() ? [{ key: 'approveGrade', label: '承認する', appliesTo: (r: TargetRow) => r.tone === 'yours' }] : []),
        ];
      default:
        return [];
    }
  });
  cellHeader = computed(() => ({ target: '4〜6月の平均', review: '平均 / 等級', filing: '新しい等級', submit: '' })[this.current()]);

  targetRows = computed<TargetRow[]>(() => {
    const step = this.current();
    const fails = this.failures()?.step === step ? this.failures()!.byId : {};
    return (this.data()?.rows ?? []).flatMap(r => {
      const state = this.stateFor(step, r);
      if (!state) return [];
      const reason = step === 'review' && r.approval.status === 'rejected' ? `差し戻しの理由：${r.approval.rejection}`
        : step === 'review' && state.tone !== 'done' && r.septemberTaken ? '9月の等級が定時決定以外で登録済みです（等級の画面で確かめてください）'
        : step === 'target' || state.tone === 'action' ? r.reason : undefined;
      return [{
        id: r.employeeId, name: r.employeeName, sub: r.employeeNumber, tone: state.tone, statusLabel: state.label, reason,
        held: r.hold ?? undefined, error: fails[r.employeeId],
      }];
    });
  });

  reviewNote = computed(() => {
    const d = this.data();
    if (!d || this.current() !== 'review') return null;
    const waiting = d.rows.filter(r => !r.hold && r.approval.status === 'pending');
    if (!waiting.length) return null;
    const mine = waiting.filter(r => this.approvable(r)).length;
    if (!mine) return { mine: true, text: `${waiting.length}名が承認待ちです。別の担当者（管理者・承認者）の承認を待っています。承認者には通知が届いています。` };
    return { mine: false, text: `${mine}名の等級の確認を頼まれています。一覧で平均と等級を確かめ、問題がなければ「承認する」を押してください。直したい人は、名前を押して承認の画面から差し戻せます。` };
  });

  constructor() {
    effect(() => {
      const officeId = this.office.selected();
      untracked(() => {
        this.data.set(null);
        this.selectedStep.set(null);
        this.failures.set(null);
        this.stopPolling();
        this.busy.set(false);
        if (officeId) void this.load();
      });
    });
  }

  ngOnInit() {
    const year = Number(this.route.snapshot.queryParamMap.get('year'));
    if (Number.isInteger(year) && year >= 2020 && year <= this.thisYear) this.year = year;
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  row(id: string) { return this.rowsById().get(id); }
  gradeText(r: SanteiRow) { return gradeChangeText(r); }

  async changeYear(value: number) {
    this.year = Number(value);
    this.selectedStep.set(null);
    this.failures.set(null);
    await this.router.navigate([], { queryParams: { year: this.year }, queryParamsHandling: 'merge' });
    await this.load();
  }

  chooseOffice(id: string) { void this.office.change(id); }
  selectStep(key: StepKey) { this.selectedStep.set(key); }

  stepView(key: StepKey) {
    const s = this.summaries().find(x => x.key === key)!;
    if (s.done) return 'done';
    if (s.empty) return 'empty';
    if (s.todo === 0 && s.waiting > 0) return 'waiting';
    return 'todo';
  }

  private call<T>(name: string, data: object, timeout = 70_000) {
    return httpsCallable<object, T>(this.functions, name, { timeout })({ companyId: this.auth.companyId, officeId: this.office.selected(), year: this.year, ...data });
  }

  /** 届出の提出の部品に渡す run のID（サーバーの santeiRunId と同じ形） */
  runId = () => `${this.office.selected()}_${this.year}`;

  async load() {
    if (!this.office.selected()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await this.call<Overview>('santeiRunOverview', {}, 120_000);
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
      const { data } = await this.call<{ failures: { employeeId: string; message: string }[] }>('santeiJobGet', { jobId: job.id });
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

  // ---- 一括操作 ----

  async run(req: BulkRun) {
    if (req.action === 'decidePrevious') return this.decide(req.ids, 'previous');
    await this.startJob(req.action as SanteiAction, req.ids);
  }

  retry(ids: string[]) {
    const f = this.failures();
    if (f?.action === 'decide') void this.decide(ids, 'previous');
    else if (f) void this.startJob(f.action, ids);
  }

  async decide(ids: string[], decision: 'previous' | null) {
    this.busy.set(true);
    try {
      await this.call('santeiDecision', { employeeIds: ids, decision });
      this.snackBar.open(decision ? `${ids.length}名を従前の標準報酬月額で決めます` : '決め方を取り消しました', '閉じる', { duration: 4000 });
      this.failures.set(null);
    } catch (e) {
      this.failures.set({ step: 'target', action: 'decide', byId: Object.fromEntries(ids.map(id => [id, message(e, '記録できませんでした')])) });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  private async startJob(action: SanteiAction, ids: string[]) {
    this.busy.set(true);
    try {
      const { data } = await this.call<{ jobId: string }>('santeiJobStart', { action, employeeIds: ids });
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
      const { data } = await this.call<{ job: JobSummary; failures: { employeeId: string; message: string }[] }>('santeiJobGet', { jobId });
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
      await this.call('santeiRunHold', { employeeId: id, reason });
      this.data.update(d => d && { ...d, rows: d.rows.map(r => r.employeeId === id ? { ...r, hold: reason ? { reason } : null } : r) });
      const name = this.row(id)?.employeeName ?? '';
      this.snackBar.open(reason ? `${name}さんを保留にしました。まとめて行う操作と届出の対象から外れます` : `${name}さんの保留を解除しました`, '閉じる', { duration: 4000 });
    } catch (e) {
      this.snackBar.open(message(e, '保留を変更できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // ---- 届出 ----

  async createFiling() {
    this.busy.set(true);
    try {
      const { data } = await this.call<{ filingIds: string[]; persons: number }>('santeiFilingCreate', {}, 300_000);
      this.snackBar.open(`${data.persons}名の算定基礎届を作りました。内容を確かめて承認を依頼してください`, '閉じる', { duration: 6000 });
      this.selectedStep.set('submit');
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
    }
    this.busy.set(true);
    try {
      const { data } = await this.call<{ success: boolean; mockErrors?: string[] }>('santeiFilingUpdate', { filingId: f.id, expectedVersion: f.version, action, ...extra });
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

  async openFiling(f: FilingSummary) {
    try {
      this.busy.set(true);
      const { data } = await this.call<FilingDetail>('santeiFilingGet', { filingId: f.id });
      this.dialog.open(SanteiFilingDialogComponent, { data: { filing: data, year: this.year }, width: '1000px', maxWidth: '96vw' });
    } catch (e) {
      this.snackBar.open(message(e, '届出を読み込めませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async open(id: string) {
    const r = this.row(id);
    const d = this.data();
    if (!r || !d) return;
    const changed = await firstValueFrom(this.dialog.open(SanteiDetailDialogComponent, {
      data: { row: r, year: d.year, officeId: d.office.id }, width: '680px', maxWidth: '95vw',
    }).afterClosed());
    if (changed === 'previous' || changed === 'undo') await this.decide([id], changed === 'previous' ? 'previous' : null);
  }
}

export function message(e: unknown, fallback: string) {
  return e instanceof Error && e.message && e.message !== 'INTERNAL' ? e.message : fallback;
}
