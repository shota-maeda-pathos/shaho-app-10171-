import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
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
import { DUE_SOURCE_LABEL, LossReason, monthLabel, ResignationFacts, ResignationKey, ResignationView, Settlement } from './resignation.types';

const KEYS: ResignationKey[] = ['entry', 'settlement', 'account', 'filing', 'approval', 'submit', 'confirm'];

/** 退職手続きのウィザード（個人型）。退職日の登録から資格喪失届の提出まで1つの画面で進める */
@Component({
  selector: 'app-resignation-wizard',
  standalone: true,
  imports: [
    FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatRadioModule, WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './resignation-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss', './resignation-wizard.scss'],
})
export class ResignationWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly dueSourceLabel = DUE_SOURCE_LABEL;
  readonly monthLabel = monthLabel;
  procedureId = '';
  view = signal<ResignationView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  // 退職日と理由
  resignationDate = '';
  reason: LossReason = 'resignation';
  note = '';
  entryDirty = signal(false);
  facts = signal<ResignationFacts | null>(null);
  factsLoading = signal(false);
  factsError = signal('');
  private factsTimer: ReturnType<typeof setTimeout> | null = null;

  // 最後の保険料。salaryAfter が false なら退職後に支給する給与はない（最後の給与は支給済み）
  salaryAfter = true;
  lastPayMonth = '';
  settlement = signal<Settlement | null>(null);
  settlementLoading = signal(false);
  settlementDirty = signal(false);

  // アカウント・届出・提出
  accessUntil = '';
  cardsReturned = 0;
  cardsUnreturnable = 0;
  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');
  stepStatus = (id: string) => this.view()?.steps.find(s => s.id === id)?.status;
  filingSkipped = computed(() => this.stepStatus('filing_create') === 'skipped');
  settlementSkipped = computed(() => this.stepStatus('settlement') === 'skipped');

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const f = v.facts;
    const noFiling = '社会保険に加入していないため、このステップはありません。';
    const waitingApproval = v.current === 'approval' && v.approval?.status === 'pending';
    return [
      { key: 'entry', label: '退職日と理由を入れる', done: done || cur > 0,
        what: '退職日を入れて、従業員台帳に退職を登録します。資格喪失日や保険料がかかる月はシステムが決めます。',
        why: '資格喪失日（退職日の翌日）から、届出の期限と最後の保険料が決まるためです。',
        next: '最後の保険料をどう集めるかを決めます。' },
      { key: 'settlement', label: '最後の保険料の集め方を決める', done: done || cur > 1,
        what: this.settlementSkipped() ? '保険料がかかる月がないため、このステップはありません。' : '最後の月までの保険料のうち、まだ集めていない分を、どの給与から引くか（引けなければ別途入金）を決めます。',
        why: '退職後は給与がなくなることがあり、引き忘れると本人から回収できなくなるためです。',
        next: '退職後のポータルのアカウントを確かめます。' },
      { key: 'account', label: '退職後のアカウントを確かめる', done: done || cur > 2,
        what: '退職後に本人がポータルで明細を見られる期間を確かめます。必要なら延ばしたり縮めたりします。',
        why: '退職日の翌日から申請はできなくなり、閲覧だけになります。期間が過ぎるとログインできなくなります。',
        next: f?.needsFiling === false ? '届出は不要です。完了を確認します。' : '資格喪失届を作ります。' },
      { key: 'filing', label: '資格喪失届を作る', done: done || cur > 3,
        what: this.filingSkipped() ? noFiling : '被保険者証の回収状況を入れて資格喪失届を作り、承認者に確認を依頼します。',
        why: `資格喪失届は喪失日から5日以内${f?.filingDeadline ? `（${this.monthDay(f.filingDeadline)}まで）` : ''}に出す決まりがあるためです。`,
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: '承認者が確認する', done: done || cur > 4,
        what: this.filingSkipped() ? noFiling : '作った人とは別の担当者が、資格喪失届を確認します。',
        why: '1人で作った届出の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(waitingApproval ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: '提出する', done: done || cur > 5,
        what: this.filingSkipped() ? noFiling : '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '期限内に提出したことを記録に残すためです。',
        next: '提出が済んだら、完了を確認します。' },
      { key: 'confirm', label: '完了を確認する', done,
        what: '登録した内容・保険料の集め方・届出の結果を見直して、手続きを完了にします。',
        why: '漏れがないことを確かめてから、やることリストから外すためです。',
        next: 'これで退職の手続きは完了です。別途入金がある場合は、入金されたら毎月の処理で記録します。' },
    ];
  });

  /** フォームの値（シグナルでない）を読むため computed にしない */
  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'entry' && this.entryDirty()) return this.view()!.entry ? '退職日を登録し直す' : '退職日を登録する';
    if (k === 'settlement' && this.settlementDirty()) return 'この集め方に決める';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'entry': return '退職日を登録する';
      case 'settlement': return 'この集め方に決める';
      case 'account': return 'この期間で決める';
      case 'filing': return '資格喪失届を作って承認を依頼する';
      case 'confirm': return '手続きを完了する';
      default: return undefined;
    }
  }

  hideNext() {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (this.index() < this.currentIndex()) return false;
    return k === 'submit' || k === 'approval';
  }

  nextDisabled() {
    const k = this.key();
    const editing = (k === 'entry' && this.entryDirty()) || (k === 'settlement' && this.settlementDirty());
    if (this.index() < this.currentIndex() && !editing) return false;
    switch (k) {
      case 'entry': return !this.resignationDate || !this.facts() || this.factsLoading() || !!this.factsError();
      case 'settlement': return (this.salaryAfter && !this.lastPayMonth) || !this.settlement() || this.settlementLoading() || !!this.settlement()?.unknownMonths?.length;
      case 'account': return !this.accessUntil;
      default: return false;
    }
  }

  monthDay(date: string) {
    const [, m, d] = date.split('-').map(Number);
    return `${m}月${d}日`;
  }

  async ngOnInit() {
    this.procedureId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load(true);
  }

  ngOnDestroy() {
    if (this.factsTimer) clearTimeout(this.factsTimer);
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, ResignationView>(this.functions, 'resignationGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      this.fillForms(data);
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '退職手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  private fillForms(v: ResignationView) {
    if (!this.entryDirty()) {
      this.resignationDate = v.entry?.resignationDate ?? '';
      this.reason = v.entry?.reason ?? 'resignation';
      this.note = v.entry?.note ?? '';
      this.facts.set(v.facts);
    }
    if (!this.settlementDirty()) {
      this.salaryAfter = v.settlement?.lastPayMonth !== null;
      this.lastPayMonth = v.settlement?.lastPayMonth ?? v.entry?.resignationDate.slice(0, 7) ?? '';
      this.settlement.set(v.settlement);
    }
    this.accessUntil = v.account.accessUntil ?? '';
    this.cardsReturned = v.cards?.returned ?? 0;
    this.cardsUnreturnable = v.cards?.unreturnable ?? 0;
    // 紙で提出済み（結果待ち・返戻）なら、提出方法は紙を表示する
    if (v.filing && v.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
  }

  // ── 共通の進め方 ──

  async advance() {
    const k = this.key();
    const editing = (k === 'entry' && this.entryDirty()) || (k === 'settlement' && this.settlementDirty());
    if (this.index() < this.currentIndex() && !editing) {
      this.index.set(this.index() + 1);
      return;
    }
    switch (k) {
      case 'entry': return this.run('entry', { resignationDate: this.resignationDate, reason: this.reason, note: this.note.trim() }, '退職を登録しました', () => this.entryDirty.set(false));
      case 'settlement': return this.run('settlement', { lastPayMonth: this.payMonthValue() }, '最後の保険料の集め方を決めました', () => this.settlementDirty.set(false));
      case 'account': return this.run('account', { accessUntil: this.accessUntil }, '退職後のアカウントの期間を決めました');
      case 'filing': return this.run('filing', { cardsReturned: Number(this.cardsReturned) || 0, cardsUnreturnable: Number(this.cardsUnreturnable) || 0 }, '資格喪失届を作り、承認を依頼しました');
      case 'confirm': return this.run('complete', {}, '退職の手続きを完了しました');
    }
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'resignationUpdate')({
        companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload,
      });
      after?.();
      this.snackBar.open(done, '閉じる', { duration: 4000 });
      await this.load(true);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  // ── 退職日と理由 ──

  entryChanged() {
    this.entryDirty.set(true);
    if (this.factsTimer) clearTimeout(this.factsTimer);
    this.factsTimer = setTimeout(() => void this.previewEntry(), 400);
  }

  private async previewEntry() {
    if (!this.resignationDate) { this.facts.set(null); return; }
    this.factsLoading.set(true);
    this.factsError.set('');
    try {
      const { data } = await httpsCallable<object, ResignationFacts>(this.functions, 'resignationPreview')({
        kind: 'entry', companyId: this.auth.companyId, procedureId: this.procedureId,
        resignationDate: this.resignationDate, reason: this.reason, note: '',
      });
      this.facts.set(data);
    } catch (e) {
      this.facts.set(null);
      this.factsError.set(errorMessage(e, '退職日を確かめてください'));
    } finally {
      this.factsLoading.set(false);
    }
  }

  insuranceText(f: ResignationFacts) {
    const { health, pension } = f.lost;
    if (health && pension) return '健康保険と厚生年金';
    if (health) return '健康保険だけ';
    if (pension) return '厚生年金だけ';
    return 'なし';
  }

  // ── 最後の保険料 ──

  private payMonthValue() {
    return this.salaryAfter ? this.lastPayMonth : null;
  }

  async lastPayMonthChanged() {
    this.settlementDirty.set(true);
    if (this.salaryAfter && !this.lastPayMonth) return;
    this.settlementLoading.set(true);
    try {
      const { data } = await httpsCallable<object, Settlement>(this.functions, 'resignationPreview')({
        kind: 'settlement', companyId: this.auth.companyId, procedureId: this.procedureId, lastPayMonth: this.payMonthValue(),
      });
      this.settlement.set(data);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '計算できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.settlementLoading.set(false);
    }
  }

  planText(r: Settlement['rows'][number]) {
    switch (r.plan) {
      case 'unknown': return '等級がないため計算できません';
      case 'none': return 'かかりません';
      case 'collected': return '集め終わっています';
      case 'over': return `取りすぎ ${(-r.remaining).toLocaleString('ja-JP')}円を返金`;
      case 'payroll': return `${monthLabel(r.payMonth)}支給の給与から控除`;
      case 'final': return `最後の給与（${monthLabel(r.payMonth)}支給）からまとめて控除`;
      case 'transfer': return '給与から引けないため別途入金で回収';
    }
  }

  planTone(r: Settlement['rows'][number]): 'done' | 'yours' | 'action' {
    return r.plan === 'transfer' || r.plan === 'over' || r.plan === 'unknown' ? 'action' : r.plan === 'payroll' || r.plan === 'final' ? 'yours' : 'done';
  }

  // ── 提出 ──

  submitDone() {
    const f = this.view()?.filing;
    return !!f && (f.mockStatus === 'completed' || f.submissionStatus === 'accepted');
  }
}
