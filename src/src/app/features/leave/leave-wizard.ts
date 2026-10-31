import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import {
  ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, TermComponent, WizardComponent, WizardStep, createDraftAutosave,
} from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';
import { EVENT_LABEL, EventResult, LeaveEventType, LeaveKey, LeaveView, monthLabel, monthsText, PlanForm, PlanResult } from './leave.types';

const KEYS: LeaveKey[] = ['plan', 'filing', 'approval', 'submit', 'during', 'confirm'];

/**
 * 産休・育休の手続きのウィザード（個人型）。期間を決めて申出書を出し、承認で保険料の免除を効かせる。
 * 休業中の出産・延長・復帰も同じ手続きで記録し、変更届・終了届が要るときは届出のステップをもう一度通る
 */
@Component({
  selector: 'app-leave-wizard',
  standalone: true,
  imports: [
    FilingSubmissionComponent, DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule,
    WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './leave-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss', './leave-wizard.scss'],
})
export class LeaveWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly monthLabel = monthLabel;
  readonly monthsText = monthsText;
  readonly eventLabel = EVENT_LABEL;
  procedureId = '';
  view = signal<LeaveView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  form: PlanForm = emptyForm();
  dirty = signal(false);
  plan = signal<PlanResult | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  eventType: LeaveEventType = 'end';
  eventDate = '';
  eventResult = signal<EventResult | null>(null);

  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  isMaternity = computed(() => this.view()?.procedure.kind === 'maternity');
  short = computed(() => this.isMaternity() ? '産休' : '育休');

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const filing = v.filingLabel;
    const maternity = this.isMaternity();
    const deadline = this.plan()?.deadline ?? v.deadline;
    return [
      { key: 'plan', label: '休業の期間', done: done || cur > 0,
        what: maternity
          ? '出産予定日を入れます。産前（42日、双子以上は98日）と産後（56日）の期間はシステムが数えます。'
          : '養育する子と、育休を始める日・終える予定の日を入れます。',
        why: '休業の期間から、保険料が免除される月が決まるためです。',
        next: `${filing}を作ります。` },
      { key: 'filing', caution: '承認を依頼すると、差し戻されるまで内容を直せません。', label: '届出の作成', done: done || cur > 1,
        what: '入れた期間から届出を作り、承認者に確認を依頼します。',
        why: maternity
          ? `産休の届出は、産休中か産休を終えてから1か月以内${deadline ? `（${this.monthDay(deadline)}まで）` : ''}に出す決まりがあるためです。`
          : '育休の届出は、速やかに出す決まりがあるためです。',
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: '承認', done: done || cur > 2,
        what: '作った人とは別の担当者が、届出を確認します。',
        why: v.filingKind === 'start' ? '承認されると、保険料の免除が毎月の計算に反映されるためです。' : '1人で作った届出の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(v.current === 'approval' && v.approval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: '提出', done: done || cur > 3,
        what: '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '期限内に提出したことを記録に残すためです。',
        next: `${this.short()}が終わるまで、休業中のことを記録します。` },
      { key: 'during', label: '休業中と復帰', done: done || cur > 4,
        what: maternity
          ? '出産したら出産日を、産休を終えたら終えた日を記録します。届出が要るかはシステムが判定します。'
          : '育休を延長するときと、育休を終えて復帰したときに記録します。届出が要るかはシステムが判定します。',
        why: '出産日が予定と違ったときや、予定より早く復帰したときは、変更届・終了届が要るためです。',
        next: '休業を終えたら、手続きを完了にします。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '出した届出と免除された月を見直して、手続きを完了にします。',
        why: '復帰後に給与が下がった場合の終了時改定など、次にやることを確かめるためです。',
        next: maternity ? '続けて育休に入る場合は、育休の手続きを始めます。' : 'これで育休の手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'plan' && this.dirty()) return '期間を保存して届出へ';
    if (k === 'during' && this.canRecord()) return '休業中のことを記録する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'plan': return '期間を保存して届出へ';
      case 'filing': return '届出を作って承認を依頼する';
      case 'confirm': return '手続きを完了する';
      default: return undefined;
    }
  }

  hideNext() {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (k === 'during' && this.canRecord()) return false;
    if (this.index() < this.currentIndex()) return false;
    return k === 'submit' || k === 'approval' || k === 'during';
  }

  nextDisabled() {
    const k = this.key();
    if (k === 'during' && this.canRecord()) return !this.eventDate || !!this.eventResult()?.errors.length;
    if (this.index() < this.currentIndex() && !(k === 'plan' && this.dirty())) return false;
    if (k === 'plan') return !!this.planMissing() || !!this.plan()?.errors.length;
    return false;
  }

  /** 期間を保存できない理由（足りない項目） */
  planMissing(): string {
    const f = this.form;
    if (this.isMaternity()) return f.expectedBirthDate ? '' : '出産予定日を入れてください';
    if (!f.childLastName.trim() || !f.childFirstName.trim()) return '養育する子の氏名を入れてください';
    if (!f.childBirthDate) return '子の生年月日を入れてください';
    if (!f.startDate) return '育休を始める日を入れてください';
    return '';
  }

  /** 休業中のことを記録できるか（申出書の提出後。まだ出していない変更届があれば、その記録をやり直せる） */
  canRecord() {
    const v = this.view();
    if (!v || this.isDone() || this.key() !== 'during') return false;
    return v.current === 'during' || (!!v.pending && !v.locked);
  }

  eventChoices(): LeaveEventType[] {
    const v = this.view();
    if (!v) return [];
    if (this.isMaternity()) return v.period?.actualBirthDate && v.pending?.type !== 'birth' ? ['end'] : ['birth', 'end'];
    return ['extend', 'end'];
  }

  monthDay(date: string) {
    const [, m, d] = date.split('-').map(Number);
    return `${m}月${d}日`;
  }

  /** 入力の自動下書き保存（「休業の期間」のステップ。入力を変えてから確定するまで。閉じても次に開くと戻る） */
  autosave = createDraftAutosave({
    procedureId: () => this.procedureId,
    baseline: false,
    step: () => 'plan',
    read: () => this.key() === 'plan' && this.dirty() && !this.busy() ? { form: this.form } : null,
  });

  /** 前回の下書きを戻す（「休業の期間」がまだ確定していないときだけ） */
  private async restoreDraft() {
    const d = (await this.autosave.load())['plan'];
    if (!d || this.view()?.current !== 'plan') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = d.data as any;
    this.form = { ...this.form, ...x.form };
    this.dirty.set(true);
    this.autosave.restored('plan', { form: this.form }, d.savedAt);
    void this.changed();
  }

  async ngOnInit() {
    this.procedureId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load(true);
    await this.restoreDraft();
  }

  ngOnDestroy() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, LeaveView>(this.functions, 'leaveProcedureGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      if (!this.dirty()) {
        this.form = formOf(data);
        this.plan.set(data.plan);
        // 産休から引き継いだ直後など、保存前の内容は判定し直す
        if (!data.plan && (this.form.expectedBirthDate || this.form.startDate)) void this.preview();
      }
      // 出産前の産休は出産日の記録から、それ以外は今ある選択肢の最初から
      const choices = this.eventChoices();
      if (!choices.includes(this.eventType) || (choices[0] === 'birth' && !data.period?.actualBirthDate)) this.eventType = choices[0];
      // まだ出していない届出の記録を直すときは、その記録から
      if (data.pending && choices.includes(data.pending.type)) this.eventType = data.pending.type;
      if (data.filing && data.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '産休・育休の手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── 期間 ──

  changed() {
    this.dirty.set(true);
    this.schedulePreview();
  }

  private schedulePreview() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.preview(), 400);
  }

  private async preview() {
    try {
      const { data } = await httpsCallable<object, { plan: PlanResult | null; event: EventResult | null }>(this.functions, 'leaveProcedurePreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, ...this.form,
        event: this.key() === 'during' && this.eventDate ? { type: this.eventType, date: this.eventDate } : null,
      });
      if (data.event) this.eventResult.set(data.event);
      else this.plan.set(data.plan);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '判定できませんでした'), '閉じる', { duration: 6000 });
    }
  }

  // ── 休業中のこと ──

  eventChanged() {
    this.eventResult.set(null);
    if (this.eventDate) this.schedulePreview();
  }

  // ── 共通の進め方 ──

  async advance() {
    const k = this.key();
    if (k === 'during' && this.canRecord()) {
      return this.run('event', { type: this.eventType, date: this.eventDate }, '記録しました', () => {
        this.eventDate = '';
        this.eventResult.set(null);
      });
    }
    if (this.index() < this.currentIndex() && !(k === 'plan' && this.dirty())) {
      this.index.set(this.index() + 1);
      return;
    }
    switch (k) {
      case 'plan': return this.run('plan', this.form, '休業の期間を保存しました', () => this.dirty.set(false));
      case 'filing': return this.run('filing', {}, `${this.view()!.filingLabel}を作り、承認を依頼しました`);
      case 'confirm': return this.run('complete', {}, `${this.short()}の手続きを完了にしました`);
    }
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { notes?: string[] }>(this.functions, 'leaveProcedureUpdate')({
        companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload,
      });
      after?.();
      if (step === 'plan') void this.autosave.clear('plan');
      this.snackBar.open(data?.notes?.length ? `${done}。${data.notes.join('。')}` : done, '閉じる', { duration: 6000 });
      await this.load(true);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  // ── 提出 ──

  submitDone() {
    const f = this.view()?.filing;
    return !!f && (f.mockStatus === 'completed' || f.submissionStatus === 'accepted');
  }

  // ── 完了の後 ──

  /** 産休を終えたら、続けて育休の手続きを始める（子と期間を引き継ぐ） */
  async startChildcare() {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'leaveProcedureStart')({
        companyId: this.auth.companyId, employeeId: v.employee.id, kind: 'childcare', sourceProcedureId: v.procedure.id,
      });
      await this.router.navigate(['/leaves', data.procedureId]);
      this.procedureId = data.procedureId;
      this.view.set(null);
      this.dirty.set(false);
      await this.load(true);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '育休の手続きを始められませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  /** 終了時改定で見る3か月（復帰した月から） */
  revisionMonths() {
    const ym = this.view()?.returnMonth;
    if (!ym) return [];
    const [y, m] = ym.split('-').map(Number);
    return [0, 1, 2].map(i => {
      const t = y * 12 + (m - 1) + i;
      return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    });
  }
}

function emptyForm(): PlanForm {
  return {
    expectedBirthDate: '', actualBirthDate: '', multiple: false, childLastName: '', childFirstName: '', childBirthDate: '',
    bornByEmployee: false, startDate: '', endDate: '',
  };
}

function formOf(v: LeaveView): PlanForm {
  return {
    expectedBirthDate: v.expectedBirthDate ?? '', actualBirthDate: v.period?.actualBirthDate ?? '', multiple: v.multiple,
    childLastName: v.child?.lastName ?? '', childFirstName: v.child?.firstName ?? '', childBirthDate: v.child?.birthDate ?? '',
    bornByEmployee: v.child?.bornByEmployee ?? v.employee.gender === 'female',
    startDate: v.period?.startDate ?? '', endDate: v.period?.plannedEnd ?? '',
  };
}
