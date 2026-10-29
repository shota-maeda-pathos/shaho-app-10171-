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
  BulkAction, BulkRun, ErrorStateComponent, LoadingStateComponent, StatusTone, TargetCellDirective,
  TargetListComponent, TargetRow, TermComponent,
} from '../../shared/ui';
import { ACTION_STEP, ImportResult, JobSummary, MonthlyAction, MonthlyRow, Overview, SalaryItem, StepKey, stepState } from './monthly.types';
import { MonthlyDetailDialogComponent, NoPayDialogComponent } from './monthly-dialogs';

interface StepDef { key: StepKey; label: string; what: string; why: string; next: string }

const STEPS: StepDef[] = [
  { key: 'salary', label: '給与を取り込む', what: '今月支給する給与をCSVで取り込みます。無給の休職者など給与がない人は「無給として記録」します。', why: '給与から保険料を控除するため、また給与と等級が大きく離れた人（随時改定の候補）を見つけるためです。', next: '取り込んだ給与を、別の担当者に確認してもらいます。' },
  { key: 'salaryReview', label: '給与の確認', what: '取り込んだ給与の確認を、別の担当者に依頼します。承認者はこの画面で内容を見て、まとめて承認します。', why: '入力の誤りを、作った人とは別の目で確かめるためです。', next: '承認された給与は変更できなくなり、明細に使えます。' },
  { key: 'calculate', label: '保険料を計算', what: '対象の全員の保険料を計算します。人数が多くても画面を閉じて待てます。', why: '保険料は等級（標準報酬月額）から決まります。給与がない人も、休業の免除がなければ保険料がかかります。', next: '計算結果を前月と比べて確かめます。' },
  { key: 'premiumReview', label: '結果の確認', what: '前月との差額と理由、注意が出ている人を確かめてから、別の担当者に確認を依頼します。', why: '等級の変更や40歳到達など、金額が変わった理由が正しいかを確かめるためです。', next: '承認されると、明細の公開と徴収の記録ができるようになります。' },
  { key: 'publish', label: '明細を公開', what: '承認済みの給与と保険料を、本人が見られるようにします。', why: '本人が控除額と内訳を確かめられるようにするためです。', next: '公開した明細は従業員のポータルに表示されます。' },
  { key: 'collection', label: '徴収を記録', what: '給与から控除した人はまとめて記録します。別途入金の人は、入金があったら1人ずつ記録します。', why: '会社は本人負担分も含めて納めるため、本人から集め終わったかを確かめるためです。', next: 'すべて徴収済みになれば、この月の処理は完了です。' },
];

const ACTIONS: Record<StepKey, (c: MonthlyComponent) => BulkAction[]> = {
  salary: () => [{ key: 'noPay', label: '無給として記録', appliesTo: r => !r.held && r.statusLabel === '給与 未登録' }],
  salaryReview: c => [
    { key: 'requestSalaryApproval', label: '確認を依頼', appliesTo: r => c.row(r.id)?.salary?.confirmed === false && !c.row(r.id)?.salary?.pending },
    ...(c.canApproveReview('salary') ? [{ key: 'approveSalary', label: '承認する', appliesTo: (r: TargetRow) => !!c.row(r.id)?.salary?.pending }] : []),
  ],
  calculate: c => [{ key: 'calculate', label: '計算する', appliesTo: r => { const x = c.row(r.id); return !!x && x.premiumDue && !x.issues.length && !x.premium?.confirmed && !x.premium?.pending; } }],
  premiumReview: c => [
    { key: 'requestPremiumApproval', label: '確認を依頼', appliesTo: r => c.row(r.id)?.premium?.confirmed === false && !c.row(r.id)?.premium?.pending },
    ...(c.canApproveReview('premium') ? [{ key: 'approvePremium', label: '承認する', appliesTo: (r: TargetRow) => !!c.row(r.id)?.premium?.pending }] : []),
  ],
  publish: () => [{ key: 'publish', label: '明細を公開', appliesTo: r => r.statusLabel === '公開前' }],
  collection: c => [{ key: 'recordPayroll', label: '給与からの控除を記録', appliesTo: r => { const x = c.row(r.id); return !!x?.premium?.confirmed && x.collection.plan === 'payroll' && x.collection.status === 'unpaid'; } }],
};

/**
 * 毎月の処理（一括型の見本）。事業所と給与の支給月ごとに、6つのステップを順に進める。
 * 各ステップでは要対応の人だけを先に表示し、全員にまとめて操作する。処理はサーバーのバックグラウンドで行い、進み具合を表示する。
 */
@Component({
  selector: 'app-monthly',
  standalone: true,
  imports: [
    DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule,
    TargetListComponent, TargetCellDirective, ErrorStateComponent, LoadingStateComponent, TermComponent,
  ],
  templateUrl: './monthly.html',
  styleUrl: './monthly.scss',
})
export class MonthlyComponent implements OnInit {
  office = inject(OfficeContextService);
  private auth = inject(AuthService);
  private functions = inject(Functions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  readonly steps = STEPS;
  payMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  data = signal<Overview | null>(null);
  loading = signal(false);
  error = signal('');
  busy = signal(false);
  job = signal<JobSummary | null>(null);
  /** 直前の一括処理で失敗した人（ステップごと） */
  failures = signal<{ step: StepKey; action: MonthlyAction | 'noPay'; byId: Record<string, string> } | null>(null);
  selectedStep = signal<StepKey | null>(null);
  importResult = signal<ImportResult | null>(null);
  private csvText = '';
  csvName = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  canApprove = computed(() => this.data()?.me.canApprove ?? false);
  /** 自分が依頼した確認は自分では承認できないため、承認のボタンを出さない */
  canApproveReview(kind: 'salary' | 'premium') {
    return this.canApprove() && !this.data()?.reviews[kind]?.mine;
  }
  rowsById = computed(() => new Map((this.data()?.rows ?? []).map(r => [r.employeeId, r])));

  /** ステップごとの人数と状態 */
  summaries = computed(() => STEPS.map(step => {
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold).map(r => this.stateFor(step.key, r)).filter(s => s !== null);
    const todo = rows.filter(s => s!.tone === 'action' || s!.tone === 'yours').length;
    const waiting = rows.filter(s => s!.tone === 'waiting').length;
    return { key: step.key, total: rows.length, todo, waiting, done: rows.length > 0 && todo === 0 && waiting === 0, empty: rows.length === 0 };
  }));
  /**
   * 開くステップ。承認者に承認を頼まれていればその確認のステップ、なければ自分がやることのある最初のステップ、
   * それもなければ（他の人の承認待ちだけなら）最初の未完了ステップ。全部終わっていれば最後
   */
  firstOpen = computed(() => {
    const sums = this.summaries();
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold);
    const pendingIn = (k: 'salaryReview' | 'premiumReview') => rows.some(r => k === 'salaryReview' ? r.salary?.pending : r.premium?.pending);
    const review = (['salaryReview', 'premiumReview'] as const).find(k => this.approvesStep(k) && pendingIn(k));
    return review ?? sums.find(s => s.todo > 0)?.key ?? sums.find(s => !s.done && !s.empty)?.key ?? 'collection';
  });
  current = computed(() => this.selectedStep() ?? this.firstOpen());
  currentDef = computed(() => STEPS.find(s => s.key === this.current())!);
  currentSummary = computed(() => this.summaries().find(s => s.key === this.current())!);
  actions = computed(() => ACTIONS[this.current()](this));
  cellHeader = computed(() => ({
    salary: '給与', salaryReview: '給与', calculate: '本人負担', premiumReview: '本人 / 会社（前月比）', publish: '内容', collection: '徴収済み / 集める額',
  })[this.current()]);

  targetRows = computed<TargetRow[]>(() => {
    const step = this.current();
    const fails = this.failures()?.step === step ? this.failures()!.byId : {};
    return (this.data()?.rows ?? []).flatMap(r => {
      const state = this.stateFor(step, r);
      if (!state) return [];
      return [{
        id: r.employeeId, name: r.name, sub: r.employeeNumber, tone: state.tone as StatusTone, statusLabel: state.label, reason: state.reason,
        held: r.hold ?? undefined, error: fails[r.employeeId],
      }];
    });
  });

  /** 承認を頼まれている確認のステップか（自分が依頼したものは除く） */
  approvesStep(step: StepKey) {
    return (step === 'salaryReview' && this.canApproveReview('salary')) || (step === 'premiumReview' && this.canApproveReview('premium'));
  }

  /** 1人分の状態。承認者には、承認待ちの人を「あなたの番」として見せる */
  stateFor(step: StepKey, r: MonthlyRow) {
    const state = stepState(step, r);
    if (state?.tone === 'waiting' && state.label === '承認待ち' && this.approvesStep(step)) return { ...state, tone: 'yours' as StatusTone, label: 'あなたの承認待ち' };
    return state;
  }

  /** 承認待ちの確認を、自分が依頼したかどうか */
  reviewNote = computed(() => {
    const d = this.data();
    const step = this.current();
    if (!d || (step !== 'salaryReview' && step !== 'premiumReview')) return null;
    const review = step === 'salaryReview' ? d.reviews.salary : d.reviews.premium;
    const waiting = d.rows.filter(r => !r.hold && (step === 'salaryReview' ? r.salary?.pending : r.premium?.pending)).length;
    if (!waiting) return null;
    if (review?.mine || !this.canApprove()) return { mine: true, text: `${waiting}名が承認待ちです。別の担当者（管理者・承認者）の承認を待っています。承認者には通知が届いています。` };
    return { mine: false, text: `${waiting}名の確認を頼まれています。一覧で内容を確かめ、問題がなければ「承認する」を押してください。直したい人は、名前を押して承認の画面から差し戻せます。` };
  });

  constructor() {
    // 事業所を選んだ・切り替えたら読み込み直す
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
    const month = this.route.snapshot.queryParamMap.get('payMonth');
    if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) this.payMonth = month;
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  row(id: string) { return this.rowsById().get(id); }

  monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; }

  async changeMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    this.payMonth = value;
    this.selectedStep.set(null);
    this.failures.set(null);
    this.importResult.set(null);
    await this.router.navigate([], { queryParams: { payMonth: value }, queryParamsHandling: 'merge' });
    await this.load();
  }

  async load() {
    if (!this.office.selected()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, Overview>(this.functions, 'monthlyRunOverview', { timeout: 120_000 })({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth,
      });
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

  chooseOffice(id: string) {
    void this.office.change(id);
  }

  /** 画面を開き直しても、直前の一括処理で失敗した人を一覧に出し、その人だけ再実行できるようにする */
  private async restoreFailures(job: JobSummary) {
    try {
      const { data } = await httpsCallable<object, { failures: { employeeId: string; message: string }[] }>(this.functions, 'monthlyJobGet')({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, jobId: job.id,
      });
      // まだ直っていない人（今の状態でも、その操作の対象に残っている人）だけを出す
      const step = ACTION_STEP[job.action];
      const open = new Set((this.data()?.rows ?? []).filter(r => { const st = stepState(step, r); return !!st && st.tone !== 'done'; }).map(r => r.employeeId));
      const byId = Object.fromEntries(data.failures.filter(f => open.has(f.employeeId)).map(f => [f.employeeId, f.message]));
      if (Object.keys(byId).length) {
        this.failures.set({ step, action: job.action, byId });
        if (!this.selectedStep()) this.selectedStep.set(step);
      }
    } catch {
      // 失敗の一覧が取れなくても、画面の表示は続ける
    }
  }

  selectStep(key: StepKey) {
    this.selectedStep.set(key);
  }

  stepView(key: StepKey) {
    const s = this.summaries().find(x => x.key === key)!;
    if (s.done) return 'done';
    if (s.empty) return 'empty';
    if (s.todo === 0 && s.waiting > 0) return 'waiting';
    return 'todo';
  }

  // ---- 一括操作 ----

  async run(req: BulkRun) {
    if (req.action === 'noPay') return this.noPay(req.ids);
    const action = req.action as MonthlyAction;
    if (action === 'publish' && !window.confirm(`${req.ids.length}名の明細を本人に公開します。公開した明細は本人がポータルで見られます。よろしいですか？`)) return;
    await this.startJob(action, req.ids);
  }

  retry(ids: string[]) {
    const f = this.failures();
    if (f?.action === 'noPay') void this.noPay(ids);
    else if (f) void this.startJob(f.action, ids);
  }

  private async startJob(action: MonthlyAction, ids: string[]) {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { jobId: string }>(this.functions, 'monthlyJobStart')({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, action, employeeIds: ids,
      });
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
      const { data } = await httpsCallable<object, { job: JobSummary; failures: { employeeId: string; message: string }[] }>(this.functions, 'monthlyJobGet')({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, jobId,
      });
      this.job.set(data.job);
      if (data.job.status === 'running') return;
      this.stopPolling();
      const byId = Object.fromEntries(data.failures.map(f => [f.employeeId, f.message]));
      this.failures.set({ step: ACTION_STEP[data.job.action], action: data.job.action, byId });
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
      await httpsCallable(this.functions, 'monthlyRunHold')({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, employeeId: id, reason,
      });
      // 全員分の読み込み直しには数秒かかるため、先にその人の行だけ変えて知らせる
      this.data.update(d => d && { ...d, rows: d.rows.map(r => r.employeeId === id ? { ...r, hold: reason ? { reason } : null } : r) });
      const name = this.row(id)?.name ?? '';
      this.snackBar.open(reason ? `${name}さんを保留にしました。まとめて行う操作の対象から外れます` : `${name}さんの保留を解除しました`, '閉じる', { duration: 4000 });
    } catch (e) {
      this.snackBar.open(message(e, '保留を変更できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  // ---- 給与 ----

  async noPay(ids: string[]) {
    const reason = await firstValueFrom(this.dialog.open(NoPayDialogComponent, { data: { count: ids.length }, width: '460px' }).afterClosed());
    if (typeof reason !== 'string' || !reason.trim()) return;
    this.busy.set(true);
    const byId: Record<string, string> = {};
    for (const id of ids) {
      try {
        await httpsCallable(this.functions, 'monthlySalaryNoPay')({
          companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, employeeId: id, reason: reason.trim(),
        });
      } catch (e) {
        byId[id] = message(e, '記録できませんでした');
      }
    }
    this.failures.set({ step: 'salary', action: 'noPay', byId });
    this.busy.set(false);
    await this.load();
  }

  /** 給与項目マスタ（CSVの列名と区分）。編集中の内容 */
  itemsEditing = signal<SalaryItem[] | null>(null);
  salaryItems = computed(() => this.data()?.salaryItems?.items ?? [{ name: '通勤手当', kind: 'fixed' as const }, { name: '残業手当', kind: 'variable' as const }]);

  editItems() { this.itemsEditing.set(this.salaryItems().map(i => ({ ...i }))); }
  addItem() { this.itemsEditing.update(list => [...(list ?? []), { name: '', kind: 'fixed' }]); }
  removeItem(index: number) { this.itemsEditing.update(list => (list ?? []).filter((_, i) => i !== index)); }

  async saveItems() {
    const items = (this.itemsEditing() ?? []).map(i => ({ name: i.name.trim(), kind: i.kind })).filter(i => i.name);
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'monthlySalaryItemsUpdate')({
        companyId: this.auth.companyId, items, expectedVersion: this.data()?.salaryItems?.version ?? 0,
      });
      this.itemsEditing.set(null);
      this.snackBar.open('給与項目を保存しました。取込用のCSVの列にも入ります', '閉じる', { duration: 4000 });
      await this.load();
    } catch (e) {
      this.snackBar.open(message(e, '給与項目を保存できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  downloadTemplate() {
    const rows = (this.data()?.rows ?? []).filter(r => r.salaryRequired);
    const items = this.salaryItems().map(i => i.name);
    const header = ['社員番号', '氏名', '支払基礎日数', '基本給', ...items, '現物給与', '遡及差額', '遡及開始月', '遡及終了月', '無給'].map(csvCell).join(',');
    const lines = rows.map(r => [r.employeeNumber, r.name, '', '', ...items.map(() => ''), '', '', '', '', ''].map(csvCell).join(','));
    const blob = new Blob(['﻿' + [header, ...lines].join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `給与_${this.payMonth}_${this.data()?.office.name ?? ''}.csv`;
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

  async importCsv(dryRun: boolean) {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, ImportResult>(this.functions, 'monthlySalaryImport', { timeout: 300_000 })({
        companyId: this.auth.companyId, officeId: this.office.selected(), payMonth: this.payMonth, csv: this.csvText, dryRun,
      });
      this.importResult.set(data);
      if (!dryRun) {
        this.snackBar.open(`${data.imported}名の給与を取り込みました`, '閉じる', { duration: 5000 });
        this.csvText = '';
        this.csvName.set('');
        this.selectedStep.set(null);
        await this.load();
      }
    } catch (e) {
      this.snackBar.open(message(e, '取り込めませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  cancelImport() {
    this.importResult.set(null);
    this.csvText = '';
    this.csvName.set('');
  }

  // ---- 詳細 ----

  async open(id: string) {
    const r = this.row(id);
    const d = this.data();
    if (!r || !d) return;
    const changed = await firstValueFrom(this.dialog.open(MonthlyDetailDialogComponent, {
      data: { row: r, payMonth: d.payMonth, premiumMonth: d.premiumMonth, officeId: d.office.id, step: this.current() }, width: '640px', maxWidth: '95vw',
    }).afterClosed());
    if (changed) await this.load();
  }
}

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export function message(e: unknown, fallback: string) {
  return e instanceof Error && e.message && e.message !== 'INTERNAL' ? e.message : fallback;
}
