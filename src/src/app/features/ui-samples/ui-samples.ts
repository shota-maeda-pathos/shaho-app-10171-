import { Component, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import {
  BulkAction, BulkRun, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent,
  TargetCellDirective, TargetListComponent, TargetRow, TermComponent, WizardComponent, WizardStep,
} from '../../shared/ui';

const ONBOARD_STEPS: WizardStep[] = [
  { key: 'invite', label: '本人に入力を依頼する', what: '入社する人にメールで入力フォームを送ります。', why: '住所・家族・年金の番号は本人がいちばん正確に分かるためです。', next: '本人が入力を終えると、ホームの「やること」に表示されます。' },
  { key: 'review', label: '本人の入力を確かめる', what: '本人が入力した内容に漏れや誤りがないか確かめます。', why: '届出の内容が誤っていると、年金事務所から差し戻されるためです。', next: '確かめた内容が従業員台帳に登録されます。' },
  { key: 'contract', label: '雇用条件を入れる', what: '雇用区分・労働時間・給与を入れます。', why: '社会保険に加入させる必要があるかを、この内容から判定するためです。', next: 'システムが加入の判定と最初の等級を計算します。' },
  { key: 'decide', label: '加入の判定と等級を確かめる', what: 'システムが計算した加入の判定と標準報酬月額を確かめます。', why: '保険料はこの等級から計算するためです。', next: '承認者に確認を依頼します。' },
  { key: 'approve', label: '承認者が確認する', what: '別の担当者が内容を確認します。', why: '1人で作った届出の誤りを防ぐためです。', next: '承認されると、資格取得届を作れるようになります。', waitingFor: '承認者' },
  { key: 'filing', label: '資格取得届を作る', what: '登録した内容から資格取得届を作ります。', why: '入社日から5日以内に提出する決まりがあるためです。', next: '提出方法を選びます。' },
  { key: 'submit', label: '提出する', what: '電子申請か紙で提出し、提出した日を記録します。', why: '期限内に提出したことを残しておくためです。', next: 'これで入社の手続きは完了です。' },
];

const STATUSES: { tone: TargetRow['tone']; statusLabel: string; reason?: string }[] = [
  { tone: 'done', statusLabel: '計算済み' },
  { tone: 'yours', statusLabel: '保険料 未計算' },
  { tone: 'action', statusLabel: '給与 未登録', reason: '10月分の給与が登録されていません' },
  { tone: 'waiting', statusLabel: '給与 承認待ち' },
];

/** 見本用の従業員（数百名規模の一覧を確かめるため） */
function sampleRows(count: number): (TargetRow & { salary: number })[] {
  const family = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤'];
  const given = ['太郎', '花子', '一郎', '美咲', '健', '陽菜', '翔', '結衣', '大輔', '直美'];
  return Array.from({ length: count }, (_, i) => {
    // 要対応は1割弱、承認待ちは少数、残りは未計算にして実務の割合に近づける
    const s = i % 13 === 5 ? STATUSES[2] : i % 29 === 7 ? STATUSES[3] : STATUSES[1];
    return {
      id: `e${i + 1}`, name: `${family[i % 10]} ${given[(i * 7) % 10]}`, sub: `社員番号 ${String(1001 + i)}`,
      ...s, salary: 200000 + ((i * 3779) % 40) * 10000,
    };
  });
}

/**
 * 共通UI部品の見本。部品だけで「個人型」「一括型」の画面が組めることを確かめるための画面で、
 * サーバーには接続しない（データはすべて画面内の見本）。
 */
@Component({
  selector: 'app-ui-samples',
  standalone: true,
  imports: [
    DecimalPipe, RouterLink, MatTabsModule, WizardComponent, TargetListComponent, TargetCellDirective,
    StatusBadgeComponent, TermComponent, LoadingStateComponent, EmptyStateComponent, ErrorStateComponent,
  ],
  template: `
    <div class="app-page">
      <h1 class="app-page-title">画面部品の見本</h1>
      <p class="app-page-guide">手続きの画面で使う共通の部品です。表示しているデータはすべて見本で、保存はされません。</p>

      <mat-tab-group>
        <mat-tab label="個人型（ウィザード）">
          <div class="tab-body">
            <app-wizard heading="入社の手続き" subtitle="見本 太郎・入社日 11月1日・資格取得届の提出期限 11月5日"
                        [steps]="steps" [(current)]="current" [busy]="saving()" (advance)="advance()">
              <p>ここに、ステップごとの入力フォームを置きます。</p>
              @if (current() === 3) {
                <p><app-term key="standardRemuneration" />：健康保険 22等級（300,000円）／厚生年金 19等級</p>
                <p><app-term key="applicability" />：加入する（週40時間・正社員）</p>
              }
              @if (current() === 4) {
                <p>見本のため、「承認された」ことにして次へ進めます：
                  <button type="button" class="text-button" (click)="current.set(5)">承認されたことにする</button></p>
              }
            </app-wizard>
          </div>
        </mat-tab>

        <mat-tab label="一括型（対象者一覧）">
          <div class="tab-body">
            <h2 class="section-title">10月分の保険料を計算する</h2>
            <p class="app-page-guide">
              承認済みの給与から、全員分の保険料をまとめて計算します。要対応の人だけを表示しています。
              1人だけ止めたいときは保留にしてください（見本では計算した人のうち数名が失敗します）。
            </p>
            <app-target-list [rows]="rows()" [actions]="actions" [busy]="running()" [hasMore]="rows().length < allRows.length"
                             cellHeader="報酬月額" (run)="run($event)" (retryFailed)="run({ action: 'calculate', ids: $event })"
                             (hold)="setHold($event.id, $event.reason)" (release)="setHold($event, undefined)"
                             (loadMore)="loadMore()" (open)="opened.set($event.name)">
              <ng-template appTargetCell let-row>{{ salaryOf(row) | number }}円</ng-template>
            </app-target-list>
            @if (opened()) { <p class="note">「{{ opened() }}」の詳細を開きます（見本のため画面は移動しません）。</p> }
          </div>
        </mat-tab>

        <mat-tab label="状態色・用語・共通表示">
          <div class="tab-body">
            <h2 class="section-title">状態色（4種）</h2>
            <div class="row">
              <app-status-badge tone="action" /><app-status-badge tone="yours" />
              <app-status-badge tone="waiting" /><app-status-badge tone="done" />
            </div>
            <p class="note">表示する文字は変えられます：
              <app-status-badge tone="action" label="期限切れ" /> <app-status-badge tone="waiting" label="承認待ち" /></p>

            <h2 class="section-title">用語の説明</h2>
            <p>用語の横の「?」を押すと説明が出ます：<app-term key="santei" />、<app-term key="paymentBasisDays" />、<app-term key="rounding" />。
              すべての言葉は<a routerLink="/glossary">用語集</a>で読めます。</p>

            <h2 class="section-title">読み込み中・データなし・エラー</h2>
            <div class="states">
              <div class="state-box"><app-loading-state /></div>
              <div class="state-box"><app-empty-state message="今月の手続きはありません" hint="入社・退職などがあれば、「手続きを始める」から始めます。" /></div>
              <div class="state-box"><app-error-state message="通信が切れた可能性があります。" (retry)="retried.set(retried() + 1)" /></div>
            </div>
            @if (retried()) { <p class="note">「もう一度試す」が {{ retried() }} 回押されました。</p> }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .tab-body { padding: var(--app-space-5) 0; }
    .section-title { margin: var(--app-space-5) 0 var(--app-space-2); font-size: var(--app-font-xl); font-weight: 500; }
    .tab-body > .section-title:first-child { margin-top: 0; }
    .row { display: flex; gap: var(--app-space-2); flex-wrap: wrap; }
    .note { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .states { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--app-space-3); }
    .state-box { border: 1px dashed var(--app-color-border); border-radius: var(--app-radius); }
    .text-button { padding: 0; border: 0; background: none; font: inherit; color: var(--app-color-link); cursor: pointer; text-decoration: underline; }
  `],
})
export class UiSamplesComponent {
  readonly steps = ONBOARD_STEPS;
  current = signal(0);
  saving = signal(false);

  readonly allRows = sampleRows(520);
  private loaded = 100;
  rows = signal<TargetRow[]>(this.allRows.slice(0, this.loaded));
  running = signal(false);
  opened = signal('');
  retried = signal(0);
  readonly actions: BulkAction[] = [
    { key: 'calculate', label: '保険料を計算する', appliesTo: r => r.statusLabel === '保険料 未計算' || !!r.error },
    { key: 'request', label: '確認を依頼する', appliesTo: r => r.statusLabel === '計算済み' },
  ];

  async advance() {
    this.saving.set(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    this.saving.set(false);
    if (this.current() < this.steps.length - 1) this.current.set(this.current() + 1);
  }

  salaryOf(row: TargetRow) {
    return (row as TargetRow & { salary: number }).salary;
  }

  loadMore() {
    this.loaded = Math.min(this.loaded + 100, this.allRows.length);
    const current = new Map(this.rows().map(r => [r.id, r]));
    this.rows.set(this.allRows.slice(0, this.loaded).map(r => current.get(r.id) ?? r));
  }

  /** 見本の一括実行。計算は社員番号が7の倍数の人を一度だけ失敗させ、再実行で成功させる */
  async run(req: BulkRun) {
    this.running.set(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    const ids = new Set(req.ids);
    this.rows.update(rows => rows.map(r => {
      if (!ids.has(r.id)) return r;
      if (req.action === 'request') return { ...r, tone: 'waiting', statusLabel: '保険料 承認待ち', error: undefined };
      const failOnce = Number(r.id.slice(1)) % 7 === 0 && !r.error;
      return failOnce
        ? { ...r, error: '料率マスタの読み込みがタイムアウトしました' }
        : { ...r, tone: 'done', statusLabel: '計算済み', reason: undefined, error: undefined };
    }));
    this.running.set(false);
  }

  setHold(id: string, reason: string | undefined) {
    this.rows.update(rows => rows.map(r => r.id === id ? { ...r, held: reason ? { reason } : undefined } : r));
  }
}
