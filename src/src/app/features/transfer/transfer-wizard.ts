import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, WizardComponent, WizardStep } from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';

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
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule,
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
        why: '都道府県が変わると健康保険の料率が変わり、別の適用事業所なら届出が要るためです。', next: '台帳の所属事業所を変えます。' },
      { key: 'apply', label: '所属の変更', done: done || cur > 1,
        what: '台帳の所属事業所を異動先に変え、異動の履歴を残します。届出が要る場合は、資格喪失届と資格取得届を作って承認を依頼します。',
        why: 'その月の保険料から異動先の事業所で計算するためです。', next: filing ? '2件の届出を承認・提出します。' : '完了を確認します。' },
      { key: 'filings', label: filing ? '届出の提出' : '届出（不要）', done: done || cur > 2,
        what: '届出の画面で、2件の届出の承認と提出（模擬電子申請または紙）を行います。',
        why: '異動日から5日以内に届け出る決まりがあるためです。', next: '2件とも提出すると完了を確認できます。' },
      { key: 'confirm', label: '完了の確認', done,
        what: '異動の内容と、異動先の事業所で計算を始める月を確かめて、手続きを完了にします。',
        why: '毎月の処理で、異動した月から異動先の事業所に出るためです。', next: 'これで手続きは完了です。' },
    ];
  });

  nextLabel(): string | undefined {
    const k = this.key();
    if (!this.view() || this.isDone()) return undefined;
    if (k === 'entry' && (this.dirty() || this.index() === this.currentIndex())) return '保存する';
    if (this.index() < this.currentIndex()) return undefined;
    switch (k) {
      case 'apply': return this.view()!.facts?.filingRequired ? '台帳を変えて届出を作る' : '台帳を変える';
      case 'confirm': return '手続きを完了にする';
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
    if (k === 'apply') return this.run('apply', {}, '台帳の所属事業所を変えました');
    if (k === 'confirm') return this.run('complete', {}, '手続きを完了にしました');
  }

  private async run(step: string, payload: object, done: string, after?: () => void) {
    const v = this.view();
    if (!v) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'transferUpdate')({ companyId: this.auth.companyId, procedureId: this.procedureId, expectedVersion: v.procedure.version, step, ...payload });
      after?.();
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
