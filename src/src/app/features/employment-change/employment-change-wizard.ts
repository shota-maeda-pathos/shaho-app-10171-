import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import {
  ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, TermComponent, WizardComponent, WizardStep,
} from '../../shared/ui';
import { ContractForm, EMPLOYMENT_TYPES, errorMessage } from '../onboarding/onboarding.types';
import { ChangeJudgement, ChangeKey, ChangeView } from './employment-change.types';

const KEYS: ChangeKey[] = ['entry', 'change_approval', 'filing', 'approval', 'submit', 'confirm'];

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/**
 * 雇用条件の変更（有期契約の更新を含む）のウィザード（個人型）。新しい雇用条件を別の担当者が承認したら台帳に反映し、
 * 社会保険の加入が切り替わるときは資格取得届・資格喪失届を作る
 */
@Component({
  selector: 'app-employment-change-wizard',
  standalone: true,
  imports: [
    FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatRadioModule, MatSelectModule, WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './employment-change-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss'],
})
export class EmploymentChangeWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly employmentTypes = EMPLOYMENT_TYPES;
  procedureId = '';
  view = signal<ChangeView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  effectiveDate = '';
  note = '';
  form: ContractForm = emptyForm();
  overrideReason = '';
  dirty = signal(false);
  judged = signal<ChangeJudgement | null>(null);
  judgeError = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  noFiling = computed(() => this.view()?.steps.find(s => s.id === 'filing_create')?.status === 'skipped');
  /** 承認を依頼したあと（承認待ち・承認済み）は入力を直せない */
  locked = computed(() => {
    const v = this.view();
    return !!v && (v.applied || v.changeApproval?.status === 'pending');
  });

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const skipped = this.noFiling();
    const filing = v.filingLabel || '届出';
    return [
      { key: 'entry', label: v.procedure.reason === 'renewal' ? '更新後の契約' : '新しい条件', done: done || cur > 0,
        what: '新しい条件を使い始める日と、雇用区分・労働時間・給与・契約期間を入れます。社会保険に加入するかはシステムが判定し直します。',
        why: '労働時間や契約の変更で、社会保険の加入・喪失や、等級の見直しが必要になることがあるためです。',
        next: '別の担当者に雇用条件の確認を依頼します。' },
      { key: 'change_approval', label: '条件の承認', done: done || cur > 1,
        what: '入れた人とは別の担当者が、新しい雇用条件を確認します。承認されると台帳に反映します。',
        why: '雇用条件の変更は、別の担当者の承認で確定する決まりのためです。',
        next: skipped || v.effect === 'none' ? '加入が変わらないため、届出はありません。' : `${filing}を作ります。`,
        ...(v.current === 'change_approval' && v.changeApproval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'filing', caution: '承認を依頼すると、差し戻されるまで内容を直せません。', label: skipped ? '届出（不要）' : '届出の作成', done: done || cur > 2,
        what: '新しい雇用条件から届出を作り、承認者に確認を依頼します。',
        why: '社会保険の加入・喪失は5日以内に届け出る決まりがあるためです。',
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: skipped ? '届出の承認（不要）' : '届出の承認', done: done || cur > 3,
        what: '作った人とは別の担当者が、届出を確認します。',
        why: '1人で作った届出の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(v.current === 'approval' && v.approval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: skipped ? '提出（不要）' : '提出', done: done || cur > 4,
        what: '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '期限内に提出したことを記録に残すためです。',
        next: '提出したら、手続きを完了にします。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '反映した雇用条件と、次にやること（随時改定など）を確かめて、手続きを完了にします。',
        why: '保険料の計算は、新しい雇用条件の初日の月から変わるためです。',
        next: 'これで手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'entry' && (this.dirty() || this.index() === this.currentIndex())) return '保存して承認を依頼する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'filing': return '届出を作って承認を依頼する';
      case 'confirm': return '手続きを完了する';
      default: return undefined;
    }
  }

  hideNext() {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (k === 'entry' && this.dirty()) return false;
    if (this.index() < this.currentIndex()) return false;
    return k === 'change_approval' || k === 'approval' || k === 'submit';
  }

  nextDisabled() {
    if (this.key() === 'entry' && (this.dirty() || this.index() === this.currentIndex())) {
      const j = this.judged();
      if (this.locked() || !this.effectiveDate || !j || this.judgeError()) return true;
      if (this.form.contractType === 'fixed' && !this.form.contractEndDate) return true;
      return j.needsReason && j.judgement.result === 'manual' ? !this.overrideReason.trim() : false;
    }
    return false;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (id === 'new') {
      await this.startNew();
      return;
    }
    this.procedureId = id;
    await this.load(true);
  }

  ngOnDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async startNew() {
    const q = this.route.snapshot.queryParamMap;
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'employmentChangeStart')({
        companyId: this.auth.companyId, employeeId: q.get('employeeId') ?? '', reason: q.get('reason') ?? 'change',
      });
      this.procedureId = data.procedureId;
      await this.router.navigate(['/employment-changes', data.procedureId], { replaceUrl: true });
      await this.load(true);
    } catch (e) {
      this.loading.set(false);
      this.loadError.set(errorMessage(e, '手続きを始められませんでした'));
    }
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, ChangeView>(this.functions, 'employmentChangeGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      if (!this.dirty()) this.fillForm(data);
      if (data.filing && data.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  /** 保存した入力、なければ今の雇用条件を入れておく（契約の更新は、今の契約の翌日から） */
  private fillForm(v: ChangeView) {
    const saved = v.input as (ContractForm & { effectiveDate: string; note: string; overrideReason: string | null }) | null;
    if (saved) {
      this.form = { ...emptyForm(), ...saved, overrideReason: undefined };
      this.effectiveDate = saved.effectiveDate;
      this.note = saved.note ?? '';
      this.overrideReason = saved.overrideReason ?? '';
    } else if (v.before) {
      const b = v.before;
      this.form = {
        ...emptyForm(), employmentType: b.employmentType as ContractForm['employmentType'], weeklyHours: b.weeklyHours, monthlyDays: b.monthlyDays,
        wageAmount: b.baseSalary, contractType: b.contractType as ContractForm['contractType'], contractEndDate: b.contractEndDate,
      };
      if (v.procedure.reason === 'renewal' && b.contractEndDate) {
        this.effectiveDate = nextDay(b.contractEndDate);
        this.form.contractType = 'fixed';
        this.form.contractEndDate = null;
      }
    }
    if (this.effectiveDate) void this.preview();
  }

  changed() {
    this.dirty.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.preview(), 400);
  }

  private payload() {
    const reason = this.overrideReason.trim();
    return {
      ...this.form, effectiveDate: this.effectiveDate, note: this.note,
      monthlyHours: this.form.wageType === 'hourly' ? this.form.monthlyHours : null,
      contractEndDate: this.form.contractType === 'fixed' ? this.form.contractEndDate || null : null,
      healthInsuranceEnrolled: null, pensionEnrolled: null,
      overrideReason: reason || null,
    };
  }

  private async preview() {
    if (!this.effectiveDate) return;
    const seq = ++this.seq;
    try {
      const { data } = await httpsCallable<object, ChangeJudgement>(this.functions, 'employmentChangePreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, ...this.payload(),
      });
      if (seq === this.seq) { this.judged.set(data); this.judgeError.set(''); }
    } catch (e) {
      if (seq === this.seq) { this.judged.set(null); this.judgeError.set(errorMessage(e, '判定できませんでした')); }
    }
  }

  async advance() {
    const k = this.key();
    if (k === 'entry' && (this.dirty() || this.index() === this.currentIndex())) {
      return this.run('entry', this.payload(), '雇用条件の確認を依頼しました', () => this.dirty.set(false));
    }
    if (this.index() < this.currentIndex()) {
      this.index.set(this.noFiling() && k === 'change_approval' ? KEYS.length - 1 : this.index() + 1);
      return;
    }
    switch (k) {
      case 'filing': return this.run('filing', {}, `${this.view()!.filingLabel}を作り、承認を依頼しました`);
      case 'confirm': return this.run('complete', {}, '手続きを完了にしました');
    }
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable<object, unknown>(this.functions, 'employmentChangeUpdate')({
        companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload,
      });
      after?.();
      this.snackBar.open(done, '閉じる', { duration: 5000 });
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

  typeLabel(t: string | undefined) {
    return EMPLOYMENT_TYPES.find(x => x.value === t)?.label ?? t ?? '';
  }
}

function emptyForm(): ContractForm {
  return {
    employmentType: 'regular', weeklyHours: 40, monthlyDays: 21, wageType: 'monthly', wageAmount: 0, monthlyHours: null,
    allowances: 0, inKind: 0, contractType: 'indefinite', contractEndDate: null, renewalExpected: false, isStudent: false,
  };
}
