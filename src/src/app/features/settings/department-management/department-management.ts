import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
interface Department { id: string; name: string; officeId: string; sortOrder: number; isActive: boolean }
interface Office { id: string; name: string }

/** 部署の管理（カタログ1章）。事業所ごとに部署を作り、従業員の所属と部署別の集計・帳票に使う。使わなくなった部署は消さずに「使わない」にする */
@Component({
  selector: 'app-department-management',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, FormsModule, MatButtonModule],
  template: `
    <div class="section"><mat-card class="settings-card">
      <p class="sub">事業所ごとに部署を作ります。従業員の画面で所属部署を選ぶと、保険料の分析の部署別と、帳票の部署での絞り込みに使われます。部署を選ぶ欄は、矢印で決めた順番に並びます。</p>
      <div class="add">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>事業所</mat-label><mat-select [(ngModel)]="officeId" name="office">@for (o of offices(); track o.id) { <mat-option [value]="o.id">{{ o.name }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="name"><mat-label>部署名</mat-label><input matInput [(ngModel)]="name" name="name" maxlength="50" placeholder="例：営業部"></mat-form-field>
        <button mat-flat-button color="primary" type="button" (click)="add()" [disabled]="busy() || !officeId || !name.trim()">部署を作る</button>
      </div>
      @for (o of offices(); track o.id) {
        @if (byOffice().get(o.id); as list) {
          <h3>{{ o.name }}</h3>
          <table><thead><tr><th>部署名</th><th class="state">状態</th><th class="order">表示の順番</th><th class="ops"></th></tr></thead><tbody>
            @for (d of list; track d.id; let first = $first, last = $last) {
              <tr [class.off]="!d.isActive">
                <td><mat-form-field appearance="outline" subscriptSizing="dynamic" class="row-name"><input matInput [(ngModel)]="d.name" [name]="'n' + d.id" maxlength="50" aria-label="部署名"></mat-form-field></td>
                <td class="state">{{ d.isActive ? '使う' : '使わない' }}</td>
                <td class="order">
                  <button mat-icon-button type="button" (click)="move(list, d, -1)" [disabled]="busy() || first" [attr.aria-label]="d.name + 'を上へ'"><mat-icon>arrow_upward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="move(list, d, 1)" [disabled]="busy() || last" [attr.aria-label]="d.name + 'を下へ'"><mat-icon>arrow_downward</mat-icon></button>
                </td>
                <td class="ops">
                  <button mat-button type="button" (click)="save(d)" [disabled]="busy()">保存</button>
                  <button mat-button type="button" (click)="save(d, !d.isActive)" [disabled]="busy()">{{ d.isActive ? '使わないにする' : '使うに戻す' }}</button>
                </td>
              </tr>
            }
          </tbody></table>
        }
      }
      @if (!departments().length) { <p class="sub">部署はまだありません。</p> }
    </mat-card></div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); margin-top: 0; }
    .add { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 12px 0 20px; }
    .name { width: 260px; max-width: 100%; }
    /* ほかの一覧（mat-table）と同じ：灰色の小さな見出し・薄い区切り線。カードの幅いっぱいに広げ、部署名の欄が残りの幅を使う */
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-md); margin-bottom: 12px; }
    th { padding: 8px; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-muted); text-align: left; border-bottom: 1px solid var(--app-color-border); }
    td { padding: 4px 8px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .row-name { width: 100%; --mat-form-field-container-height: 36px; --mat-form-field-container-vertical-padding: 6px; }
    .state { width: 96px; white-space: nowrap; }
    .order { width: 120px; white-space: nowrap; }
    .ops { width: 220px; white-space: nowrap; text-align: right; }
    tr.off td { color: var(--app-color-text-sub); }
    h3 { margin: 16px 0 6px; font-size: var(--app-font-md); }
  `],
})
export class DepartmentManagementComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  offices = signal<Office[]>([]);
  departments = signal<Department[]>([]);
  busy = signal(false);
  officeId = '';
  name = '';

  byOffice = computed(() => {
    const m = new Map<string, Department[]>();
    for (const d of this.departments()) m.set(d.officeId, [...(m.get(d.officeId) ?? []), d]);
    return m;
  });

  async ngOnInit() {
    const { data } = await httpsCallable<object, { items: Office[] }>(this.functions, 'officeList')({ companyId: this.auth.companyId });
    this.offices.set(data.items);
    this.officeId = data.items[0]?.id ?? '';
    await this.load();
  }

  async load() {
    const { data } = await httpsCallable<object, { items: Department[] }>(this.functions, 'departmentList')({ companyId: this.auth.companyId, includeInactive: true });
    this.departments.set(data.items);
  }

  /** 新しい部署は、その事業所の一番下に足す */
  add() {
    const last = Math.max(0, ...(this.byOffice().get(this.officeId) ?? []).map(d => d.sortOrder));
    return this.call({ officeId: this.officeId, name: this.name.trim(), sortOrder: last + 10, isActive: true }, `「${this.name.trim()}」を作りました`, () => { this.name = ''; });
  }

  save(d: Department, isActive = d.isActive) {
    return this.call({ departmentId: d.id, officeId: d.officeId, name: d.name.trim(), sortOrder: d.sortOrder, isActive }, `「${d.name.trim()}」を保存しました`);
  }

  /** 隣の部署と順番を入れ替える。順番は 10, 20, 30… に振り直し、変わった部署だけ保存する */
  async move(list: Department[], d: Department, step: -1 | 1) {
    const i = list.indexOf(d);
    const order = [...list];
    [order[i], order[i + step]] = [order[i + step], order[i]];
    const changed = order.map((x, k) => ({ x, sortOrder: (k + 1) * 10 })).filter(c => c.x.sortOrder !== c.sortOrder);
    this.busy.set(true);
    try {
      for (const c of changed) {
        await httpsCallable(this.functions, 'departmentSave')({ companyId: this.auth.companyId, departmentId: c.x.id, officeId: c.x.officeId, name: c.x.name.trim(), sortOrder: c.sortOrder, isActive: c.x.isActive });
      }
      await this.load();
    } catch (e: unknown) {
      this.snackBar.open(`順番を変えられませんでした：${e instanceof Error ? e.message : ''}`, '閉じる', { duration: 6000 });
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private async call(payload: object, done: string, after?: () => void) {
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'departmentSave')({ companyId: this.auth.companyId, ...payload });
      after?.();
      this.snackBar.open(done, '閉じる', { duration: 3000 });
      await this.load();
    } catch (e: unknown) {
      this.snackBar.open(`保存できませんでした：${e instanceof Error ? e.message : ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
