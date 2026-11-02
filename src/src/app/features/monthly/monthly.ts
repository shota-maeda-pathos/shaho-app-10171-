import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
import { ACTION_STEP, ImportResult, JobSummary, MonthlyAction, MonthlyRow, Overview, SalaryItem, StepKey, stepState } from './monthly.types';
import { MonthlyPersonComponent, NoPayDialogComponent } from './monthly-dialogs';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
/** ステップ。what は本体の見出しの横に出す1行。注意は操作バーの主ボタンの横に出す（BulkAction の caution） */
interface StepDef { key: StepKey; label: string; what: string }

const STEPS: StepDef[] = [
  { key: 'salary', label: '給与の取込', what: '今月支給する給与をCSVで取り込みます。給与がない人は「無給」として記録します。' },
  { key: 'salaryReview', label: '給与の確認', what: '取り込んだ給与を、別の担当者に確認してもらいます。' },
  { key: 'calculate', label: '保険料の計算', what: '対象の全員の保険料を計算します。画面を閉じても計算は続きます。' },
  { key: 'premiumReview', label: '結果の確認', what: '前月との差と理由、注意が出ている人を確かめて、別の担当者に確認してもらいます。' },
  { key: 'publish', label: '明細の公開', what: '承認済みの給与と保険料を、本人がポータルで見られるようにします。' },
  { key: 'collection', label: '徴収の記録', what: '給与から控除した人はまとめて、別途入金の人は入金があったら1人ずつ記録します。' },
];

const ACTIONS: Record<StepKey, (c: MonthlyComponent) => BulkAction[]> = {
  salary: () => [{ key: 'noPay', label: '選んだ人を無給として記録する', selectedOnly: true, appliesTo: r => !r.held && r.statusLabel === '給与 未登録',
    caution: '無給でも、休業の免除がなければ保険料はかかります（本人負担は別途入金）。' }],
  salaryReview: c => [
    { key: 'requestSalaryApproval', label: '確認を依頼する', appliesTo: r => c.row(r.id)?.salary?.confirmed === false && !c.row(r.id)?.salary?.pending,
      caution: '依頼中は給与を直せません。直すときは差し戻してもらいます。',
      confirm: { title: `${c.monthLabel(c.payMonth)}支給の給与の確認を依頼する`, message: '別の担当者（管理者・承認者）に、取り込んだ給与の確認を依頼します。承認者には通知が届きます。', notice: '依頼中は給与を直せません。' } },
    ...(c.canApproveReview('salary') ? [{ key: 'approveSalary', label: '承認する', appliesTo: (r: TargetRow) => !!c.row(r.id)?.salary?.pending,
      caution: '承認した給与は、差し戻さないと直せません。',
      confirm: { title: `${c.monthLabel(c.payMonth)}支給の給与を承認する`, message: '一覧で内容を確かめた人の給与を承認します。', notice: '承認した給与は、差し戻さないと直せません。' } }] : []),
  ],
  calculate: c => [{ key: 'calculate', label: '保険料を計算する', appliesTo: r => { const x = c.row(r.id); return !!x && x.premiumDue && !x.issues.length && !x.premium?.confirmed && !x.premium?.pending; },
    caution: '保険料は等級から決まります。給与がない人も、休業の免除がなければかかります。' },
    // 承認済みの保険料の訂正（カタログ6章）：選んだ人だけ未確定に戻し、計算し直して承認を取り直す
    { key: 'correctPremium', label: '選んだ人の保険料を訂正する', selectedOnly: true, appliesTo: r => !!c.row(r.id)?.premium?.confirmed,
      caution: '承認済みの保険料を未確定に戻します。前の内容は訂正の履歴と監査ログに残ります。このあと計算し直し、確認を依頼して承認を取り直します。',
      confirm: { title: `${c.monthLabel(c.data()?.premiumMonth ?? c.payMonth)}分の保険料を訂正する`, message: '選んだ人の承認済みの保険料を未確定に戻します。計算し直したあと、別の担当者の承認で確定し直します。', notice: '明細を公開済みの人は、承認し直すまで本人のポータルで保険料が「未確定」になります。', confirmLabel: '訂正する' } }],
  premiumReview: c => [
    { key: 'requestPremiumApproval', label: '確認を依頼する', appliesTo: r => c.row(r.id)?.premium?.confirmed === false && !c.row(r.id)?.premium?.pending,
      caution: '依頼中は計算し直せません。承認されると明細の公開と徴収の記録ができます。',
      confirm: { title: `${c.monthLabel(c.data()?.premiumMonth ?? c.payMonth)}分の保険料の確認を依頼する`, message: '計算した保険料の確認を、別の担当者（管理者・承認者）に依頼します。', notice: '依頼中は計算し直せません。' } },
    ...(c.canApproveReview('premium') ? [{ key: 'approvePremium', label: '承認する', appliesTo: (r: TargetRow) => !!c.row(r.id)?.premium?.pending,
      caution: '承認した保険料は、差し戻さないと直せません。',
      confirm: { title: `${c.monthLabel(c.data()?.premiumMonth ?? c.payMonth)}分の保険料を承認する`, message: '一覧で前月との差と理由を確かめた人の保険料を承認します。', notice: '承認した保険料は、差し戻さないと直せません。' } }] : []),
  ],
  publish: c => [{ key: 'publish', label: '明細を公開する', appliesTo: r => r.statusLabel === '公開前',
    caution: '公開した明細は、本人がポータルで見られるようになります。',
    confirm: { title: `${c.monthLabel(c.payMonth)}支給の明細を公開する`, message: '承認済みの給与と保険料の明細を、本人がポータルで見られるようにします。', notice: '公開した明細は本人にすぐ見えます。', confirmLabel: '公開する' } }],
  collection: c => [{ key: 'recordPayroll', label: '給与からの控除を記録する', appliesTo: r => { const x = c.row(r.id); return !!x?.premium?.confirmed && x.collection.plan === 'payroll' && x.collection.status === 'unpaid'; } }],
};

/**
 * 毎月の処理（一括型の見本）。事業所と給与の支給月ごとに、6つのステップを順に進める。
 * 各ステップでは要対応の人だけを先に表示し、全員にまとめて操作する。処理はサーバーのバックグラウンドで行い、進み具合を表示する。
 */
@Component({
  selector: 'app-monthly',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule,
    DecimalPipe, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    TargetListComponent, TargetCellDirective, TargetDetailDirective, ErrorStateComponent, LoadingStateComponent, TermComponent,
    PageHeadComponent, StepperComponent, StepLeadComponent, MonthlyPersonComponent,
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
    const fails = this.failures()?.step === step.key ? this.failures()!.byId : {};
    const rows = (this.data()?.rows ?? []).filter(r => !r.hold).flatMap(r => {
      const s = this.stateFor(step.key, r);
      return s ? [fails[r.employeeId] ? { ...s, tone: 'error' as StatusTone } : s] : [];
    });
    const todo = rows.filter(s => needsMe(s.tone)).length;
    const attention = rows.filter(s => s.tone === 'attention' || s.tone === 'error').length;
    const waiting = rows.filter(s => s.tone === 'waiting').length;
    return { key: step.key, total: rows.length, todo, attention, waiting, done: rows.length > 0 && todo === 0 && waiting === 0, empty: rows.length === 0 };
  }));
  /** 横並びのステップ。数字は1つだけ（要確認 → 残り → 承認待ち → 完了 → —） */
  stepItems = computed<StepperItem[]>(() => this.summaries().map((s, i, all) => {
    // 手前のステップが終わっていないうちは、後ろのステップの「承認待ち」は前の承認を待っているだけなので出さない
    const before = all.slice(0, i).some(p => !p.done && !p.empty);
    const waiting = before ? 0 : s.waiting;
    return {
      key: s.key, label: STEPS[i].label,
      state: s.attention ? 'attention' : s.done ? 'done' : !s.todo && waiting ? 'waiting' : 'todo',
      note: s.attention ? `要確認 ${s.attention}名` : s.todo ? `残り ${s.todo}名` : waiting ? `承認待ち ${waiting}名` : s.done ? '完了' : '—',
    };
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

  // ---- 一括操作 ----

  async run(req: BulkRun) {
    if (req.action === 'noPay') return this.noPay(req.ids);
    // 公開などの確認は、一括操作の confirm で済んでいる
    await this.startJob(req.action as MonthlyAction, req.ids);
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

  /** 操作バーの文言（一括操作のないときなど） */
  barInfo = computed(() => this.current() === 'salary' ? '給与がない月の人（無給の休職など）は、選んでから記録します。' : '');

}

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export function message(e: unknown, fallback: string) {
  return e instanceof Error && e.message && e.message !== 'INTERNAL' ? e.message : fallback;
}
