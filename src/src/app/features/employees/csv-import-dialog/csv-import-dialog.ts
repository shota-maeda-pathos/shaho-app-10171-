import { Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface CsvChange { label: string; from: string; to: string }
interface PlanRow { line: number; employeeNumber: string; name: string; officeName: string; changes: CsvChange[] }
interface CsvError { line: number; employeeNumber: string; message: string }
interface ImportResult {
  dryRun: boolean;
  creates: PlanRow[];
  updates: PlanRow[];
  unchanged: { line: number; employeeNumber: string; name: string }[];
  errors: CsvError[];
  created: number;
  updated: number;
}

/**
 * テンプレートの列。サーバーの `employees/employee-csv-import/rules.ts` の EMPLOYEE_CSV_COLUMNS と同じ順（* は新規で必須）。
 * 従業員一覧の「CSV出力」も同じ列なので、出力して直したものをそのまま取り込める
 */
const TEMPLATE = [
  '社員番号*,姓*,名*,姓カナ*,名カナ*,生年月日*,性別*,事業所*,部署,入社日*,旧姓,郵便番号,都道府県,市区町村,番地,建物名,電話番号,メールアドレス,被保険者整理番号,基礎年金番号,個人番号',
  '1001,山田,太郎,ヤマダ,タロウ,1990-04-01,男,本社,,2026-04-01,,100-0001,東京都,千代田区,千代田1-1,,03-1234-5678,yamada@example.com,,,',
].join('\r\n');

type Step = 'upload' | 'checking' | 'preview' | 'importing' | 'done';

/** 従業員の一括登録・更新（カタログ2章 CSV一括取込）。サーバーで確かめて差分を見せ、確認してから取り込む */
@Component({
  selector: 'app-csv-import-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>従業員のCSV取込</h2>
    <mat-dialog-content>
      @switch (step()) {
        @case ('upload') {
          <div class="upload-area" (dragover)="$event.preventDefault()" (drop)="onDrop($event)" (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon>
            <p>CSVファイルをドラッグ＆ドロップ<br>またはクリックして選択</p>
            <p class="hint">文字コード：UTF-8／Shift_JIS（Excel で保存したもの）</p>
            <input #fileInput type="file" accept=".csv,text/csv" hidden (change)="onFileSelect($event)">
          </div>
          <ul class="rules">
            <li>社員番号が台帳にある人は<strong>更新</strong>、ない人は<strong>新規登録</strong>になります。更新では、空欄の項目は変えません。</li>
            <li>事業所・部署は、設定に登録した名前で書きます（事業所は整理記号でも可）。事業所を変える（異動）・退職は、それぞれの手続きで行います。</li>
            <li>重複（社員番号・個人番号・氏名＋生年月日）や形の誤りがある行は取り込みません。取り込む前に、変わる項目と誤りの一覧を確かめられます。</li>
            <li>個人番号の列は空欄でも構いません。入れた番号は暗号化して保存し、CSV ファイルはシステムに残しません。</li>
            <li>雇用条件・給与は取込の対象外です（入社の手続き・雇用条件の変更・毎月の処理で登録します）。</li>
          </ul>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <div class="template-link">
            <button mat-stroked-button (click)="downloadTemplate()"><mat-icon>download</mat-icon> テンプレートCSVをダウンロード</button>
          </div>
        }
        @case ('checking') {
          <div class="progress"><p>{{ fileName() }} を確かめています…</p><mat-progress-bar mode="indeterminate" /></div>
        }
        @case ('preview') {
          @if (plan(); as p) {
            <p class="file">{{ fileName() }}</p>
            <div class="counts">
              <span class="count create">新規 {{ p.creates.length }}人</span>
              <span class="count update">更新 {{ p.updates.length }}人</span>
              <span class="count">変わらない {{ p.unchanged.length }}人</span>
              <span class="count" [class.bad]="p.errors.length > 0">取り込まない行 {{ errorLines(p) }}行</span>
            </div>
            @if (p.errors.length) {
              <section class="block">
                <h3 class="bad">取り込まない行（直して取り込み直してください）</h3>
                <div class="list">
                  @for (e of p.errors; track $index) {
                    <div class="item bad">{{ e.line }}行目{{ e.employeeNumber ? '（社員番号 ' + e.employeeNumber + '）' : '' }}：{{ e.message }}</div>
                  }
                </div>
              </section>
            }
            @if (p.creates.length) {
              <section class="block">
                <h3>新しく登録する人</h3>
                <div class="list">
                  @for (r of p.creates; track r.line) {
                    <div class="item">{{ r.employeeNumber }} {{ r.name }}（{{ r.officeName }}）</div>
                  }
                </div>
              </section>
            }
            @if (p.updates.length) {
              <section class="block">
                <h3>更新する人と変わる項目</h3>
                <div class="list">
                  @for (r of p.updates; track r.line) {
                    <div class="item">
                      <strong>{{ r.employeeNumber }} {{ r.name }}</strong>
                      @for (c of r.changes; track c.label) {
                        <div class="change">{{ c.label }}：{{ c.from }} → <strong>{{ c.to }}</strong></div>
                      }
                    </div>
                  }
                </div>
              </section>
            }
          }
        }
        @case ('importing') {
          <div class="progress"><p>{{ total() }}人分を取り込んでいます…（画面を閉じないでください）</p><mat-progress-bar mode="indeterminate" /></div>
        }
        @case ('done') {
          @if (plan(); as p) {
            <div class="counts done">
              <span class="count create"><mat-icon>check_circle</mat-icon> 新規 {{ p.created }}人</span>
              <span class="count update"><mat-icon>check_circle</mat-icon> 更新 {{ p.updated }}人</span>
            </div>
            @if (p.errors.length) {
              <section class="block">
                <h3 class="bad">取り込まなかった行</h3>
                <div class="list">
                  @for (e of p.errors; track $index) {
                    <div class="item bad">{{ e.line }}行目{{ e.employeeNumber ? '（社員番号 ' + e.employeeNumber + '）' : '' }}：{{ e.message }}</div>
                  }
                </div>
              </section>
            }
            <p class="hint">CSV ファイルの中身はシステムに残していません。個人番号を含むファイルは、手元でも不要になったら消してください。</p>
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @switch (step()) {
        @case ('preview') {
          <button mat-button (click)="reset()">ファイルを選び直す</button>
          <button mat-flat-button color="primary" [disabled]="total() === 0" (click)="runImport()">
            {{ total() === 0 ? '取り込む人がいません' : total() + '人分を取り込む' }}
          </button>
        }
        @case ('done') {
          <button mat-flat-button color="primary" (click)="close()">閉じる</button>
        }
        @case ('upload') {
          <button mat-button mat-dialog-close>キャンセル</button>
        }
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .upload-area { border: 2px dashed var(--app-color-border, #ccc); border-radius: 12px; padding: 32px; text-align: center; cursor: pointer; }
    .upload-area:hover { border-color: var(--app-brand-strong); }
    .upload-area mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--app-brand-strong); }
    .upload-area p { margin: 8px 0; }
    .hint { font-size: 12px; color: var(--app-color-text-sub, #666); }
    .rules { font-size: 13px; line-height: 1.7; padding-left: 20px; margin: 16px 0 8px; }
    .template-link { text-align: center; margin-top: 12px; }
    .progress { text-align: center; padding: 24px; }
    .file { font-size: 13px; color: var(--app-color-text-sub, #666); margin: 0 0 8px; }
    .counts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 12px; font-weight: 500; }
    .counts.done { justify-content: center; padding: 16px; font-size: 16px; }
    .count { display: inline-flex; align-items: center; gap: 4px; }
    .count.create, .count.update { color: var(--app-status-done-fg, #2e7d32); }
    .bad { color: var(--app-status-action-fg, #c62828); }
    .block { margin-top: 12px; }
    .block h3 { font-size: 14px; margin: 0 0 6px; }
    .list { max-height: 200px; overflow: auto; border: 1px solid var(--app-color-border, #e0e0e0); border-radius: 8px; padding: 4px 12px; }
    .item { font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--app-color-border, #eee); }
    .item:last-child { border-bottom: none; }
    .change { padding-left: 12px; }
    .error { color: var(--app-status-action-fg, #c62828); font-size: 13px; }
  `],
})
export class CsvImportDialogComponent {
  private dialogRef = inject(MatDialogRef<CsvImportDialogComponent>);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  step = signal<Step>('upload');
  plan = signal<ImportResult | null>(null);
  fileName = signal('');
  error = signal('');
  /** 読み込んだ CSV（個人番号を含むことがあるので、取り込み・閉じる・選び直しで消す） */
  private csv: string | null = null;

  total() { const p = this.plan(); return p ? p.creates.length + p.updates.length : 0; }
  errorLines(p: ImportResult) { return new Set(p.errors.map(e => e.line)).size; }

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.read(file);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.read(file);
  }

  private async read(file: File) {
    this.error.set('');
    if (file.size > 3_000_000) { this.error.set('ファイルが大きすぎます（3MBまで）。分けて取り込んでください'); return; }
    const buffer = await file.arrayBuffer();
    // Excel で保存した CSV（Shift_JIS）にも対応する
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buffer);
    this.csv = text;
    this.fileName.set(file.name);
    await this.check();
  }

  private async call(dryRun: boolean): Promise<ImportResult> {
    const fn = httpsCallable<object, ImportResult>(this.functions, 'employeeCsvImport', { timeout: 540_000 });
    const { data } = await fn({ companyId: this.auth.companyId, csv: this.csv, dryRun });
    return data;
  }

  private async check() {
    this.step.set('checking');
    try {
      this.plan.set(await this.call(true));
      this.step.set('preview');
    } catch (e: any) {
      this.forget();
      this.error.set(e?.message ?? '確かめられませんでした。もう一度お試しください');
      this.step.set('upload');
    }
  }

  async runImport() {
    this.step.set('importing');
    try {
      this.plan.set(await this.call(false));
      this.step.set('done');
    } catch (e: any) {
      this.error.set(e?.message ?? '取り込めませんでした。従業員一覧で結果を確かめてください');
      this.step.set('upload');
    } finally {
      this.forget();
    }
  }

  reset() {
    this.forget();
    this.plan.set(null);
    this.error.set('');
    this.step.set('upload');
  }

  close() {
    this.forget();
    this.dialogRef.close((this.plan()?.created ?? 0) + (this.plan()?.updated ?? 0) > 0);
  }

  private forget() { this.csv = null; }

  downloadTemplate() {
    const blob = new Blob(['﻿' + TEMPLATE + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '従業員取込テンプレート.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
