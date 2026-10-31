import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

interface CsvRow {
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: string;
  officeId: string;
  hireDate: string;
  baseSalary: string;
}

interface ImportResult {
  row: number;
  employeeNumber: string;
  status: 'success' | 'error';
  message: string;
}

const REQUIRED_HEADERS = [
  '社員番号', '姓', '名', '姓カナ', '名カナ',
  '生年月日', '性別', '事業所ID', '入社日', '基本給',
];

const HEADER_MAP: Record<string, keyof CsvRow> = {
  '社員番号': 'employeeNumber',
  '姓': 'lastName',
  '名': 'firstName',
  '姓カナ': 'lastNameKana',
  '名カナ': 'firstNameKana',
  '生年月日': 'birthDate',
  '性別': 'gender',
  '事業所ID': 'officeId',
  '入社日': 'hireDate',
  '基本給': 'baseSalary',
};

@Component({
  selector: 'app-csv-import-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatTableModule, MatProgressBarModule, MatChipsModule,
  ],
  template: `
    <h2 mat-dialog-title>CSV一括取込</h2>
    <mat-dialog-content>
      @switch (step()) {
        @case ('upload') {
          <div class="upload-area"
               (dragover)="onDragOver($event)"
               (drop)="onDrop($event)"
               (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon>
            <p>CSVファイルをドラッグ＆ドロップ<br>またはクリックして選択</p>
            <p class="hint">文字コード: UTF-8 / Shift_JIS</p>
            <input #fileInput type="file" accept=".csv" hidden (change)="onFileSelect($event)">
          </div>
          <div class="template-link">
            <button mat-stroked-button (click)="downloadTemplate()">
              <mat-icon>download</mat-icon>
              テンプレートCSVダウンロード
            </button>
          </div>
        }
        @case ('preview') {
          <div class="preview-header">
            <span>{{ parsedRows().length }}件のデータを検出</span>
            @if (validationErrors().length > 0) {
              <span class="error-count">{{ validationErrors().length }}件のエラー</span>
            }
          </div>
          <div class="preview-table-wrapper">
            <table mat-table [dataSource]="parsedRows()" class="preview-table">
              <ng-container matColumnDef="row">
                <th mat-header-cell *matHeaderCellDef>行</th>
                <td mat-cell *matCellDef="let r; let i = index"
                    [class.error-row]="hasRowError(i)">{{ i + 2 }}</td>
              </ng-container>
              <ng-container matColumnDef="employeeNumber">
                <th mat-header-cell *matHeaderCellDef>社員番号</th>
                <td mat-cell *matCellDef="let r">{{ r.employeeNumber }}</td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>氏名</th>
                <td mat-cell *matCellDef="let r">{{ r.lastName }} {{ r.firstName }}</td>
              </ng-container>
              <ng-container matColumnDef="birthDate">
                <th mat-header-cell *matHeaderCellDef>生年月日</th>
                <td mat-cell *matCellDef="let r">{{ r.birthDate }}</td>
              </ng-container>
              <ng-container matColumnDef="hireDate">
                <th mat-header-cell *matHeaderCellDef>入社日</th>
                <td mat-cell *matCellDef="let r">{{ r.hireDate }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="previewColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: previewColumns"></tr>
            </table>
          </div>
          @if (validationErrors().length > 0) {
            <div class="error-list">
              <h3>バリデーションエラー</h3>
              @for (err of validationErrors(); track err) {
                <div class="error-item">{{ err }}</div>
              }
            </div>
          }
        }
        @case ('importing') {
          <div class="import-progress">
            <p>取込中... {{ importProgress() }}/{{ parsedRows().length }}</p>
            <mat-progress-bar mode="determinate"
              [value]="(importProgress() / parsedRows().length) * 100">
            </mat-progress-bar>
          </div>
        }
        @case ('done') {
          <div class="result-summary">
            <div class="result-stat success">
              <mat-icon>check_circle</mat-icon>
              <span>{{ successCount() }}件 成功</span>
            </div>
            @if (errorCount() > 0) {
              <div class="result-stat error">
                <mat-icon>error</mat-icon>
                <span>{{ errorCount() }}件 失敗</span>
              </div>
            }
          </div>
          @if (importResults().some(r => r.status === 'error')) {
            <div class="error-list">
              @for (r of importResults().filter(r => r.status === 'error'); track r.row) {
                <div class="error-item">行{{ r.row }}: {{ r.employeeNumber }} — {{ r.message }}</div>
              }
            </div>
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @switch (step()) {
        @case ('preview') {
          <button mat-button (click)="reset()">やり直す</button>
          <button mat-flat-button color="primary"
                  [disabled]="validationErrors().length > 0"
                  (click)="startImport()">
            取込開始
          </button>
        }
        @case ('done') {
          <button mat-flat-button color="primary" (click)="close(true)">閉じる</button>
        }
        @default {
          <button mat-button mat-dialog-close>キャンセル</button>
        }
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .upload-area {
      border: 2px dashed #ccc; border-radius: 12px; padding: 48px;
      text-align: center; cursor: pointer; transition: border-color 0.2s;
    }
    .upload-area:hover { border-color: var(--app-brand-strong); }
    .upload-area mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--app-brand-strong); }
    .upload-area p { margin: 8px 0; color: #666; }
    .upload-area .hint { font-size: 12px; color: #999; }
    .template-link { text-align: center; margin-top: 16px; }
    .preview-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-weight: 500; }
    .error-count { color: #c62828; }
    .preview-table-wrapper { max-height: 300px; overflow: auto; }
    .preview-table { width: 100%; }
    .error-row { background: #fff3e0; }
    .error-list { margin-top: 16px; max-height: 150px; overflow: auto; }
    .error-list h3 { font-size: 14px; color: #c62828; margin: 0 0 8px; }
    .error-item { font-size: 13px; color: #c62828; padding: 4px 0; }
    .import-progress { text-align: center; padding: 24px; }
    .import-progress p { margin-bottom: 16px; }
    .result-summary { display: flex; gap: 24px; justify-content: center; padding: 24px; }
    .result-stat { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 500; }
    .result-stat.success { color: #2e7d32; }
    .result-stat.error { color: #c62828; }
  `],
})
export class CsvImportDialogComponent {
  private dialogRef = inject(MatDialogRef<CsvImportDialogComponent>);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private notification = inject(NotificationService);

  step = signal<'upload' | 'preview' | 'importing' | 'done'>('upload');
  parsedRows = signal<CsvRow[]>([]);
  validationErrors = signal<string[]>([]);
  importProgress = signal(0);
  importResults = signal<ImportResult[]>([]);
  successCount = signal(0);
  errorCount = signal(0);

  previewColumns = ['row', 'employeeNumber', 'name', 'birthDate', 'hireDate'];

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.processFile(file);
  }

  private async processFile(file: File) {
    const text = await this.readFileAsText(file);
    this.parseCsv(text);
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        let text = reader.result as string;
        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.substring(1);
        }
        resolve(text);
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  private parseCsv(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      this.validationErrors.set(['ヘッダー行とデータ行が必要です']);
      this.step.set('preview');
      return;
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const errors: string[] = [];

    for (const required of REQUIRED_HEADERS) {
      if (!headers.includes(required)) {
        errors.push(`必須ヘッダー「${required}」がありません`);
      }
    }
    if (errors.length > 0) {
      this.validationErrors.set(errors);
      this.parsedRows.set([]);
      this.step.set('preview');
      return;
    }

    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      const row: any = {};
      for (let j = 0; j < headers.length; j++) {
        const key = HEADER_MAP[headers[j]];
        if (key) row[key] = cols[j]?.trim() ?? '';
      }
      rows.push(row as CsvRow);

      if (!row.employeeNumber) errors.push(`行${i + 1}: 社員番号が空です`);
      if (!row.lastName || !row.firstName) errors.push(`行${i + 1}: 氏名が空です`);
      if (!row.birthDate) errors.push(`行${i + 1}: 生年月日が空です`);
      if (!row.hireDate) errors.push(`行${i + 1}: 入社日が空です`);
      if (row.gender && !['男', '女', 'male', 'female'].includes(row.gender)) {
        errors.push(`行${i + 1}: 性別は「男」「女」のいずれかを指定してください`);
      }
    }

    this.parsedRows.set(rows);
    this.validationErrors.set(errors);
    this.step.set('preview');
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  hasRowError(index: number): boolean {
    const rowNum = index + 2;
    return this.validationErrors().some((e) => e.startsWith(`行${rowNum}:`));
  }

  async startImport() {
    this.step.set('importing');
    const rows = this.parsedRows();
    const results: ImportResult[] = [];
    let success = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const fn = httpsCallable<any, any>(this.functions, 'employeeCreate');
        await fn({
          companyId: this.auth.companyId,
          employeeNumber: row.employeeNumber,
          lastName: row.lastName,
          firstName: row.firstName,
          lastNameKana: row.lastNameKana,
          firstNameKana: row.firstNameKana,
          birthDate: row.birthDate,
          gender: row.gender === '男' || row.gender === 'male' ? 'male' : 'female',
          officeId: row.officeId || 'office-001',
          hireDate: row.hireDate,
        });
        results.push({ row: i + 2, employeeNumber: row.employeeNumber, status: 'success', message: '' });
        success++;
      } catch (e: any) {
        results.push({
          row: i + 2,
          employeeNumber: row.employeeNumber,
          status: 'error',
          message: e.message ?? '不明なエラー',
        });
        errors++;
      }
      this.importProgress.set(i + 1);
      this.importResults.set([...results]);
    }

    this.successCount.set(success);
    this.errorCount.set(errors);
    this.step.set('done');

    if (success > 0) {
      this.notification.success(`${success}件の従業員を取り込みました`);
    }
  }

  downloadTemplate() {
    const bom = '﻿';
    const header = REQUIRED_HEADERS.join(',');
    const sample = 'EMP-001,山田,太郎,ヤマダ,タロウ,1990-01-15,男,office-001,2024-04-01,300000';
    const csv = bom + header + '\n' + sample + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '従業員取込テンプレート.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  reset() {
    this.step.set('upload');
    this.parsedRows.set([]);
    this.validationErrors.set([]);
  }

  close(imported: boolean) {
    this.dialogRef.close(imported);
  }
}
