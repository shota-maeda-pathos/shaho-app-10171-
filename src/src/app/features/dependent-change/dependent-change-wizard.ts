import { FilingSubmissionComponent } from '../filings/submission/filing-submission';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { errorMessage } from '../onboarding/onboarding.types';
import {
  ChangeItem, ChangeKind, DependentKey, DependentView, emptyItem, RELATIONSHIP_OPTIONS, relationshipLabel, REMOVE_REASONS, Summary,
} from './dependent-change.types';

const KEYS: DependentKey[] = ['change', 'filing', 'approval', 'submit', 'confirm'];

/** 扶養の手続きのウィザード（個人型）。扶養に入れる・外す・変える人をまとめて届け出て、完了時に台帳へ反映する */
@Component({
  selector: 'app-dependent-change-wizard',
  standalone: true,
  imports: [
    FilingSubmissionComponent, DatePipe, DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatRadioModule, MatSelectModule, WizardComponent, TermComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  templateUrl: './dependent-change-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss', './dependent-change-wizard.scss'],
})
export class DependentChangeWizardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  readonly relationships = RELATIONSHIP_OPTIONS;
  readonly relationshipLabel = relationshipLabel;
  readonly removeReasons = REMOVE_REASONS;
  procedureId = '';
  view = signal<DependentView | null>(null);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);

  items: ChangeItem[] = [];
  dirty = signal(false);
  summary = signal<Summary | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  method: 'electronic' | 'paper' = 'electronic';
  mockResult = signal('');

  currentIndex = computed(() => {
    const v = this.view();
    if (!v) return 0;
    return v.current === 'done' ? KEYS.length - 1 : KEYS.indexOf(v.current);
  });
  key = computed(() => KEYS[this.index()]);
  isDone = computed(() => this.view()?.current === 'done');

  steps = computed<WizardStep[]>(() => {
    const v = this.view();
    if (!v) return [];
    const done = this.isDone();
    const cur = this.currentIndex();
    const deadline = this.summary()?.deadline ?? v.deadline;
    return [
      { key: 'change', label: '変わった内容', done: done || cur > 0,
        what: '扶養に入れる人・外す人・氏名などが変わった人を入れます。収入の基準はシステムが判定します。',
        why: '扶養に入れるかは、続柄・年齢・年間収入の見込みで決まるためです。',
        next: '被扶養者（異動）届を作ります。' },
      { key: 'filing', caution: '承認を依頼すると、差し戻されるまで内容を直せません。', label: '届出の作成', done: done || cur > 1,
        what: '入れた内容から届出を作り、承認者に確認を依頼します。添える書類も確かめます。',
        why: `被扶養者（異動）届は事実の発生から5日以内${deadline ? `（${this.monthDay(deadline)}まで）` : ''}に出す決まりがあるためです。`,
        next: '承認者が届出を確認します。' },
      { key: 'approval', label: '承認', done: done || cur > 2,
        what: '作った人とは別の担当者が、届出を確認します。',
        why: '1人で作った届出の誤りを防ぐためです。',
        next: '承認されると、届出を提出できるようになります。',
        ...(v.current === 'approval' && v.approval?.status === 'pending' ? { waitingFor: '承認者' } : {}) },
      { key: 'submit', label: '提出', done: done || cur > 3,
        what: '電子申請か紙のどちらかで提出し、結果を記録します。',
        why: '期限内に提出したことを記録に残すためです。',
        next: '提出が済んだら、完了を確認して台帳に反映します。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '届出の結果を見直して手続きを完了にします。このとき従業員台帳の被扶養者に反映します。',
        why: '届出が済む前に台帳を変えると、届出の内容と台帳が食い違うことがあるためです。',
        next: 'これで扶養の手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'change' && this.dirty()) return '内容を保存する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'change': return '内容を保存して届出へ';
      case 'filing': return '届出を作って承認を依頼する';
      case 'confirm': return '完了して台帳に反映する';
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
    if (this.index() < this.currentIndex() && !(this.key() === 'change' && this.dirty())) return false;
    if (this.key() === 'change') return !this.items.length || this.items.some((item, i) => !!this.missing(item, i));
    return false;
  }

  /** 保存できない理由（足りない項目）。なければ空 */
  missing(item: ChangeItem, i: number): string {
    if (item.kind !== 'add' && !item.dependentId) return '扶養に入っている人を選んでください';
    if (!item.lastName.trim() || !item.firstName.trim()) return '氏名を入れてください';
    if (!item.lastNameKana.trim() || !item.firstNameKana.trim()) return 'フリガナを入れてください';
    if (!item.birthDate) return '生年月日を入れてください';
    if (!item.eventDate) return `${this.eventLabel(item.kind)}を入れてください`;
    if (item.kind !== 'add' && !item.reason.trim()) return item.kind === 'remove' ? '外す理由を選んでください' : '変わった内容を入れてください';
    const j = this.summary()?.judgements[i];
    if (j?.lateElderly) return '75歳以上のため扶養に入れません';
    if (j?.overLimit && !item.exceptionReason.trim()) return '収入が基準以上です。扶養に入れる理由を入れてください';
    return '';
  }

  eventLabel(kind: ChangeKind) {
    return kind === 'add' ? '扶養に入れる日（結婚・出生・退職などの日）' : kind === 'remove' ? '扶養から外れる日' : '変わった日';
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
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, DependentView>(this.functions, 'dependentChangeGet')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
      });
      this.view.set(data);
      if (!this.dirty()) {
        this.items = data.items.length ? structuredClone(data.items) : [emptyItem()];
        this.summary.set({ judgements: data.judgements, deadline: data.deadline, attachments: data.attachments });
        // 入社から引き継いだ直後など、保存前の内容は判定し直す
        if (!data.judgements.length && data.items.length) void this.preview();
      }
      if (data.filing && data.filing.submissionStatus !== 'notSubmitted') this.method = 'paper';
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '扶養の手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── 変わった内容 ──

  changed() {
    this.dirty.set(true);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.preview(), 400);
  }

  private async preview() {
    try {
      const { data } = await httpsCallable<object, Summary>(this.functions, 'dependentChangePreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId,
        items: this.items.map(i => ({
          kind: i.kind, eventDate: i.eventDate, birthDate: i.birthDate, relationship: i.relationship,
          income: Math.max(0, Math.floor(Number(i.income) || 0)), coResident: i.coResident, isDisabled: i.isDisabled, reason: i.reason,
        })),
      });
      this.summary.set(data);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '判定できませんでした'), '閉じる', { duration: 6000 });
    }
  }

  addItem() {
    this.items.push(emptyItem());
    this.changed();
  }

  removeItem(i: number) {
    this.items.splice(i, 1);
    if (!this.items.length) this.items.push(emptyItem());
    this.changed();
  }

  kindChanged(item: ChangeItem) {
    if (item.kind === 'add') Object.assign(item, { ...emptyItem('add'), eventDate: item.eventDate });
    else Object.assign(item, { dependentId: null, reason: '' });
    this.changed();
  }

  /** 外す・変える人を選んだら、台帳の内容を入れる */
  pickDependent(item: ChangeItem) {
    const d = this.view()?.dependents.find(x => x.id === item.dependentId);
    if (d) {
      Object.assign(item, {
        lastName: d.lastName, firstName: d.firstName, lastNameKana: d.lastNameKana, firstNameKana: d.firstNameKana,
        birthDate: d.birthDate, gender: d.gender, relationship: d.relationship, income: d.income, coResident: d.coResident,
        occupation: d.occupation, isDisabled: d.isDisabled,
      });
    }
    this.changed();
  }

  /** 同じ人を2回選ばないよう、ほかの行で選んだ人を除く */
  choices(i: number) {
    const used = new Set(this.items.filter((x, n) => n !== i && x.dependentId).map(x => x.dependentId));
    return (this.view()?.dependents ?? []).filter(d => !used.has(d.id));
  }

  private payload() {
    return {
      items: this.items.map(i => ({
        ...i,
        dependentId: i.kind === 'add' ? null : i.dependentId,
        income: Math.max(0, Math.floor(Number(i.income) || 0)),
        lastName: i.lastName.trim(), firstName: i.firstName.trim(), lastNameKana: i.lastNameKana.trim(), firstNameKana: i.firstNameKana.trim(),
        occupation: i.occupation.trim(), reason: i.reason.trim(), exceptionReason: i.exceptionReason.trim(),
      })),
    };
  }

  // ── 共通の進め方 ──

  async advance() {
    const k = this.key();
    if (this.index() < this.currentIndex() && !(k === 'change' && this.dirty())) {
      this.index.set(this.index() + 1);
      return;
    }
    switch (k) {
      case 'change': return this.run('change', this.payload(), '内容を保存しました', () => this.dirty.set(false));
      case 'filing': return this.run('filing', {}, '被扶養者（異動）届を作り、承認を依頼しました');
      case 'confirm': return this.run('complete', {}, '扶養の手続きを完了し、台帳に反映しました');
    }
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'dependentChangeUpdate')({
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

  kindText(kind: ChangeKind) {
    return kind === 'add' ? '扶養に入れる' : kind === 'remove' ? '扶養から外す' : '変更';
  }

  // ── 提出 ──

  submitDone() {
    const f = this.view()?.filing;
    return !!f && (f.mockStatus === 'completed' || f.submissionStatus === 'accepted');
  }
}
