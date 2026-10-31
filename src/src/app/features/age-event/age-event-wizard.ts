import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
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
import { GroupNavComponent, groupBackLabel } from '../procedures/procedure-groups';
import {
  ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, TermComponent, WizardComponent, WizardStep,
} from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';
import { AgeKey, AgeView, monthLabel, Pension70Result } from './age-event.types';

const KEYS: AgeKey[] = ['check', 'filing', 'approval', 'submit', 'confirm'];

/**
 * 年齢到達（70歳の厚生年金の喪失・75歳の健康保険の喪失）のウィザード（個人型）。
 * 70歳は標準報酬月額相当額が到達前と同じなら届出なしで完了する
 */
@Component({
  selector: 'app-age-event-wizard',
  standalone: true,
  imports: [
    GroupNavComponent, FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule,
    WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './age-event-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss'],
})
export class AgeEventWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly monthLabel = monthLabel;
  readonly groupBackLabel = groupBackLabel;
  procedureId = '';
  view = signal<AgeView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  remuneration: number | null = null;
  inKind = 0;
  cardsReturned = 0;
  cardsUnreturnable = 0;
  dirty = signal(false);
  judged = signal<Pension70Result | null>(null);
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
  is70 = computed(() => this.view()?.procedure.kind === 'pension70');
  /** 届出が要らない（70歳で相当額が同じ） */
  noFiling = computed(() => this.view()?.steps.find(s => s.id === 'filing_create')?.status === 'skipped');

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const p70 = this.is70();
    const skipped = this.noFiling();
    return [
      { key: 'check', label: '到達日の確認', done: done || cur > 0,
        what: p70
          ? '70歳に達する日と、その日の報酬月額を確かめます。報酬月額から標準報酬月額相当額を出し、届出が要るかをシステムが判定します。'
          : '75歳の誕生日に健康保険の資格を失います。被扶養者と、回収する保険証などの枚数を確かめます。',
        why: p70
          ? '厚生年金は70歳に達する日に資格を失い、70歳以上被用者になります。報酬が変わらなければ届出は原則いりません。'
          : '健康保険の資格喪失届を5日以内に出す決まりがあるためです。',
        next: p70 ? '届出が要る場合は届出を作ります。要らなければ完了を確認します。' : '資格喪失届を作ります。' },
      { key: 'filing', caution: '承認を依頼すると、差し戻されるまで内容を直せません。', label: skipped ? '届出（不要）' : '届出の作成', done: done || cur > 1,
        what: '確かめた内容から届出を作り、承認者に確認を依頼します。',
        why: `${Number(v.facts.deadline.slice(5, 7))}月${Number(v.facts.deadline.slice(8))}日までに出す決まりがあるためです。`,
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: skipped ? '承認（不要）' : '承認', done: done || cur > 2,
        what: '作った人とは別の担当者が、届出を確認します。',
        why: '1人で作った届出の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(v.current === 'approval' && v.approval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: skipped ? '提出（不要）' : '提出', done: done || cur > 3,
        what: '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '期限内に提出したことを記録に残すためです。',
        next: '提出したら、手続きを完了にします。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '保険料が何月分まで（から）変わるかを見直して、手続きを完了にします。',
        why: '毎月の保険料の計算は年齢から自動で変わるため、その月の計算結果を確かめるためです。',
        next: 'これで手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'check' && (this.dirty() || this.index() === this.currentIndex())) return '保存して次へ';
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
    if (k === 'check' && this.dirty()) return false;
    if (this.index() < this.currentIndex()) return false;
    return k === 'submit' || k === 'approval';
  }

  nextDisabled() {
    const v = this.view();
    if (this.key() === 'check' && (this.dirty() || this.index() === this.currentIndex())) {
      if (v?.locked) return true;
      if (this.is70()) return !this.remuneration || this.judged()?.filingRequired == null;
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

  /** ホームのやること・手続きを始めるから開いたとき。手続きを作って（またはあるものを）開く */
  private async startNew() {
    const q = this.route.snapshot.queryParamMap;
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'ageEventStart')({
        companyId: this.auth.companyId, employeeId: q.get('employeeId') ?? '', kind: q.get('kind') ?? 'pension70',
      });
      this.procedureId = data.procedureId;
      await this.router.navigate(['/age-events', data.procedureId], { replaceUrl: true });
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
      const { data } = await httpsCallable<object, AgeView>(this.functions, 'ageEventGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      if (!this.dirty()) {
        // 70歳の報酬月額は、保存がなければ直近の給与からの目安を入れておく
        this.remuneration = data.state.remuneration ?? data.estimate;
        this.inKind = data.state.inKind;
        this.cardsReturned = data.state.cardsReturned;
        this.cardsUnreturnable = data.state.cardsUnreturnable;
        if (data.procedure.kind === 'pension70' && this.remuneration) void this.preview();
      }
      if (data.filing && data.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  changed() {
    this.dirty.set(true);
    if (!this.is70()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.preview(), 400);
  }

  private async preview() {
    const seq = ++this.seq;
    try {
      const { data } = await httpsCallable<object, Pension70Result | null>(this.functions, 'ageEventPreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, remuneration: this.remuneration ?? null,
      });
      if (seq === this.seq) this.judged.set(data);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '判定できませんでした'), '閉じる', { duration: 6000 });
    }
  }

  async advance() {
    const k = this.key();
    if (k === 'check' && (this.dirty() || this.index() === this.currentIndex())) {
      return this.run('check', {
        remuneration: this.remuneration ?? null, inKind: this.inKind ?? 0,
        cardsReturned: this.cardsReturned ?? 0, cardsUnreturnable: this.cardsUnreturnable ?? 0,
      }, '保存しました', () => this.dirty.set(false));
    }
    if (this.index() < this.currentIndex()) {
      // 届出が要らないときは届出のステップを飛ばす
      this.index.set(this.noFiling() && k === 'check' ? KEYS.length - 1 : this.index() + 1);
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
      await httpsCallable<object, unknown>(this.functions, 'ageEventUpdate')({
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
}
