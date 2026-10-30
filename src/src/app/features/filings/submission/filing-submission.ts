import { Component, DestroyRef, OnChanges, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { StatusBadgeComponent } from '../../../shared/ui';
import { errorMessage } from '../../onboarding/onboarding.types';

export interface FilingTarget {
  source: 'employee' | 'santei' | 'bonus';
  /** 従業員の届出なら従業員ID、算定基礎届・賞与支払届なら run のID（`{事業所ID}_{年 or 支給月}`） */
  parentId: string;
  filingId: string;
}

type MockStatus = 'sent' | 'received' | 'processing' | 'completed' | 'failed' | 'returned' | 'cancelled';
interface HistoryEntry { status: string; at: string; by: string; note: string | null }
interface MockState {
  status: MockStatus; scenario: string; acceptanceNumber: string | null; sentAt: string; sentDate: string; auto: boolean; nextAt: string | null;
  error: { code: string; message: string; details: string[] } | null; returnReason: string | null; history: HistoryEntry[];
}
interface PaperState {
  status: 'submitted' | 'accepted' | 'returned'; submittedDate: string; office: string; method: 'counter' | 'mail';
  resultDate: string | null; resultNote: string | null; history: HistoryEntry[];
}
export interface SubmissionView {
  source: FilingTarget['source']; filingType: string; version: number; approved: boolean; workflowLabel: string;
  mock: MockState | null; mockLabel: string | null; paper: PaperState | null; submitted: boolean;
  canSend: boolean; canCancel: boolean; canPaper: boolean; canReopen: boolean; isAdmin: boolean;
  settings: { auto: boolean; receiveSeconds: number; processSeconds: number; completeSeconds: number };
}

type Confirm = 'send' | 'cancel' | 'paper' | 'result' | 'reopen' | 'advance' | 'return' | null;

const STAGES: { key: MockStatus; label: string }[] = [
  { key: 'sent', label: '送信済み' }, { key: 'received', label: '受付済み' }, { key: 'processing', label: '処理中' }, { key: 'completed', label: '完了' },
];
const IN_TRANSIT: MockStatus[] = ['sent', 'received', 'processing'];
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

/**
 * 届出の提出（模擬電子申請・紙の提出）。ウィザード・届出の画面・算定基礎届・賞与で共通に使う。
 * 送信中は数秒ごとに読み直し、状態が変わったら changed を出す（呼び出し側は手続きを読み直す）
 */
@Component({
  selector: 'app-filing-submission',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatRadioModule, StatusBadgeComponent],
  template: `
    @if (error()) {
      <div class="alert" role="alert">{{ error() }} <button mat-button type="button" (click)="load()">読み込み直す</button></div>
    }
    @if (view(); as v) {
      @if (!v.approved) {
        <p class="sub">社内の承認が済むと提出できます（いまは「{{ v.workflowLabel }}」）。</p>
      } @else {
        @if (v.submitted) {
          <p class="done"><app-status-badge tone="done" label="提出済み" />
            @if (v.mock?.status === 'completed') { 模擬電子申請が完了しました{{ v.mock!.acceptanceNumber ? '（受付番号 ' + v.mock!.acceptanceNumber + '）' : '' }}。 }
            @if (v.paper?.status === 'accepted') { 紙の届出が受理されました{{ v.paper!.resultDate ? '（' + v.paper!.resultDate + '）' : '' }}。 }
            @else if (v.paper?.status === 'submitted') { 紙で提出しました（{{ v.paper!.submittedDate }}）。 }
          </p>
        }

        <!-- 模擬電子申請の経過 -->
        @if (v.mock; as m) {
          @if (m.status !== 'cancelled' && m.status !== 'failed') {
            <div class="mock">
              <div class="mock-head">
                <strong>模擬電子申請</strong>
                @if (m.acceptanceNumber) { <span>受付番号 <code>{{ m.acceptanceNumber }}</code></span> }
              </div>
              @if (m.status === 'returned') {
                <div class="alert" role="alert">返戻されました（模擬）。理由：{{ m.returnReason }}</div>
              } @else {
                <ol class="stages" aria-label="模擬電子申請の進み具合">
                  @for (s of stages; track s.key; let i = $index) {
                    <li [class.on]="stageIndex(m.status) >= i" [attr.aria-current]="m.status === s.key ? 'step' : null">
                      <mat-icon aria-hidden="true">{{ stageIndex(m.status) >= i ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                      <span>{{ s.label }}</span>
                      @if (timeOf(m, s.key); as t) { <small>{{ t | date:'M/d H:mm:ss' }}</small> }
                    </li>
                  }
                </ol>
                @if (inTransit(m)) {
                  <p class="sub" role="status">
                    @if (m.auto) { 自動で次の状態へ進みます（{{ m.nextAt | date:'H:mm:ss' }}ごろ）。この画面を開いたままにすると進み具合が見られます。 }
                    @else { 自動では進みません。管理者が「次の状態へ進める」で進めます。 }
                  </p>
                }
              }
              <div class="row-actions">
                @if (v.canCancel) {
                  <button mat-stroked-button type="button" (click)="ask('cancel')" [disabled]="busy()">送信を取り消す</button>
                }
                @if (v.isAdmin && inTransit(m)) {
                  <button mat-stroked-button type="button" (click)="ask('advance')" [disabled]="busy()">次の状態へ進める（管理者）</button>
                }
                @if (v.isAdmin && (m.status === 'received' || m.status === 'processing')) {
                  <button mat-button type="button" (click)="ask('return')" [disabled]="busy()">返戻にする（管理者・模擬）</button>
                }
              </div>
            </div>
          }
          @if (m.status === 'failed' && m.error) {
            <div class="alert" role="alert"><strong>送信エラー（模擬）</strong><br>{{ m.error.message }}
              @if (m.error.code === 'validationError' && m.error.details.length) { <br>届出の内容を直してから、もう一度送信してください。 }
              @else { <br>下の「送信する」で、もう一度送信できます。 }
            </div>
          }
        }

        @if (v.paper?.status === 'returned') {
          <div class="alert" role="alert">紙の届出が返戻されました（{{ v.paper!.resultDate }}）。理由：{{ v.paper!.resultNote }}</div>
        }
        @if (v.canReopen) {
          <p class="sub">返戻された届出は、下書きに戻して内容を直し、承認からやり直します。</p>
          <button mat-flat-button type="button" (click)="ask('reopen')" [disabled]="busy()">下書きに戻して直す</button>
        }

        <!-- 提出する -->
        @if (!v.submitted && (v.canSend || v.canPaper)) {
          <mat-radio-group [(ngModel)]="method" class="radios" aria-label="提出方法">
            <mat-radio-button value="electronic" [disabled]="!v.canSend">電子申請（模擬）で提出する</mat-radio-button>
            <mat-radio-button value="paper" [disabled]="!v.canPaper">紙で提出する</mat-radio-button>
          </mat-radio-group>
          @if (method === 'electronic' && v.canSend) {
            <p class="sub">このシステムの電子申請は模擬です。実際の提出は、e-Govや紙で別に行ってください。</p>
            <div class="fields">
              <mat-form-field appearance="outline" class="wide">
                <mat-label>申請の種類</mat-label>
                <mat-select [(ngModel)]="scenario" name="scenario">
                  <mat-option value="normal">通常申請</mat-option>
                  <mat-option value="timeout">エラーシミュレーション：ネットワークタイムアウト</mat-option>
                  <mat-option value="serverError">エラーシミュレーション：サーバーエラー（500系）</mat-option>
                  <mat-option value="validationError">エラーシミュレーション：データ形式エラー</mat-option>
                  <mat-option value="outOfHours">エラーシミュレーション：受付時間外</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <button mat-flat-button type="button" (click)="ask('send')" [disabled]="busy()">{{ v.mock?.status === 'failed' ? 'もう一度送信する' : '送信する' }}</button>
          } @else if (method === 'paper' && v.canPaper) {
            <p class="sub">PDFを印刷し、年金事務所へ郵送か窓口で提出してから記録します。</p>
            <div class="fields">
              <mat-form-field appearance="outline"><mat-label>提出した日</mat-label><input matInput type="date" [(ngModel)]="paperDate" name="paperDate"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>提出先（年金事務所名など）</mat-label><input matInput [(ngModel)]="paperOffice" name="paperOffice"></mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>提出方法</mat-label>
                <mat-select [(ngModel)]="paperMethod" name="paperMethod">
                  <mat-option value="counter">窓口に持参</mat-option>
                  <mat-option value="mail">郵送</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <button mat-flat-button type="button" (click)="ask('paper')" [disabled]="busy() || !paperDate || !paperOffice.trim()">提出したことを記録する</button>
          }
        } @else if (v.mock?.status === 'completed' && v.canPaper) {
          <details class="more">
            <summary>実際に紙でも提出した記録を残す</summary>
            <div class="fields">
              <mat-form-field appearance="outline"><mat-label>提出した日</mat-label><input matInput type="date" [(ngModel)]="paperDate" name="paperDate2"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>提出先（年金事務所名など）</mat-label><input matInput [(ngModel)]="paperOffice" name="paperOffice2"></mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>提出方法</mat-label>
                <mat-select [(ngModel)]="paperMethod" name="paperMethod2">
                  <mat-option value="counter">窓口に持参</mat-option>
                  <mat-option value="mail">郵送</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <button mat-stroked-button type="button" (click)="ask('paper')" [disabled]="busy() || !paperDate || !paperOffice.trim()">提出したことを記録する</button>
          </details>
        }

        <!-- 紙の提出の結果 -->
        @if (v.paper?.status === 'submitted') {
          <div class="paper">
            <p>紙で提出済みです（{{ v.paper!.submittedDate }}・{{ v.paper!.office || '提出先の記録なし' }}・{{ v.paper!.method === 'mail' ? '郵送' : '窓口' }}）。
              年金事務所から決定通知が届いたら記録してください。</p>
            <mat-radio-group [(ngModel)]="result" class="radios" aria-label="結果">
              <mat-radio-button value="accepted">受理された（決定通知を受け取った）</mat-radio-button>
              <mat-radio-button value="returned">返戻された</mat-radio-button>
            </mat-radio-group>
            <div class="fields">
              <mat-form-field appearance="outline"><mat-label>受け取った日</mat-label><input matInput type="date" [(ngModel)]="resultDate" name="resultDate"></mat-form-field>
              <mat-form-field appearance="outline" class="wide">
                <mat-label>{{ result === 'returned' ? '返戻の理由' : '決定通知の内容（任意）' }}</mat-label>
                <input matInput [(ngModel)]="resultNote" name="resultNote">
              </mat-form-field>
            </div>
            <button mat-flat-button type="button" (click)="ask('result')" [disabled]="busy() || !resultDate || (result === 'returned' && !resultNote.trim())">結果を記録する</button>
          </div>
        }

        <!-- 画面内の確認 -->
        @if (confirm(); as c) {
          <div class="confirm" role="alertdialog" aria-label="確認">
            <p>{{ confirmText(c) }}</p>
            @if (c === 'return') {
              <mat-form-field appearance="outline" class="wide"><mat-label>返戻の理由</mat-label><input matInput [(ngModel)]="returnReason" name="returnReason"></mat-form-field>
            }
            <div class="row-actions">
              <button mat-flat-button type="button" (click)="run(c)" [disabled]="busy() || (c === 'return' && !returnReason.trim())">{{ confirmLabel(c) }}</button>
              <button mat-button type="button" (click)="confirm.set(null)" [disabled]="busy()">やめる</button>
            </div>
          </div>
        }

        @if (history(v).length) {
          <details class="more">
            <summary>提出の経緯（{{ history(v).length }}件）</summary>
            <ul class="history">
              @for (h of history(v); track $index) {
                <li><span class="when">{{ h.at | date:'M/d H:mm:ss' }}</span>{{ h.label }}@if (h.note) { ：{{ h.note }} }</li>
              }
            </ul>
          </details>
        }
      }
    } @else if (!error()) {
      <p class="sub" role="status">提出の状況を読み込んでいます…</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .sub { color: var(--app-color-text-sub); font-size: 14px; }
    .done { display: flex; flex-wrap: wrap; align-items: center; gap: var(--app-space-2); }
    .alert { margin: var(--app-space-2) 0 var(--app-space-3); padding: var(--app-space-3) var(--app-space-4); border-radius: 8px;
      background: var(--app-status-action-bg); line-height: 1.7; }
    .mock, .paper, .confirm { margin: var(--app-space-2) 0 var(--app-space-3); padding: var(--app-space-3) var(--app-space-4);
      border: 1px solid var(--app-color-border); border-radius: 8px; background: var(--app-color-surface); }
    .confirm { border-color: var(--app-color-link); background: var(--app-status-yours-bg); }
    .mock-head { display: flex; gap: var(--app-space-3); flex-wrap: wrap; align-items: baseline; }
    .stages { display: flex; flex-wrap: wrap; gap: var(--app-space-2) var(--app-space-4); list-style: none; padding: 0; margin: var(--app-space-3) 0; }
    .stages li { display: flex; align-items: center; gap: 4px; color: var(--app-color-text-sub); }
    .stages li.on { color: var(--app-status-done-fg); font-weight: 500; }
    .stages li[aria-current] { color: var(--app-status-yours-fg); }
    .stages mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .stages small { color: var(--app-color-text-sub); font-weight: 400; }
    .radios { display: flex; flex-wrap: wrap; gap: var(--app-space-2) var(--app-space-4); margin: var(--app-space-2) 0; }
    .fields { display: flex; flex-wrap: wrap; gap: 0 var(--app-space-3); margin-top: var(--app-space-2); }
    .fields mat-form-field { width: 220px; }
    .fields mat-form-field.wide, .confirm .wide { width: min(100%, 420px); }
    .row-actions { display: flex; flex-wrap: wrap; gap: var(--app-space-2); }
    .more { margin-top: var(--app-space-3); }
    .more summary { cursor: pointer; color: var(--app-color-link); }
    .history { margin: var(--app-space-2) 0 0; padding-left: var(--app-space-4); font-size: 13px; }
    .history .when { color: var(--app-color-text-sub); margin-right: var(--app-space-2); }
    code { font-size: 13px; }
    @media (max-width: 600px) { .fields mat-form-field { width: 100%; } }
  `],
})
export class FilingSubmissionComponent implements OnChanges {
  private functions = inject(Functions);
  private auth = inject(AuthService);

  target = input.required<FilingTarget>();
  /** 提出の状態が変わった（手続きや一覧を読み直す合図） */
  changed = output<SubmissionView>();

  view = signal<SubmissionView | null>(null);
  error = signal('');
  busy = signal(false);
  confirm = signal<Confirm>(null);

  stages = STAGES;
  method: 'electronic' | 'paper' = 'electronic';
  scenario = 'normal';
  paperDate = today();
  paperOffice = '';
  paperMethod: 'counter' | 'mail' = 'counter';
  result: 'accepted' | 'returned' = 'accepted';
  resultDate = today();
  resultNote = '';
  returnReason = '';

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  ngOnChanges() {
    this.view.set(null);
    this.lastKey = '';
    void this.load();
  }

  inTransit = (m: MockState | null | undefined) => !!m && IN_TRANSIT.includes(m.status);
  stageIndex = (s: MockStatus) => STAGES.findIndex(x => x.key === s);
  timeOf(m: MockState, key: MockStatus) {
    const hits = m.history.filter(h => h.status === key);
    return hits.length ? hits[hits.length - 1].at : null;
  }

  history(v: SubmissionView) {
    const labels: Record<string, string> = {
      sent: '模擬電子申請：送信', received: '模擬電子申請：受付', processing: '模擬電子申請：処理中', completed: '模擬電子申請：完了',
      failed: '模擬電子申請：送信エラー', returned: '模擬電子申請：返戻', cancelled: '模擬電子申請：送信を取り消した', reopened: '下書きに戻した',
    };
    const paper: Record<string, string> = { submitted: '紙で提出', accepted: '紙の届出が受理', returned: '紙の届出が返戻' };
    return [
      ...(v.mock?.history ?? []).map(h => ({ ...h, label: labels[h.status] ?? h.status })),
      ...(v.paper?.history ?? []).map(h => ({ ...h, label: paper[h.status] ?? h.status })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }

  confirmText(c: Exclude<Confirm, null>): string {
    switch (c) {
      case 'send': return this.scenario === 'normal'
        ? 'この届出を模擬電子申請で送信します。受付前（送信済みのあいだ）なら取り消せます。送信しますか？'
        : '練習用のエラーシミュレーションで送信します。届出は送信エラーになり、あとで送り直せます。送信しますか？';
      case 'cancel': return '送信を取り消します。届出は承認済み（提出前）に戻ります。取り消しますか？';
      case 'paper': return `${this.paperDate}に${this.paperOffice}へ${this.paperMethod === 'mail' ? '郵送' : '窓口で'}提出したことを記録します。よろしいですか？`;
      case 'result': return this.result === 'accepted' ? '届出が受理されたことを記録します。よろしいですか？' : '届出が返戻されたことを記録します。よろしいですか？';
      case 'reopen': return '届出を下書きに戻します。内容を直したら、もう一度承認を受けてから提出します。戻しますか？';
      case 'advance': return '模擬電子申請を次の状態へ進めます。手動で進めると、以後は自動では進みません。進めますか？';
      case 'return': return '模擬電子申請を返戻にします（練習用）。理由を入れてください。';
    }
  }

  confirmLabel(c: Exclude<Confirm, null>): string {
    return { send: '送信する', cancel: '取り消す', paper: '記録する', result: '記録する', reopen: '下書きに戻す', advance: '進める', return: '返戻にする' }[c];
  }

  ask(c: Confirm) {
    this.returnReason = '';
    this.confirm.set(c);
  }

  async load() {
    this.stopPolling();
    try {
      const { data } = await httpsCallable<object, SubmissionView>(this.functions, 'filingSubmissionGet')({ companyId: this.auth.companyId, ...this.target() });
      this.apply(data);
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e, '提出の状況を読み込めませんでした'));
    }
  }

  async run(c: Exclude<Confirm, null>) {
    const v = this.view();
    if (!v) return;
    const actions: Record<typeof c, Record<string, unknown>> = {
      send: { action: 'mockSend', scenario: this.scenario },
      cancel: { action: 'mockCancel' },
      advance: { action: 'mockAdvance' },
      return: { action: 'mockReturn', note: this.returnReason },
      paper: { action: 'paperSubmit', date: this.paperDate, office: this.paperOffice, method: this.paperMethod },
      result: { action: 'paperResult', result: this.result, date: this.resultDate, ...(this.resultNote.trim() ? { note: this.resultNote.trim() } : {}) },
      reopen: { action: 'reopen' },
    };
    this.busy.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, SubmissionView>(this.functions, 'filingSubmissionAction')({
        companyId: this.auth.companyId, ...this.target(), expectedVersion: v.version, ...actions[c],
      });
      this.confirm.set(null);
      this.scenario = 'normal';
      this.apply(data, true);
    } catch (e) {
      this.error.set(errorMessage(e, '操作できませんでした'));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(v: SubmissionView, force = false) {
    this.view.set(v);
    if (!v.canSend && v.canPaper) this.method = 'paper';
    if (v.canSend && !v.canPaper) this.method = 'electronic';
    const key = `${v.version}:${v.mock?.status}:${v.paper?.status}:${v.submitted}`;
    if (force || (this.lastKey && key !== this.lastKey)) this.changed.emit(v);
    this.lastKey = key;
    if (this.inTransit(v.mock) && v.mock!.auto) this.timer = setTimeout(() => void this.load(), 3000);
  }

  private stopPolling() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
