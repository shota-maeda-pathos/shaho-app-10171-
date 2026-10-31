import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

/** 本人ポータルの公開範囲（カタログ11章）。項目ごとに公開・非公開。既定は全部公開。非公開の項目はサーバーが返さない */
@Component({
  selector: 'app-portal-settings',
  standalone: true,
  imports: [MatButtonModule, MatSlideToggleModule],
  template: `
    <div class="section">
      <p class="sub">従業員の本人ポータルに見せる項目を選びます。オフにした項目は本人の画面に出ません。個人番号はどの設定でも表示しません。</p>
      @for (item of items(); track item.key) {
        <div class="row"><mat-slide-toggle [checked]="!hidden().has(item.key)" (change)="toggle(item.key, $event.checked)">{{ item.label }}</mat-slide-toggle></div>
      }
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="saving() || !dirty()">保存</button>
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .row { padding: 8px 0; }
    button { margin-top: 16px; }
  `],
})
export class PortalSettingsComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  items = signal<{ key: string; label: string }[]>([]);
  hidden = signal(new Set<string>());
  saving = signal(false);
  dirty = signal(false);

  async ngOnInit() {
    const { data } = await httpsCallable<object, { items: { key: string; label: string }[]; hidden: string[] }>(this.functions, 'portalSettingsGet')({ companyId: this.auth.companyId });
    this.items.set(data.items);
    this.hidden.set(new Set(data.hidden));
  }

  toggle(key: string, visible: boolean) {
    const next = new Set(this.hidden());
    if (visible) next.delete(key); else next.add(key);
    this.hidden.set(next);
    this.dirty.set(true);
  }

  async save() {
    this.saving.set(true);
    try {
      await httpsCallable(this.functions, 'portalSettingsUpdate')({ companyId: this.auth.companyId, hidden: [...this.hidden()] });
      this.dirty.set(false);
      this.snackBar.open('公開範囲を保存しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`保存できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.saving.set(false);
    }
  }
}
