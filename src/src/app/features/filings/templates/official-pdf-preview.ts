import { Component, inject, OnDestroy } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface OfficialPdfPreviewData {
  bytes: Uint8Array;
  title: string;
  filename: string;
  sourceUrl: string;
  originalUrl: string;
  warnings: string[];
}

@Component({
  selector: 'app-official-pdf-preview',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }} — 公式様式PDF</h2>
    <mat-dialog-content>
      <p>日本年金機構の公式PDFに、登録済みの情報を記入しています（様式取得日：2026年10月28日）。記入上の注意もPDFに含めています。</p>
      @if (data.warnings.length) {
        <details open class="warnings">
          <summary>未入力・要確認：{{ data.warnings.length }}項目</summary>
          <ul>@for (warning of data.warnings; track warning) { <li>{{ warning }}</li> }</ul>
          <p>未登録・未対応の欄は空欄です。保存したPDFや印刷した原票で補完してください。</p>
        </details>
      }
      <p class="links">
        <a [href]="data.sourceUrl" target="_blank" rel="noopener noreferrer">日本年金機構の様式掲載ページ</a>
        <a [href]="data.originalUrl" target="_blank" rel="noopener noreferrer">未記入の公式原票</a>
      </p>
      <iframe [src]="previewUrl" [title]="data.title + 'のPDFプレビュー'"></iframe>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>閉じる</button>
      <a mat-flat-button [href]="objectUrl" [download]="data.filename">PDFを保存</a>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { display: flex; flex-direction: column; max-height: none; flex: 1; min-height: 0; }
    :host { display: flex; flex-direction: column; height: 100%; }
    p, li { font-size: 13px; line-height: 1.5; }
    p { margin: 8px 0; }
    iframe { width: 100%; flex: 1; min-height: 280px; border: 1px solid #aaa; }
    .warnings { border: 1px solid #b56500; padding: 10px; max-height: 140px; overflow: auto; flex-shrink: 0; }
    summary { cursor: pointer; font-weight: 500; }
    .links { display: flex; gap: 24px; flex-wrap: wrap; }
  `],
})
export class OfficialPdfPreviewComponent implements OnDestroy {
  readonly data = inject<OfficialPdfPreviewData>(MAT_DIALOG_DATA);
  readonly objectUrl = URL.createObjectURL(new Blob([new Uint8Array(this.data.bytes)], { type: 'application/pdf' }));
  readonly previewUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(this.objectUrl);
  ngOnDestroy() { URL.revokeObjectURL(this.objectUrl); }
}
