import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface Department { id: string; name: string; officeId: string; sortOrder: number; isActive: boolean }
interface Office { id: string; name: string }

/** 部署の管理（カタログ1章）。事業所ごとに部署を作り、従業員の所属と部署別の集計・帳票に使う。使わなくなった部署は消さずに「使わない」にする */
@Component({
  selector: 'app-department-management',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  template: `
    <div class="section">
      <p class="sub">事業所ごとに部署を作ります。従業員の画面で所属部署を選ぶと、保険料の分析の部署別と、帳票の部署での絞り込みに使われます。</p>
      <div class="add">
        <label>事業所
          <select [(ngModel)]="officeId" name="office">@for (o of offices(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }</select></label>
        <label>部署名 <input [(ngModel)]="name" name="name" maxlength="50" placeholder="例：営業部"></label>
        <label>並び順 <input type="number" [(ngModel)]="sortOrder" name="sortOrder" min="0" max="9999"></label>
        <button mat-flat-button color="primary" type="button" (click)="add()" [disabled]="busy() || !officeId || !name.trim()">部署を作る</button>
      </div>
      @for (o of offices(); track o.id) {
        @if (byOffice().get(o.id); as list) {
          <h3>{{ o.name }}</h3>
          <table><thead><tr><th>部署名</th><th class="num">並び順</th><th>状態</th><th></th></tr></thead><tbody>
            @for (d of list; track d.id) {
              <tr [class.off]="!d.isActive">
                <td><input [(ngModel)]="d.name" [name]="'n' + d.id" maxlength="50"></td>
                <td class="num"><input type="number" class="short" [(ngModel)]="d.sortOrder" [name]="'s' + d.id" min="0" max="9999"></td>
                <td>{{ d.isActive ? '使う' : '使わない' }}</td>
                <td>
                  <button mat-button type="button" (click)="save(d)" [disabled]="busy()">保存</button>
                  <button mat-button type="button" (click)="save(d, !d.isActive)" [disabled]="busy()">{{ d.isActive ? '使わないにする' : '使うに戻す' }}</button>
                </td>
              </tr>
            }
          </tbody></table>
        }
      }
      @if (!departments().length) { <p class="sub">部署はまだありません。</p> }
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .add { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin: 12px 0 20px; }
    .add label { display: flex; flex-direction: column; gap: 2px; font-size: var(--app-font-sm); }
    input, select { padding: 6px 8px; font: inherit; }
    .short { width: 5em; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); margin-bottom: 12px; }
    td, th { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; }
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
  sortOrder = 0;

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

  add() { return this.call({ officeId: this.officeId, name: this.name.trim(), sortOrder: Number(this.sortOrder) || 0, isActive: true }, `「${this.name.trim()}」を作りました`, () => { this.name = ''; }); }

  save(d: Department, isActive = d.isActive) {
    return this.call({ departmentId: d.id, officeId: d.officeId, name: d.name.trim(), sortOrder: Number(d.sortOrder) || 0, isActive }, `「${d.name.trim()}」を保存しました`);
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
