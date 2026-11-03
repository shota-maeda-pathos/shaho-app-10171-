import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, WizardComponent, WizardStep, createDraftAutosave } from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';

import { MatDatepickerModule } from '@angular/material/datepicker';
type Key = 'entry' | 'apply' | 'filings' | 'confirm' | 'done';
const KEYS: Key[] = ['entry', 'apply', 'filings', 'confirm'];

interface Facts { healthRateChanges: boolean; filingRequired: boolean; pensionOfficeChanges: boolean; newRateMonth: string; notes: string[] }
interface FilingState { id: string; workflowStatus: string; mockStatus: string; submissionStatus: string; done: boolean }
interface TransferView {
  procedure: { id: string; version: number; status: string; title: string; officeName: string; employeeName: string };
  current: Key;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; currentOfficeId: string; otherEmployer: string | null };
  from: { id: string; name: string };
  to: { id: string; name: string } | null;
  transferDate: string | null;
  reason: string;
  facts: Facts | null;
  applied: boolean;
  lossFiling: FilingState | null;
  acquisitionFiling: FilingState | null;
}

/**
 * 事業所間異動のウィザード（個人型）。料率・届出・新しい料率の月を判定して見せ、台帳の所属事業所を変える。
 * 別の適用事業所への異動なら、資格喪失届（旧）と資格取得届（新）を作り、届出の画面で承認・提出する
 */
@Component({
  selector: 'app-transfer-wizard',
  standalone: true,
  imports: [MatDatepickerModule, DatePipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatCheckboxModule,
    WizardComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent],
  templateUrl: './transfer-wizard.html',
  styleUrls: ['../onboarding/onboarding-wizard.scss'],
})
export class TransferWizardComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  procedureId = '';
  view = signal<TransferView | null>(null);
  offices = signal<{ id: string; name: string }[]>([]);
  loading = signal(true);
  loadError = signal('');
  busy = signal(false);
  index = signal(0);
  toOfficeId = '';
  transferDate = '';
  reason = '';
  /** 異動日の前の月の保険料が元の事業所にない人（保険料の対象でない など）を、そのまま完了にする */
  skipPremiumCheck = false;
  dirty = signal(false);
  facts = signal<Facts | null>(null);
  factsError = signal('');

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
    const filing = v.facts?.filingRequired ?? true;
    return [
      { key: 'entry', label: '異動の内容', done: done || cur > 0,
        what: '異動先の事業所と異動日を入れます。保険料率・届出・新しい料率を使う月をシステムが判定します。',
        why: '都道府県が変わると健康保険の料率が変わり、別の適用事業所なら届出が要るためです。', next: filing ? '資格喪失届と資格取得届を作ります。' : '異動を登録します。' },
      { key: 'apply', label: filing ? '届出の作成' : '異動の登録', done: done || cur > 1,
        what: filing
          ? '資格喪失届（元の事業所）と資格取得届（異動先。整理番号は異動先の番号）を作って承認を依頼します。台帳の所属はまだ変えません。'
          : '異動を登録します。台帳の所属はまだ変えません。',
        why: '届出は異動日から5日以内に出すので先に作り、所属は異動日の前の月の保険料を元の事業所で計算してから変えるためです。', next: filing ? '2件の届出を承認・提出します。' : '完了の確認で所属を変えます。' },
      { key: 'filings', label: filing ? '届出の提出' : '届出（不要）', done: done || cur > 2,
        what: '届出の画面で、2件の届出の承認と提出（模擬電子申請または紙）を行います。',
        why: '異動日から5日以内に届け出る決まりがあるためです。', next: '2件とも提出すると完了を確認できます。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '異動日を過ぎ、異動日の前の月の保険料を元の事業所で計算し終えたら、台帳の所属を異動先に変えて完了にします。',
        why: '毎月の処理で、異動した月から異動先の事業所に出るためです（前の月までは元の事業所で計算します）。', next: 'これで手続きは完了です。' },
    ];
  });

  /** 台帳の所属がもう異動先になっている（完了したとき。以前の作りでは届出を作ったときに変えていた） */
  moved = computed(() => { const v = this.view(); return !!v?.to && v.employee.currentOfficeId === v.to.id; });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'entry' && (this.dirty() || this.index() === this.currentIndex())) return '保存して所属の変更へ';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'apply': return this.view()!.facts?.filingRequired ? '届出を作って承認を依頼する' : '異動を登録する';
      case 'confirm': return this.moved() ? '手続きを完了する' : '所属を変えて完了する';
      default: return undefined;
    }
  }

  hideNext() {
    const k = this.key();
    if (this.isDone() && this.index() === KEYS.length - 1) return true;
    if (k === 'entry' && this.dirty()) return false;
    if (this.index() < this.currentIndex()) return false;
    return k === 'filings';
  }

  nextDisabled() {
    if (this.key() === 'entry' && (this.dirty() || this.index() === this.currentIndex())) {
      return !this.toOfficeId || !this.transferDate || !!this.factsError() || !!this.view()?.applied;
    }
    return false;
  }

  /** 入力の自動下書き保存（「異動の内容」のステップ。入力を変えてから確定するまで。閉じても次に開くと戻る） */
  autosave = createDraftAutosave({
    procedureId: () => this.procedureId,
    baseline: false,
    step: () => 'entry',
    read: () => this.key() === 'entry' && this.dirty() && !this.busy() ? { toOfficeId: this.toOfficeId, transferDate: this.transferDate, reason: this.reason } : null,
  });

  /** 前回の下書きを戻す（「異動の内容」がまだ確定していないときだけ） */
  private async restoreDraft() {
    const d = (await this.autosave.load())['entry'];
    if (!d || this.view()?.current !== 'entry') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = d.data as any;
    this.toOfficeId = x.toOfficeId ?? ''; this.transferDate = x.transferDate ?? ''; this.reason = x.reason ?? '';
    this.dirty.set(true);
    this.autosave.restored('entry', { toOfficeId: this.toOfficeId, transferDate: this.transferDate, reason: this.reason }, d.savedAt);
    void this.changed();
  }

  async ngOnInit() {
    void this.loadOffices();
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (id === 'new') {
      try {
        const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'transferStart')({
          companyId: this.auth.companyId, employeeId: this.route.snapshot.queryParamMap.get('employeeId') ?? '',
        });
        this.procedureId = data.procedureId;
        await this.router.navigate(['/transfers', data.procedureId], { replaceUrl: true });
      } catch (e) {
        this.loading.set(false);
        this.loadError.set(errorMessage(e, '手続きを始められませんでした'));
        return;
      }
    } else {
      this.procedureId = id;
    }
    await this.load(true);
    await this.restoreDraft();
  }

  private async loadOffices() {
    try {
      const { data } = await httpsCallable<object, { items: { id: string; name: string }[] }>(this.functions, 'officeList')({ companyId: this.auth.companyId });
      this.offices.set(data.items);
    } catch {
      // 事業所が読めなければ選択肢が空になる
    }
  }

  async load(moveToCurrent: boolean) {
    this.loading.set(this.view() === null);
    this.loadError.set('');
    try {
      const { data } = await httpsCallable<object, TransferView>(this.functions, 'transferGet')({ companyId: this.auth.companyId, procedureId: this.procedureId });
      this.view.set(data);
      if (!this.dirty()) {
        this.toOfficeId = data.to?.id ?? '';
        this.transferDate = data.transferDate ?? '';
        this.reason = data.reason ?? '';
        this.facts.set(data.facts);
      }
      if (moveToCurrent) this.index.set(this.currentIndex());
    } catch (e) {
      this.loadError.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  async changed() {
    this.dirty.set(true);
    if (!this.toOfficeId || !this.transferDate) return;
    try {
      const { data } = await httpsCallable<object, Facts>(this.functions, 'transferPreview')({
        companyId: this.auth.companyId, procedureId: this.procedureId, toOfficeId: this.toOfficeId, transferDate: this.transferDate,
      });
      this.facts.set(data);
      this.factsError.set('');
    } catch (e) {
      this.facts.set(null);
      this.factsError.set(errorMessage(e, '判定できませんでした'));
    }
  }

  async advance() {
    const k = this.key();
    if (k === 'entry' && (this.dirty() || this.index() === this.currentIndex())) {
      return this.run('entry', { toOfficeId: this.toOfficeId, transferDate: this.transferDate, reason: this.reason }, '保存しました', () => this.dirty.set(false));
    }
    if (this.index() < this.currentIndex()) {
      this.index.set(this.index() + 1);
      return;
    }
    if (k === 'apply') return this.run('apply', {}, this.view()!.facts?.filingRequired ? '届出を作って承認を依頼しました' : '異動を登録しました');
    if (k === 'confirm') return this.run('complete', { skipPremiumCheck: this.skipPremiumCheck }, this.moved() ? '手続きを完了にしました' : '台帳の所属を変えて、手続きを完了にしました');
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'transferUpdate')({ companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload });
      after?.();
      if (step === 'entry') void this.autosave.clear('entry');
      this.snackBar.open(done, '閉じる', { duration: 5000 });
      await this.load(true);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  filingStatus(f: FilingState) {
    if (f.done) return '提出済み';
    if (f.workflowStatus === 'approved') return '承認済み（提出前）';
    return '承認待ち';
  }
}
