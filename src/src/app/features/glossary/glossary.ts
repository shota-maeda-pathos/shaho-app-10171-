import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { EmptyStateComponent, GLOSSARY } from '../../shared/ui';

/** 用語集。画面の「?」と同じ説明を一覧で読めるようにする */
@Component({
  selector: 'app-glossary',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatIconModule, MatInputModule, EmptyStateComponent],
  template: `
    <div class="app-page">
      <h1 class="app-page-title">用語集</h1>
      <p class="app-page-guide">画面に出てくる社会保険の言葉の意味です。各画面の用語の横にある「?」からも同じ説明を読めます。</p>
      <mat-form-field appearance="outline" class="search">
        <mat-label>言葉で探す</mat-label>
        <input matInput [ngModel]="query()" (ngModelChange)="query.set($event)">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <dl class="entries">
        @for (e of entries(); track e.term) {
          <div class="entry"><dt>{{ e.term }}</dt><dd>{{ e.body }}</dd></div>
        }
      </dl>
      @if (entries().length === 0) {
        <app-empty-state message="該当する言葉がありません" hint="別の言葉や、ひらがなで探してください" icon="search_off" />
      }
    </div>
  `,
  styles: [`
    .search { width: 100%; max-width: 420px; }
    .entries { margin: 0; max-width: 900px; }
    .entry { padding: var(--app-space-3) 0; border-bottom: 1px solid var(--app-color-border); }
    dt { font-weight: 600; font-size: var(--app-font-lg); margin-bottom: var(--app-space-1); }
    dd { margin: 0; line-height: 1.8; }
  `],
})
export class GlossaryComponent {
  query = signal('');
  private all = Object.values(GLOSSARY).sort((a, b) => a.reading.localeCompare(b.reading, 'ja'));
  entries = computed(() => {
    const q = this.query().trim();
    return q ? this.all.filter(e => e.term.includes(q) || e.reading.includes(q) || e.body.includes(q)) : this.all;
  });
}
