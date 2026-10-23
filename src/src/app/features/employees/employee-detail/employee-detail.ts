import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatDividerModule } from '@angular/material/divider';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface Office {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
  officeId: string;
}

interface EmployeeForm {
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  hireDate: string;
  officeId: string;
  healthInsuranceNumber: string;
  pensionNumber: string;
  basicPensionNumber: string;
  myNumber: string;
  address: string;
  memo: string;
}

interface Dependent {
  id: string;
  lastName: string;
  firstName: string;
  relationship: string;
  birthDate: string;
  qualificationDate: string;
  disqualificationDate: string | null;
}

interface Employment {
  id: string;
  effectiveDate: string;
  employmentType: string;
  weeklyHours: number;
  monthlyDays: number;
  baseSalary: number;
  socialInsuranceEnrolled: boolean;
  longTermCareEnrolled: boolean;
}

interface Grade {
  id: string;
  effectiveMonth: string;
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
  determinationType: string;
}

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatNativeDateModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatTabsModule, MatTableModule, MatDividerModule,
  ],
  template: `
    <div class="page-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h1>{{ isNew ? '従業員 新規登録' : '従業員 詳細' }}</h1>
    </div>

    @if (loading()) {
      <div class="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>
    } @else {
      <mat-tab-group>
        <mat-tab label="基本情報">
          <div class="tab-content">
            <mat-card>
              <mat-card-content>
                <div class="form-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>社員番号</mat-label>
                    <input matInput [(ngModel)]="form.employeeNumber" name="employeeNumber">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>姓</mat-label>
                    <input matInput [(ngModel)]="form.lastName" name="lastName" required>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>名</mat-label>
                    <input matInput [(ngModel)]="form.firstName" name="firstName" required>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>姓（カナ）</mat-label>
                    <input matInput [(ngModel)]="form.lastNameKana" name="lastNameKana">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>名（カナ）</mat-label>
                    <input matInput [(ngModel)]="form.firstNameKana" name="firstNameKana">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>性別</mat-label>
                    <mat-select [(ngModel)]="form.gender" name="gender">
                      <mat-option value="male">男性</mat-option>
                      <mat-option value="female">女性</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>生年月日</mat-label>
                    <input matInput [(ngModel)]="form.birthDate" name="birthDate"
                           placeholder="YYYY-MM-DD">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>入社日</mat-label>
                    <input matInput [(ngModel)]="form.hireDate" name="hireDate"
                           placeholder="YYYY-MM-DD" required>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>事業所</mat-label>
                    <mat-select [(ngModel)]="form.officeId" name="officeId" required>
                      @for (o of offices(); track o.id) {
                        <mat-option [value]="o.id">{{ o.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>

                <mat-divider></mat-divider>
                <h3>保険番号</h3>
                <div class="form-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>健康保険番号</mat-label>
                    <input matInput [(ngModel)]="form.healthInsuranceNumber" name="healthInsuranceNumber">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>厚生年金番号</mat-label>
                    <input matInput [(ngModel)]="form.pensionNumber" name="pensionNumber">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>基礎年金番号</mat-label>
                    <input matInput [(ngModel)]="form.basicPensionNumber" name="basicPensionNumber">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>マイナンバー</mat-label>
                    <input matInput [(ngModel)]="form.myNumber" name="myNumber">
                  </mat-form-field>
                </div>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>住所</mat-label>
                  <input matInput [(ngModel)]="form.address" name="address">
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>メモ</mat-label>
                  <textarea matInput [(ngModel)]="form.memo" name="memo" rows="3"></textarea>
                </mat-form-field>

                <div class="actions">
                  <button mat-flat-button color="primary" (click)="onSave()" [disabled]="saving()">
                    @if (saving()) {
                      <mat-spinner diameter="20"></mat-spinner>
                    } @else {
                      {{ isNew ? '登録' : '更新' }}
                    }
                  </button>
                  <button mat-stroked-button (click)="goBack()">キャンセル</button>
                </div>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        @if (!isNew) {
          <mat-tab label="扶養家族">
            <div class="tab-content">
              <div class="page-header">
                <h2>扶養家族一覧</h2>
              </div>

              @if (dependents().length > 0) {
                <table mat-table [dataSource]="dependents()">
                  <ng-container matColumnDef="name">
                    <th mat-header-cell *matHeaderCellDef>氏名</th>
                    <td mat-cell *matCellDef="let d">{{ d.lastName }} {{ d.firstName }}</td>
                  </ng-container>
                  <ng-container matColumnDef="relationship">
                    <th mat-header-cell *matHeaderCellDef>続柄</th>
                    <td mat-cell *matCellDef="let d">{{ d.relationship }}</td>
                  </ng-container>
                  <ng-container matColumnDef="birthDate">
                    <th mat-header-cell *matHeaderCellDef>生年月日</th>
                    <td mat-cell *matCellDef="let d">{{ d.birthDate }}</td>
                  </ng-container>
                  <ng-container matColumnDef="qualificationDate">
                    <th mat-header-cell *matHeaderCellDef>認定日</th>
                    <td mat-cell *matCellDef="let d">{{ d.qualificationDate }}</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="dependentColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: dependentColumns"></tr>
                </table>
              } @else {
                <div class="empty-state">
                  <p>扶養家族が登録されていません</p>
                </div>
              }
            </div>
          </mat-tab>

          <mat-tab label="雇用条件">
            <div class="tab-content">
              <div class="page-header">
                <h2>雇用条件履歴</h2>
              </div>

              @if (employments().length > 0) {
                <table mat-table [dataSource]="employments()">
                  <ng-container matColumnDef="effectiveDate">
                    <th mat-header-cell *matHeaderCellDef>適用開始日</th>
                    <td mat-cell *matCellDef="let e">{{ e.effectiveDate }}</td>
                  </ng-container>
                  <ng-container matColumnDef="employmentType">
                    <th mat-header-cell *matHeaderCellDef>雇用形態</th>
                    <td mat-cell *matCellDef="let e">{{ employmentTypeLabel(e.employmentType) }}</td>
                  </ng-container>
                  <ng-container matColumnDef="baseSalary">
                    <th mat-header-cell *matHeaderCellDef>基本給</th>
                    <td mat-cell *matCellDef="let e">{{ e.baseSalary | number }}円</td>
                  </ng-container>
                  <ng-container matColumnDef="weeklyHours">
                    <th mat-header-cell *matHeaderCellDef>週所定時間</th>
                    <td mat-cell *matCellDef="let e">{{ e.weeklyHours }}h</td>
                  </ng-container>
                  <ng-container matColumnDef="socialInsurance">
                    <th mat-header-cell *matHeaderCellDef>社保加入</th>
                    <td mat-cell *matCellDef="let e">{{ e.socialInsuranceEnrolled ? '○' : '×' }}</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="employmentColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: employmentColumns"></tr>
                </table>
              } @else {
                <div class="empty-state">
                  <p>雇用条件が登録されていません</p>
                </div>
              }
            </div>
          </mat-tab>

          <mat-tab label="等級・報酬">
            <div class="tab-content">
              <div class="page-header">
                <h2>等級・標準報酬月額履歴</h2>
              </div>

              @if (grades().length > 0) {
                <table mat-table [dataSource]="grades()">
                  <ng-container matColumnDef="effectiveMonth">
                    <th mat-header-cell *matHeaderCellDef>適用月</th>
                    <td mat-cell *matCellDef="let g">{{ g.effectiveMonth }}</td>
                  </ng-container>
                  <ng-container matColumnDef="determinationType">
                    <th mat-header-cell *matHeaderCellDef>決定種別</th>
                    <td mat-cell *matCellDef="let g">{{ determinationTypeLabel(g.determinationType) }}</td>
                  </ng-container>
                  <ng-container matColumnDef="healthGrade">
                    <th mat-header-cell *matHeaderCellDef>健保等級</th>
                    <td mat-cell *matCellDef="let g">{{ g.healthGradeNumber }}等級 ({{ g.healthStandardRemuneration | number }}円)</td>
                  </ng-container>
                  <ng-container matColumnDef="pensionGrade">
                    <th mat-header-cell *matHeaderCellDef>厚年等級</th>
                    <td mat-cell *matCellDef="let g">{{ g.pensionGradeNumber }}等級 ({{ g.pensionStandardRemuneration | number }}円)</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="gradeColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: gradeColumns"></tr>
                </table>
              } @else {
                <div class="empty-state">
                  <p>等級情報が登録されていません</p>
                </div>
              }
            </div>
          </mat-tab>
        }
      </mat-tab-group>
    }
  `,
  styles: [`
    .page-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    h1, h2 { margin: 0; }
    h1 { font-size: 24px; }
    h3 { margin: 16px 0 8px; color: rgba(0, 0, 0, 0.6); }
    .tab-content { padding: 24px 0; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0 16px;
    }
    .full-width { width: 100%; }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: rgba(0, 0, 0, 0.54);
    }
    table { width: 100%; }
  `],
})
export class EmployeeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  saving = signal(false);
  offices = signal<Office[]>([]);
  departments = signal<Department[]>([]);
  isNew = true;
  private employeeId = '';
  private version = 0;

  dependents = signal<Dependent[]>([]);
  dependentColumns = ['name', 'relationship', 'birthDate', 'qualificationDate'];

  employments = signal<Employment[]>([]);
  employmentColumns = ['effectiveDate', 'employmentType', 'baseSalary', 'weeklyHours', 'socialInsurance'];

  grades = signal<Grade[]>([]);
  gradeColumns = ['effectiveMonth', 'determinationType', 'healthGrade', 'pensionGrade'];

  form: EmployeeForm = {
    employeeNumber: '',
    lastName: '',
    firstName: '',
    lastNameKana: '',
    firstNameKana: '',
    birthDate: '',
    gender: 'male',
    hireDate: '',
    officeId: '',
    healthInsuranceNumber: '',
    pensionNumber: '',
    basicPensionNumber: '',
    myNumber: '',
    address: '',
    memo: '',
  };

  ngOnInit() {
    this.loadOffices();
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isNew = false;
      this.employeeId = id;
      this.loadEmployee();
      this.loadDependents();
      this.loadEmployments();
      this.loadGrades();
    }
  }

  async loadOffices() {
    try {
      const fn = httpsCallable<any, any>(this.functions, 'officeList');
      const result = await fn({ companyId: this.auth.companyId });
      this.offices.set(result.data.items);
    } catch (e) {
      console.error('Failed to load offices', e);
    }
  }

  async loadEmployee() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employeeGet');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
      });
      const data = result.data;
      this.version = data.version;
      this.form = {
        employeeNumber: data.employeeNumber ?? '',
        lastName: data.lastName ?? '',
        firstName: data.firstName ?? '',
        lastNameKana: data.lastNameKana ?? '',
        firstNameKana: data.firstNameKana ?? '',
        birthDate: data.birthDate ?? '',
        gender: data.gender ?? 'male',
        hireDate: data.hireDate ?? '',
        officeId: data.officeId ?? '',
        healthInsuranceNumber: data.healthInsuranceNumber ?? '',
        pensionNumber: data.pensionNumber ?? '',
        basicPensionNumber: data.basicPensionNumber ?? '',
        myNumber: data.myNumber ?? '',
        address: data.address ?? '',
        memo: data.memo ?? '',
      };
    } catch (e) {
      console.error('Failed to load employee', e);
      this.snackBar.open('従業員データの取得に失敗しました', '閉じる', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  async loadDependents() {
    try {
      const fn = httpsCallable<any, any>(this.functions, 'dependentList');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        limit: 50,
      });
      this.dependents.set(result.data.dependents);
    } catch (e) {
      console.error('Failed to load dependents', e);
    }
  }

  async onSave() {
    this.saving.set(true);
    try {
      if (this.isNew) {
        const fn = httpsCallable<any, any>(this.functions, 'employeeCreate');
        const result = await fn({
          companyId: this.auth.companyId,
          ...this.form,
        });
        this.snackBar.open('従業員を登録しました', '閉じる', { duration: 3000 });
        this.router.navigate(['/employees', result.data.employeeId]);
      } else {
        const fn = httpsCallable<any, any>(this.functions, 'employeeUpdate');
        await fn({
          companyId: this.auth.companyId,
          employeeId: this.employeeId,
          expectedVersion: this.version,
          ...this.form,
        });
        this.version++;
        this.snackBar.open('従業員を更新しました', '閉じる', { duration: 3000 });
      }
    } catch (e) {
      console.error('Failed to save employee', e);
      this.snackBar.open('保存に失敗しました', '閉じる', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  async loadEmployments() {
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employmentList');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
      });
      this.employments.set(result.data.items ?? []);
    } catch (e) {
      console.error('Failed to load employments', e);
    }
  }

  async loadGrades() {
    try {
      const fn = httpsCallable<any, any>(this.functions, 'gradeList');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
      });
      this.grades.set(result.data.items ?? []);
    } catch (e) {
      console.error('Failed to load grades', e);
    }
  }

  employmentTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      regular: '正社員',
      partTime: 'パートタイム',
      contract: '契約社員',
    };
    return labels[type] ?? type;
  }

  determinationTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      regular: '定時決定',
      occasional: '随時改定',
      initial: '資格取得時決定',
      specific: '特定適用',
    };
    return labels[type] ?? type;
  }

  goBack() {
    this.router.navigate(['/employees']);
  }
}
