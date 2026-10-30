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
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import {
  ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, TermComponent, WizardComponent, WizardStep,
} from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';
import { addMonth, ChangeForm, Evaluation, monthLabel, RevisionKey, RevisionView } from './revision.types';

const KEYS: RevisionKey[] = ['change', 'judge', 'filing', 'approval', 'submit', 'confirm'];

/**
 * 随時改定・産休育休終了時改定のウィザード（個人型）。変動（または休業の終わり）を確かめ、3か月の給与で判定し、
 * 届出の承認で新しい等級を確定する。新しい等級は起点の月から4か月目の保険料から使う
 */
@Component({
  selector: 'app-revision-wizard',
  standalone: true,
  imports: [
    FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule,
    WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './revision-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss', './revision-wizard.scss'],
})
export class RevisionWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly monthLabel = monthLabel;
  readonly addMonth = addMonth;
  procedureId = '';
  view = signal<RevisionView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  form: ChangeForm = emptyForm();
  dirty = signal(false);
  /** 入れかけの内容での判定（変動を確かめるステップ） */
  preview = signal<Evaluation | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  /** 後から送った判定の結果だけを使う（入力が続いたときに古い結果で上書きしない） */
  private previewSeq = 0;
  closeChecked = false;

  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  isLeave = computed(() => this.view()?.procedure.kind !== 'occasional');
  /** 判定の結果。決めたあとは決めたときの値を見る */
  judgement = computed(() => this.view()?.evaluation?.judgement ?? null);

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const leave = this.isLeave();
    const closed = !!v.closedReason;
    return [
      { key: 'change', label: leave ? '休業の終わりと申出を確かめる' : '変動を確かめる', done: done || cur > 0,
        what: leave
          ? '休業を終えた日と養育する子、本人から申出があったかを入れます。'
          : '固定的賃金（基本給や手当）が変わった給与の支給月（変動月）を入れます。前の月と比べて上がったか下がったかはシステムが見ます。',
        why: leave
          ? '復帰した月から3か月の給与で判定し、本人の申出があるときだけ改定するためです。'
          : '随時改定は、固定的賃金が変わったときだけ、変わった月から3か月の給与で判定するためです。',
        next: '3か月の給与で判定します。' },
      { key: 'judge', label: '判定する', done: done || cur > 1,
        what: leave
          ? '3か月の報酬と支払基礎日数から平均を出し、今の等級と比べます。基準の日数に満たない月は平均に入れません。'
          : '3か月の報酬と支払基礎日数から平均を出し、今の等級と比べます。健康保険と厚生年金は別々に判定します。',
        why: leave ? '1等級でも差があれば改定できるためです。' : '2等級以上の差（上限・下限の等級は特例あり）があるときに改定する決まりのためです。',
        next: closed ? '改定しないため、ここで手続きを終えます。' : '改定する場合は届出を作ります。' },
      { key: 'filing', label: `${v.filingLabel}を作る`, done: done || cur > 2,
        what: '判定の内容から届出を作り、承認者に確認を依頼します。',
        why: '届出が承認されると、新しい等級が確定して毎月の保険料の計算に使われるためです。',
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: '承認者が確認する', done: done || cur > 3,
        what: '作った人とは別の担当者が、届出と新しい等級を確認します。',
        why: '1人で決めた等級の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(v.current === 'approval' && v.approval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: '提出する', done: done || cur > 4,
        what: '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '改定月から速やかに提出する決まりがあるためです。',
        next: '提出したら、手続きを完了にします。' },
      { key: 'confirm', label: '完了を確認する', done,
        what: '新しい等級と、それを使い始める月を見直して、手続きを完了にします。',
        why: 'その月の保険料をすでに計算していれば、計算し直す必要があるためです。',
        next: 'これで手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    const v = this.view();
    if (!v || this.isDone()) return undefined;
    if (k === 'change' && this.dirty()) return '保存して判定する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'change': return '保存して判定する';
      case 'judge': return this.judgement()?.status === 'eligible' ? 'この判定で改定する' : undefined;
      case 'filing': return '届出を作って承認を依頼する';
      case 'confirm': return '手続きを完了にする';
      default: return undefined;
    }
  }

  hideNext() {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (k === 'change' && this.dirty()) return false;
    if (this.index() < this.currentIndex()) return false;
    if (k === 'judge') return this.judgement()?.status !== 'eligible' || !!this.view()?.evaluation?.conflict;
    return k === 'submit' || k === 'approval';
  }

  nextDisabled() {
    const k = this.key();
    if (k === 'change' && (this.dirty() || this.index() === this.currentIndex())) return !!this.changeMissing() || this.view()?.locked === true;
    return false;
  }

  /** 変動を保存できない理由（足りない項目） */
  changeMissing(): string {
    const f = this.form;
    if (!this.isLeave()) return f.startMonth ? '' : '変動月を入れてください';
    if (!f.endDate) return '休業を終えた日を入れてください';
    if (!f.childBirthDate) return '養育する子の生年月日を入れてください';
    if (f.applied && !f.appliedDate) return '本人から申出を受けた日を入れてください';
    return '';
  }

  /** 終了時改定で判定に使う3か月の最初の月（休業を終えた日の翌日が属する月） */
  leaveStartMonth(): string | null {
    const d = this.form.endDate;
    if (!d) return null;
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 7);
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
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  /** 毎月の処理・ホーム・産休育休の完了などから開いたとき。手続きを作って（または進行中のものを）開く */
  private async startNew() {
    const q = this.route.snapshot.queryParamMap;
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'gradeRevisionStart')({
        companyId: this.auth.companyId, employeeId: q.get('employeeId') ?? '', kind: q.get('kind') ?? 'occasional',
        startMonth: q.get('startMonth'), sourceProcedureId: q.get('sourceProcedureId'),
      });
      this.procedureId = data.procedureId;
      await this.router.navigate(['/revisions', data.procedureId], { replaceUrl: true });
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
      const { data } = await httpsCallable<object, RevisionView>(this.functions, 'gradeRevisionGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      if (!this.dirty()) {
        this.form = formOf(data);
        this.preview.set(data.evaluation);
      }
      if (data.filing && data.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── 変動を確かめる ──

  changed() {
    this.dirty.set(true);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.runPreview(), 400);
  }

  private async runPreview() {
    const seq = ++this.previewSeq;
    try {
      const { data } = await httpsCallable<object, Evaluation>(this.functions, 'gradeRevisionPreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, ...this.form,
      });
      if (seq === this.previewSeq) this.preview.set(data);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '判定できませんでした'), '閉じる', { duration: 6000 });
    }
  }

  // ── 共通の進め方 ──

  async advance() {
    const k = this.key();
    if (this.index() < this.currentIndex() && !(k === 'change' && this.dirty())) {
      this.index.set(this.index() + 1);
      return;
    }
    switch (k) {
      case 'change': return this.run('change', this.form, '保存しました', () => this.dirty.set(false));
      case 'judge': return this.run('decide', { decision: 'revise' }, '改定すると決めました');
      case 'filing': return this.run('filing', {}, `${this.view()!.filingLabel}を作り、承認を依頼しました`);
      case 'confirm': return this.run('complete', {}, '手続きを完了にしました');
    }
  }

  async closeWithoutRevision() {
    await this.run('decide', { decision: 'close' }, '改定しないで手続きを終えました', () => { this.closeChecked = false; });
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable<object, unknown>(this.functions, 'gradeRevisionUpdate')({
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

  // ── 表示 ──

  gradeText(r: { currentGrade: number | null; currentStandard: number | null }) {
    return r.currentGrade == null ? '—' : `${r.currentGrade}等級（${(r.currentStandard ?? 0).toLocaleString('ja-JP')}円）`;
  }

  newGradeText(r: { eligible: boolean; newGrade: number | null; newStandard: number | null }) {
    return r.newGrade == null ? '—' : `${r.newGrade}等級（${(r.newStandard ?? 0).toLocaleString('ja-JP')}円）`;
  }

  /** 決めた内容（決めたあと）か、今の判定（決める前） */
  shown() {
    const v = this.view();
    if (!v) return null;
    if (v.decision && this.currentIndex() > 1) {
      const d = v.decision;
      return {
        effectiveMonth: d.effectiveMonth, average: d.average, averageWithRetro: d.averageWithRetro,
        health: d.health, pension: d.pension,
      };
    }
    const j = this.judgement();
    return j ? { effectiveMonth: j.effectiveMonth, average: j.average, averageWithRetro: j.averageWithRetro, health: j.health, pension: j.pension } : null;
  }
}

function emptyForm(): ChangeForm {
  return {
    startMonth: '', manualDirection: null, previousRemuneration: null, note: '',
    endDate: '', childName: '', childBirthDate: '', nextLeaveFromNextDay: false, applied: false, appliedDate: '',
  };
}

function formOf(v: RevisionView): ChangeForm {
  const l = v.form.leave;
  return {
    startMonth: v.form.startMonth ?? '', manualDirection: v.form.manualDirection, previousRemuneration: v.form.previousRemuneration, note: v.form.note,
    endDate: l?.endDate ?? '', childName: l?.childName ?? '', childBirthDate: l?.childBirthDate ?? '',
    nextLeaveFromNextDay: l?.nextLeaveFromNextDay ?? false, applied: l?.applied ?? false, appliedDate: l?.appliedDate ?? '',
  };
}
