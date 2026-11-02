import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

type RequestType = 'address' | 'name' | 'dependentAdd' | 'dependentRemove' | 'leave';

interface MyRequest { id: string; typeLabel: string; status: string; createdAt: string | null; comment: string | null; attachments: { name: string }[] }

const STATUS_LABELS: Record<string, string> = { submitted: '受付待ち', inProgress: '手続き中', done: '完了', rejected: '差し戻し' };

/** 本人からの申請（カタログ11章）：住所・氏名の変更、扶養の追加・削除（書類の添付つき）、産休・育休 */
@Component({
  selector: 'app-portal-requests',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule],
  template: `
    <section class="card">
      <h2>申請する</h2>
      @if (!canRequest) {
        <p class="sub">退職後は閲覧だけで、申請はできません。</p>
      } @else {
        <mat-form-field appearance="outline" class="type">
          <mat-label>申請の種類</mat-label>
          <mat-select [(ngModel)]="type" name="type">
            <mat-option value="address">住所が変わった</mat-option>
            <mat-option value="name">氏名が変わった</mat-option>
            <mat-option value="dependentAdd">家族を扶養に入れたい</mat-option>
            <mat-option value="dependentRemove">家族を扶養から外したい</mat-option>
            <mat-option value="leave">産休・育休を取りたい</mat-option>
          </mat-select>
        </mat-form-field>

        <div class="fields">
          @switch (type) {
            @case ('address') {
              <mat-form-field appearance="outline"><mat-label>郵便番号</mat-label><input matInput [(ngModel)]="f['postalCode']" name="postalCode" placeholder="123-4567"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>都道府県</mat-label><input matInput [(ngModel)]="f['prefecture']" name="prefecture"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>市区町村</mat-label><input matInput [(ngModel)]="f['city']" name="city"></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>番地</mat-label><input matInput [(ngModel)]="f['addressLine']" name="addressLine"></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>建物名・部屋番号（任意）</mat-label><input matInput [(ngModel)]="f['building']" name="building"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>引っ越した日</mat-label><input matInput type="date" [(ngModel)]="f['movedOn']" name="movedOn"></mat-form-field>
            }
            @case ('name') {
              <mat-form-field appearance="outline"><mat-label>新しい姓</mat-label><input matInput [(ngModel)]="f['lastName']" name="lastName"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>新しい名</mat-label><input matInput [(ngModel)]="f['firstName']" name="firstName"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>姓（カナ）</mat-label><input matInput [(ngModel)]="f['lastNameKana']" name="lastNameKana"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>名（カナ）</mat-label><input matInput [(ngModel)]="f['firstNameKana']" name="firstNameKana"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>変わった日</mat-label><input matInput type="date" [(ngModel)]="f['changedOn']" name="changedOn"></mat-form-field>
            }
            @case ('dependentAdd') {
              <mat-form-field appearance="outline"><mat-label>姓</mat-label><input matInput [(ngModel)]="f['lastName']" name="dLast"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>名</mat-label><input matInput [(ngModel)]="f['firstName']" name="dFirst"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>生年月日</mat-label><input matInput type="date" [(ngModel)]="f['birthDate']" name="dBirth"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>性別</mat-label>
                <mat-select [(ngModel)]="f['gender']" name="dGender"><mat-option value="female">女</mat-option><mat-option value="male">男</mat-option></mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>続柄</mat-label>
                <mat-select [(ngModel)]="f['relationship']" name="rel">
                  <mat-option value="spouse">配偶者</mat-option><mat-option value="child">子</mat-option><mat-option value="parent">父母</mat-option>
                  <mat-option value="grandparent">祖父母</mat-option><mat-option value="sibling">兄弟姉妹</mat-option><mat-option value="grandchild">孫</mat-option><mat-option value="other">その他</mat-option>
                </mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>年収の見込み（円）</mat-label><input matInput type="number" [(ngModel)]="f['annualIncome']" name="income"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>扶養に入れたい日</mat-label><input matInput type="date" [(ngModel)]="f['since']" name="since"></mat-form-field>
              <mat-checkbox [(ngModel)]="f['coResident']" name="co">一緒に住んでいる</mat-checkbox>
            }
            @case ('dependentRemove') {
              <mat-form-field appearance="outline"><mat-label>外したい家族の氏名</mat-label><input matInput [(ngModel)]="f['dependentName']" name="dn"></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>理由（就職した・収入が増えた など）</mat-label><input matInput [(ngModel)]="f['reason']" name="reason"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>外れる日</mat-label><input matInput type="date" [(ngModel)]="f['since']" name="since2"></mat-form-field>
            }
            @case ('leave') {
              <mat-form-field appearance="outline"><mat-label>休業の種類</mat-label>
                <mat-select [(ngModel)]="f['kind']" name="kind">@if (canRequestMaternity()) {<mat-option value="maternity">産前産後休業</mat-option>}<mat-option value="childcare">育児休業</mat-option></mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>開始日</mat-label><input matInput type="date" [(ngModel)]="f['startDate']" name="ls"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>終了予定日</mat-label><input matInput type="date" [(ngModel)]="f['endDate']" name="le"></mat-form-field>
              @if (f['kind'] === 'maternity') { <mat-form-field appearance="outline"><mat-label>出産予定日</mat-label><input matInput type="date" [(ngModel)]="f['expectedBirthDate']" name="eb"></mat-form-field> }
              @if (f['kind'] === 'childcare') {
                <mat-form-field appearance="outline"><mat-label>子の姓</mat-label><input matInput [(ngModel)]="f['childLastName']" name="cl"></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>子の名</mat-label><input matInput [(ngModel)]="f['childFirstName']" name="cf"></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>子の生年月日</mat-label><input matInput type="date" [(ngModel)]="f['childBirthDate']" name="cb"></mat-form-field>
              }
            }
          }
        </div>
        <mat-form-field appearance="outline" class="wide"><mat-label>担当者への連絡（任意）</mat-label><input matInput [(ngModel)]="note" name="note"></mat-form-field>
        @if (type === 'dependentAdd' || type === 'dependentRemove' || type === 'leave') {
          <div class="attach">
            <label>書類を添える（PDF・JPEG・PNG、1ファイル5MBまで。{{ type === 'leave' ? '母子健康手帳の写しなど出産・出生を確かめられる書類' : '続柄や収入が分かる書類など' }}）
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" (change)="pick($event)"></label>
            @if (files.length) { <span class="sub">{{ files.length }}ファイルを選んでいます</span> }
          </div>
        }
        <button mat-flat-button color="primary" type="button" (click)="submit()" [disabled]="busy() || !type">申請する</button>
      }
    </section>

    <section class="card">
      <h2>わたしの申請</h2>
      <table><thead><tr><th>申請</th><th>申請日</th><th>状況</th><th>担当者から</th></tr></thead><tbody>
        @for (r of mine(); track r.id) {
          <tr><td>{{ r.typeLabel }}@if (r.attachments.length) {（書類{{ r.attachments.length }}）}</td><td>{{ r.createdAt | date: 'yyyy/M/d' }}</td><td>{{ statusLabel(r.status) }}</td><td>{{ r.comment ?? '' }}</td></tr>
        } @empty { <tr><td colspan="4">申請はまだありません。</td></tr> }
      </tbody></table>
    </section>
  `,
  styles: [`
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: var(--app-space-4); margin-bottom: var(--app-space-4); }
    h2 { margin: 0 0 var(--app-space-3); font-size: var(--app-font-lg); }
    .type { min-width: 280px; }
    .fields { display: flex; flex-wrap: wrap; gap: 0 12px; align-items: center; }
    .wide { flex: 1 1 100%; width: 100%; }
    .attach { margin: 0 0 var(--app-space-3); font-size: var(--app-font-sm); display: flex; flex-direction: column; gap: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--app-color-border); }
    th { color: var(--app-color-text-sub); font-weight: 600; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    @media (max-width: 720px) { .type, mat-form-field { width: 100%; } }
  `],
})
export class PortalRequestsComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  canRequest = !this.auth.profile()?.isSuspended;
  type: RequestType | '' = '';
  f: Record<string, any> = { coResident: true };
  note = '';
  files: File[] = [];
  busy = signal(false);
  mine = signal<MyRequest[]>([]);
  /** 産休を選べるか（台帳の性別が男性なら出さない。サーバーも申請を断る） */
  canRequestMaternity = signal(true);

  ngOnInit() { void this.loadMine(); }

  statusLabel(s: string) { return STATUS_LABELS[s] ?? s; }

  pick(e: Event) { this.files = Array.from((e.target as HTMLInputElement).files ?? []); }

  async loadMine() {
    try {
      const { data } = await httpsCallable<object, { items: MyRequest[]; canRequestMaternity?: boolean }>(this.functions, 'portalRequestMine')({ companyId: this.auth.companyId });
      this.mine.set(data.items);
      this.canRequestMaternity.set(data.canRequestMaternity !== false);
    } catch { /* 一覧が読めなくても申請はできる */ }
  }

  private payload(): Record<string, unknown> {
    const v = Object.fromEntries(Object.entries(this.f).filter(([, x]) => x !== '' && x !== undefined && x !== null));
    if (this.type === 'dependentAdd') v['annualIncome'] = Number(v['annualIncome'] ?? 0);
    if (this.type !== 'dependentAdd') delete v['coResident'];
    return { type: this.type, ...v };
  }

  async submit() {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { id: string }>(this.functions, 'portalRequestCreate')({
        companyId: this.auth.companyId, request: this.payload(), ...(this.note ? { note: this.note } : {}),
      });
      for (const file of this.files) {
        const dataBase64 = await new Promise<string>((ok, ng) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(',')[1] ?? '');
          r.onerror = () => ng(r.error);
          r.readAsDataURL(file);
        });
        await httpsCallable(this.functions, 'portalRequestAttach')({ companyId: this.auth.companyId, requestId: data.id, name: file.name, dataBase64 });
      }
      this.snackBar.open('申請しました。担当者が確かめて手続きします', '閉じる', { duration: 5000 });
      this.type = ''; this.f = { coResident: true }; this.note = ''; this.files = [];
      await this.loadMine();
    } catch (e: any) {
      this.snackBar.open(`申請できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
}
