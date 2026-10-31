import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { PageHeadComponent } from '../../shared/ui';

interface CalendarEvent { start: string; end: string | null; title: string; kind: 'annual' | 'bonus' | 'deadline'; officeName?: string }
interface ChecklistItem { key: string; label: string; link: string; done: boolean; doneAt: string | null; doneBy: string | null }

/** 手続きカレンダー・今月やること・リマインドの設定（カタログ12章） */
@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, PageHeadComponent],
  template: `
    <app-page-head heading="手続きカレンダー">
      <span meta>{{ year() }}年</span>
      <ng-container actions>
        <button mat-button type="button" (click)="setYear(year() - 1)">前の年</button>
        <button mat-button type="button" (click)="setYear(year() + 1)">次の年</button>
      </ng-container>
    </app-page-head>

    <section class="card">
      <h2>今月やること（{{ thisMonthLabel }}）</h2>
      @for (i of checklist(); track i.key) {
        <div class="check">
          <mat-checkbox [checked]="i.done" (change)="toggle(i, $event.checked)">{{ i.label }}</mat-checkbox>
          <a [routerLink]="path(i.link)" [queryParams]="query(i.link)">開く</a>
          @if (i.done) { <span class="sub">{{ i.doneBy }}・{{ i.doneAt?.slice(5, 10)?.replace('-', '/') }}</span> }
        </div>
      }
      @if (isAdmin) {
        <div class="reminder">
          期限の <input type="number" min="1" max="60" [(ngModel)]="reminderDays" name="rd"> 日前に、ホームのお知らせで知らせる
          <button mat-stroked-button type="button" (click)="saveReminder()">保存</button>
        </div>
      } @else { <p class="sub">期限の{{ reminderDays }}日前にお知らせが届きます。</p> }
    </section>

    @for (m of months(); track m.month) {
      <section class="card month">
        <h3>{{ m.month }}月</h3>
        @for (e of m.events; track $index) {
          <div class="event" [class]="e.kind"><span class="date">{{ dateLabel(e) }}</span><span>{{ e.title }}@if (e.officeName) {（{{ e.officeName }}）}</span></div>
        } @empty { <p class="sub">予定はありません。</p> }
      </section>
    }
  `,
  styles: [`
    :host { display: block; padding: var(--app-space-5); max-width: 960px; }
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: var(--app-space-4); margin-bottom: var(--app-space-3); }
    h2 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-lg); }
    h3 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-md); }
    .check { display: flex; align-items: center; gap: 12px; }
    .check a { font-size: var(--app-font-sm); color: var(--app-color-link); }
    .reminder { margin-top: var(--app-space-3); font-size: var(--app-font-sm); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .reminder input { width: 56px; padding: 4px; }
    .event { display: flex; gap: 12px; padding: 4px 0; font-size: var(--app-font-sm); border-left: 3px solid var(--app-color-border); padding-left: 8px; margin-bottom: 4px; }
    .event.annual { border-color: var(--app-color-link); }
    .event.bonus { border-color: var(--app-status-done-fg); }
    .event.deadline { border-color: var(--app-status-attention-fg); }
    .date { min-width: 96px; color: var(--app-color-text-sub); }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
  `],
})
export class CalendarComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  private today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  thisMonth = this.today.slice(0, 7);
  thisMonthLabel = `${Number(this.thisMonth.slice(5))}月`;
  isAdmin = this.auth.hasRole('admin');
  year = signal(Number(this.today.slice(0, 4)));
  events = signal<CalendarEvent[]>([]);
  checklist = signal<ChecklistItem[]>([]);
  reminderDays = 7;

  months = computed(() => Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { month: i + 1, events: this.events().filter(e => e.start.slice(5, 7) === mm || (e.end && e.start.slice(5, 7) < mm && e.end.slice(5, 7) >= mm)) };
  }));

  ngOnInit() {
    void this.loadEvents();
    void this.loadChecklist();
  }

  setYear(y: number) { this.year.set(y); void this.loadEvents(); }
  path(link: string) { return link.split('?')[0]; }
  query(link: string) { return Object.fromEntries(new URLSearchParams(link.split('?')[1] ?? '')); }
  dateLabel(e: CalendarEvent) {
    const f = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    return e.end ? `${f(e.start)}〜${f(e.end)}` : e.kind === 'bonus' ? '月中' : f(e.start);
  }

  async loadEvents() {
    const { data } = await httpsCallable<object, { events: CalendarEvent[] }>(this.functions, 'calendarGet')({ companyId: this.auth.companyId, year: this.year() });
    this.events.set(data.events);
  }

  async loadChecklist() {
    const { data } = await httpsCallable<object, { items: ChecklistItem[]; reminderDays: number }>(this.functions, 'checklistGet')({ companyId: this.auth.companyId, yearMonth: this.thisMonth });
    this.checklist.set(data.items);
    this.reminderDays = data.reminderDays;
  }

  async toggle(i: ChecklistItem, done: boolean) {
    try {
      await httpsCallable(this.functions, 'checklistSet')({ companyId: this.auth.companyId, yearMonth: this.thisMonth, key: i.key, done });
      await this.loadChecklist();
    } catch (e: any) {
      this.snackBar.open(`記録できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 5000 });
    }
  }

  async saveReminder() {
    try {
      await httpsCallable(this.functions, 'reminderSettingsUpdate')({ companyId: this.auth.companyId, daysBefore: Number(this.reminderDays) });
      this.snackBar.open('お知らせの時期を保存しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`保存できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 5000 });
    }
  }
}
