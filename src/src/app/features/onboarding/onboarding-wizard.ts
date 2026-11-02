import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { GroupNavComponent, groupBackLabel } from '../procedures/procedure-groups';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { MatDatepickerModule } from '@angular/material/datepicker';
import {
  ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, TermComponent, WizardComponent, WizardStep, createDraftAutosave,
} from '../../shared/ui';
import {
  ContractForm, EMPLOYMENT_TYPES, errorMessage, Evaluation, inviteUrl, OnboardingView, RELATIONSHIPS, SelfInput, STEP_LABELS, WizardKey,
} from './onboarding.types';

const KEYS: WizardKey[] = ['invite', 'register', 'contract', 'filing', 'approval', 'submit', 'confirm'];

const emptyProfile = (name: string): SelfInput => {
  const [lastName = '', ...rest] = name.split(/\s+/);
  return {
    lastName, firstName: rest.join(' '), lastNameKana: '', firstNameKana: '', birthDate: '', gender: 'male',
    postalCode: null, prefecture: null, city: null, addressLine: null, building: null, phone: null, email: null, dependents: [],
  };
};

const defaultContract = (): ContractForm => ({
  employmentType: 'regular', weeklyHours: 40, monthlyDays: 21, wageType: 'monthly', wageAmount: 0, monthlyHours: null,
  allowances: 0, inKind: 0, contractType: 'indefinite', contractEndDate: null, renewalExpected: false, isStudent: false,
});

/** 入社手続きのウィザード（個人型の見本）。1つの画面で招待から提出まで進める */
@Component({
  selector: 'app-onboarding-wizard',
  standalone: true,
  imports: [MatDatepickerModule,
    GroupNavComponent, FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatRadioModule, MatSelectModule, WizardComponent, TermComponent, StatusBadgeComponent,
    LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './onboarding-wizard.html',
  styleUrl: './onboarding-wizard.scss',
})
export class OnboardingWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);

  readonly employmentTypes = EMPLOYMENT_TYPES;
  readonly relationships = RELATIONSHIPS;
  procedureId = '';
  view = signal<OnboardingView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  // 台帳への登録
  employeeNumber = '';
  insuredPersonNumber = '';
  profile: SelfInput = emptyProfile('');

  // 雇用条件
  contract: ContractForm = defaultContract();
  contractDirty = signal(false);
  override = false;
  overrideHealth = true;
  overridePension = true;
  overrideReason = '';
  evaluation = signal<Evaluation | null>(null);
  evaluating = signal(false);
  evaluationError = signal('');
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  // 提出
  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  insuranceSkipped = computed(() => this.view()?.steps.find(s => s.id === 'filing_create')?.status === 'skipped');
  /** 承認待ち・承認済みなら雇用条件と届出は直せない */
  locked = computed(() => {
    const v = this.view();
    return !!v && (v.approval?.status === 'pending' || v.filing?.workflowStatus === 'approved');
  });
  inviteLink = computed(() => {
    const token = this.view()?.invite.token;
    return token ? inviteUrl(token) : '';
  });

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const waitingInvite = v.current === 'invite' && !!v.invite.token;
    const waitingApproval = v.current === 'approval' && v.approval?.status === 'pending';
    const skipped = this.insuranceSkipped();
    const skipText = '社会保険に加入しないため、このステップはありません。';
    const deadline = this.monthDay(v.procedure.deadline);
    return [
      { key: 'invite', label: STEP_LABELS.invite, done: done || cur > 0,
        what: '入力用のリンクを本人に渡し、住所・生年月日・家族などを入れてもらいます。',
        ...(waitingInvite ? { waitingFor: '入社する本人' } : {}) },
      { key: 'register', label: STEP_LABELS.register, done: done || cur > 1,
        what: '本人の入力を確かめ、社員番号を付けて従業員台帳に登録します。',
        caution: '氏名・フリガナ・生年月日は資格取得届にそのまま載ります。誤りは返戻の原因になります。' },
      { key: 'contract', label: STEP_LABELS.contract, done: done || cur > 2,
        what: '雇用区分・労働時間・給与を入れると、社会保険に入るかと最初の等級をシステムが判定します。' },
      { key: 'filing', label: STEP_LABELS.filing, done: done || cur > 3,
        what: skipped ? skipText : 'システムが決めた等級を確かめ、資格取得届を作って承認を依頼します。',
        caution: skipped ? undefined : `資格取得届の期限は ${deadline}（入社日から5日以内）。依頼中は雇用条件と届出を直せません。` },
      { key: 'approval', label: STEP_LABELS.approval, done: done || cur > 4,
        what: skipped ? skipText : '作った人とは別の担当者が、届出と等級を確認します。承認されると等級が確定します。',
        ...(waitingApproval ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: STEP_LABELS.submit, done: done || cur > 5,
        what: skipped ? skipText : '電子申請か紙のどちらかで提出し、結果を記録します。' },
      { key: 'confirm', label: STEP_LABELS.confirm, done,
        what: '登録した内容と届出の結果を見直して、手続きを完了にします。' },
    ];
  });

  nextLabel = computed(() => {
    const k = this.key();
    const v = this.view();
    if (!v || this.isDone()) return undefined;
    if (k === 'contract' && this.contractDirty()) return '雇用条件を保存する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'register': return '台帳に登録して雇用条件へ';
      case 'contract': return '雇用条件を保存して届出へ';
      case 'filing': return '資格取得届を作って承認を依頼する';
      case 'confirm': return '手続きを完了する';
      default: return undefined;
    }
  });

  hideNext = computed(() => {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (this.index() < this.currentIndex()) return false;
    // 本人の入力待ち・提出は、ステップの中のボタンで進める
    return k === 'invite' || k === 'submit' || k === 'approval';
  });

  /** フォームの値（シグナルでない）を読むため computed にしない */
  nextDisabled() {
    if (this.index() < this.currentIndex() && !(this.key() === 'contract' && this.contractDirty())) return false;
    switch (this.key()) {
      case 'register': return !this.view()?.employee && !this.registerReady();
      case 'contract': {
        const ev = this.evaluation();
        return !ev || this.evaluating() || (this.needsReason() && !this.overrideReason.trim());
      }
      default: return false;
    }
  }

  needsReason = computed(() => this.evaluation()?.needsReason ?? false);

  /** 担当者が加入区分を決める（判定と違う区分にする、またはシステムが判定できない） */
  deciding() {
    return this.override || this.evaluation()?.judgement.result === 'manual';
  }

  monthDay(date: string) {
    const [, m, d] = date.split('-').map(Number);
    return `${m}月${d}日`;
  }

  readonly groupBackLabel = groupBackLabel;

  /** 本人情報・雇用条件の入力の自動下書き保存（確定するまで、閉じても入力が残る） */
  autosave = createDraftAutosave({
    procedureId: () => this.procedureId,
    step: () => this.key(),
    read: () => this.draftData(),
  });

  /** 今のステップの下書きにする入力。確定済み・直せないステップは null */
  private draftData() {
    const v = this.view();
    if (!v || this.busy() || this.loading()) return null;
    if (this.key() === 'register' && !v.employee) {
      return { employeeNumber: this.employeeNumber, insuredPersonNumber: this.insuredPersonNumber, profile: this.profile };
    }
    if (this.key() === 'contract' && v.employee && !this.locked()) {
      return { contract: this.contract, override: this.override, overrideHealth: this.overrideHealth, overridePension: this.overridePension, overrideReason: this.overrideReason };
    }
    return null;
  }

  /** 前回の下書きを戻す（まだ確定していないステップだけ） */
  private async restoreDrafts() {
    const drafts = await this.autosave.load();
    const v = this.view();
    if (!v) return;
    const reg = drafts['register'];
    if (reg && !v.employee) {
      const d = reg.data as { employeeNumber: string; insuredPersonNumber: string; profile: SelfInput };
      this.employeeNumber = d.employeeNumber ?? '';
      this.insuredPersonNumber = d.insuredPersonNumber ?? '';
      this.profile = { ...this.profile, ...d.profile };
      this.autosave.restored('register', this.draftDataFor('register'), reg.savedAt);
    }
    const con = drafts['contract'];
    if (con && v.employee && !this.locked()) {
      const d = con.data as { contract: ContractForm; override: boolean; overrideHealth: boolean; overridePension: boolean; overrideReason: string };
      this.contract = { ...this.contract, ...d.contract };
      this.override = !!d.override;
      this.overrideHealth = d.overrideHealth ?? true;
      this.overridePension = d.overridePension ?? true;
      this.overrideReason = d.overrideReason ?? '';
      this.autosave.restored('contract', this.draftDataFor('contract'), con.savedAt);
      this.contractChanged();
    }
  }

  private draftDataFor(step: 'register' | 'contract') {
    return step === 'register'
      ? { employeeNumber: this.employeeNumber, insuredPersonNumber: this.insuredPersonNumber, profile: this.profile }
      : { contract: this.contract, override: this.override, overrideHealth: this.overrideHealth, overridePension: this.overridePension, overrideReason: this.overrideReason };
  }

  async ngOnInit() {
    this.procedureId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load(true);
    await this.restoreDrafts();
  }

  ngOnDestroy() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, OnboardingView>(this.functions, 'onboardingGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      this.fillForms(data);
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '入社手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  private fillForms(v: OnboardingView) {
    this.profile = structuredClone(v.selfInput ?? emptyProfile(v.procedure.plannedName));
    // 紙で提出済み（結果待ち・返戻）なら、提出方法は紙を表示する
    if (v.filing && v.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
    if (v.employee) this.employeeNumber = v.employee.employeeNumber;
    if (v.contract && !this.contractDirty()) {
      this.contract = { ...v.contract };
      const ev = v.evaluation;
      this.override = !!v.applicabilityOverride && !!ev && (ev.chosen.health !== ev.expected.health || ev.chosen.pension !== ev.expected.pension || ev.judgement.result === 'manual');
      this.overrideHealth = v.contract.healthInsuranceEnrolled ?? true;
      this.overridePension = v.contract.pensionEnrolled ?? true;
      this.overrideReason = v.applicabilityOverride?.reason ?? '';
      this.evaluation.set(v.evaluation);
    }
  }

  // ── 共通の進め方 ──

  async advance() {
    const k = this.key();
    const behind = this.index() < this.currentIndex();
    if (behind && !(k === 'contract' && this.contractDirty())) {
      this.index.set(this.index() + 1);
      return;
    }
    switch (k) {
      case 'register': return this.registerReady() ? this.run('register', () => this.registerPayload(), '台帳に登録しました') : undefined;
      case 'contract': return this.run('contract', () => this.contractPayload(), '雇用条件を保存しました', () => this.contractDirty.set(false));
      case 'filing': return this.run('filing', () => ({}), '資格取得届を作り、承認を依頼しました');
      case 'confirm': return this.run('complete', () => ({}), '入社の手続きを完了しました');
    }
  }

  private async run(step: string, payload: () => object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'onboardingUpdate')({
        companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload(),
      });
      after?.();
      // 確定したステップの下書きは消す
      if (step === 'register' || step === 'contract') void this.autosave.clear(step);
      this.snackBar.open(done, '閉じる', { duration: 4000 });
      await this.load(true);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  // ── 招待 ──

  copyLink() {
    this.clipboard.copy(this.inviteLink());
    this.snackBar.open('入力用のリンクをコピーしました。本人にメールやチャットで送ってください', '閉じる', { duration: 4000 });
  }

  inviteAction(action: 'skip' | 'reissue') {
    return this.run('invite', () => ({ action }), action === 'skip' ? '担当者が入力する形に切り替えました' : '新しいリンクを作りました（前のリンクは使えなくなりました）');
  }

  // ── 台帳への登録 ──

  private registerPayload() {
    const p = this.profile;
    const blank = (s: string | null) => (s?.trim() ? s.trim() : null);
    return {
      employeeNumber: this.employeeNumber.trim(),
      insuredPersonNumber: blank(this.insuredPersonNumber),
      profile: {
        ...p,
        lastName: p.lastName.trim(), firstName: p.firstName.trim(),
        lastNameKana: p.lastNameKana.trim(), firstNameKana: p.firstNameKana.trim(),
        postalCode: blank(p.postalCode), prefecture: blank(p.prefecture), city: blank(p.city),
        addressLine: blank(p.addressLine), building: blank(p.building), phone: blank(p.phone), email: blank(p.email),
      },
    };
  }

  registerReady() {
    const p = this.profile;
    return !!(this.employeeNumber.trim() && p.lastName.trim() && p.firstName.trim() && p.lastNameKana.trim() && p.firstNameKana.trim() && p.birthDate);
  }

  // ── 雇用条件 ──

  contractChanged() {
    this.contractDirty.set(true);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.preview(), 500);
  }

  private contractPayload() {
    const c = this.contract;
    // 送信時に undefined は null になりサーバーの検証で弾かれるため、使わない項目は送らない
    const { healthInsuranceEnrolled, pensionEnrolled, overrideReason, ...rest } = c;
    void healthInsuranceEnrolled; void pensionEnrolled; void overrideReason;
    return {
      ...rest,
      weeklyHours: Number(c.weeklyHours), monthlyDays: Number(c.monthlyDays), wageAmount: Math.floor(Number(c.wageAmount) || 0),
      monthlyHours: c.wageType === 'hourly' && c.monthlyHours ? Number(c.monthlyHours) : null,
      allowances: Math.floor(Number(c.allowances) || 0), inKind: Math.floor(Number(c.inKind) || 0),
      contractEndDate: c.contractType === 'fixed' ? (c.contractEndDate || null) : null,
      probationStartDate: c.probationStartDate || null,
      probationEndDate: c.probationEndDate || null,
      ...(this.deciding() ? { healthInsuranceEnrolled: this.overrideHealth, pensionEnrolled: this.overridePension } : {}),
      ...(this.deciding() && this.overrideReason.trim() ? { overrideReason: this.overrideReason.trim() } : {}),
    };
  }

  async preview() {
    this.evaluating.set(true);
    this.evaluationError.set('');
    try {
      const { data } = await httpsCallable<object, Evaluation>(this.functions, 'onboardingPreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, ...this.contractPayload(),
      });
      // 判定できない場合は、まず「加入しない」を選んだ状態にして担当者に決めてもらう
      if (data.judgement.result === 'manual' && this.evaluation()?.judgement.result !== 'manual' && !this.override) {
        this.overrideHealth = data.chosen.health;
        this.overridePension = data.chosen.pension;
      }
      this.evaluation.set(data);
    } catch (e) {
      this.evaluation.set(null);
      this.evaluationError.set(errorMessage(e, '判定できませんでした。入力を確かめてください'));
    } finally {
      this.evaluating.set(false);
    }
  }

  judgementTone(ev: Evaluation) {
    return ev.judgement.result === 'manual' ? 'action' : 'done';
  }

  enrollmentText(ev: Evaluation) {
    const { health, pension } = ev.chosen;
    if (health && pension) return '健康保険と厚生年金に加入する';
    if (health) return '健康保険だけに加入する';
    if (pension) return '厚生年金だけに加入する';
    return '社会保険に加入しない';
  }

  // ── 提出 ──

  /** 本人が申し出た家族を引き継いで、扶養の手続きを始める */
  async startDependents() {
    const v = this.view();
    if (!v?.employee) return;
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'dependentChangeStart')({
        companyId: this.auth.companyId, employeeId: v.employee.id, sourceProcedureId: this.procedureId,
      });
      void this.router.navigate(['/dependents', data.procedureId]);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '扶養の手続きを始められませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  submitDone() {
    const f = this.view()?.filing;
    return !!f && (f.mockStatus === 'completed' || ['accepted'].includes(f.submissionStatus));
  }
}
