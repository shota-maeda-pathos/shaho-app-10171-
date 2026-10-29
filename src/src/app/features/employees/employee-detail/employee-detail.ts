import { EmployeeExemptionsComponent } from './employee-exemptions';
import { EmployeeLeavesComponent } from './employee-leaves';
import { EmployeeBonusComponent } from './employee-bonus';
import { Component, inject, signal, OnInit, WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatStepperModule } from '@angular/material/stepper';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatListModule } from '@angular/material/list';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';

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

interface Salary {
  id: string;
  yearMonth: string;
  baseSalary: number;
  totalFixedWage: number;
  totalVariableWage: number;
  totalSalary: number;
  isConfirmed: boolean;
}

interface Bonus {
  id: string;
  yearMonth: string;
  totalAmount: number;
  standardBonusAmount: number;
  isConfirmed: boolean;
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

interface OnboardResult {
  success: boolean;
  employeeId: string;
  employmentId: string;
  salaryId: string;
  gradeId: string | null;
  filingId: string | null;
  summary: {
    employee: string;
    employment: string;
    salary: string;
    grade: string | null;
    filing: string | null;
  };
}

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    EmployeeLeavesComponent, EmployeeExemptionsComponent, EmployeeBonusComponent,
    DecimalPipe, FormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatNativeDateModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatTabsModule, MatTableModule, MatDividerModule, MatDialogModule, MatChipsModule,
    MatStepperModule, MatCheckboxModule, MatListModule,
  ],
  template: `
    <div class="page-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h1>{{ isNew ? '従業員 新規登録' : '従業員 詳細' }}</h1>
      @if (!isNew) {
        <span class="spacer"></span>
        @if (employeeStatus() === 'resigned') {
          <mat-chip-set><mat-chip color="warn" highlighted>退職済</mat-chip></mat-chip-set>
        } @else {
          <button mat-stroked-button [routerLink]="['/employees', employeeId, 'revision']">
            <mat-icon>trending_up</mat-icon> 随時改定
          </button>
          <button mat-stroked-button color="primary" (click)="showTransferPanel = !showTransferPanel; showResignPanel = false">
            <mat-icon>swap_horiz</mat-icon> 異動
          </button>
          <button mat-stroked-button color="warn" (click)="showResignPanel = !showResignPanel; showTransferPanel = false">
            <mat-icon>exit_to_app</mat-icon> 退職
          </button>
        }
      }
    </div>

    @if (showResignPanel) {
      <mat-card class="action-panel warn-panel">
        <mat-card-content>
          <h3>退職処理</h3>
          <p class="panel-desc">退職日を設定すると退職処理を実行します。社会保険加入者の場合、資格喪失届が自動生成されます（資格喪失日＝退職日の翌日）。</p>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>退職日</mat-label>
              <input matInput [(ngModel)]="resignDate" name="resignDate" placeholder="YYYY-MM-DD" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="flex-grow">
              <mat-label>退職理由</mat-label>
              <input matInput [(ngModel)]="resignReason" name="resignReason" placeholder="自己都合、定年退職 等">
            </mat-form-field>
          </div>
          <div class="panel-actions">
            <button mat-flat-button color="warn" (click)="onResign()" [disabled]="resigning() || !resignDate">
              @if (resigning()) { <mat-spinner diameter="20"></mat-spinner> } @else { 退職処理を実行 }
            </button>
            <button mat-stroked-button (click)="showResignPanel = false">キャンセル</button>
          </div>
        </mat-card-content>
      </mat-card>
    }

    @if (showTransferPanel) {
      <mat-card class="action-panel">
        <mat-card-content>
          <h3>異動処理</h3>
          <p class="panel-desc">異動先事業所を選択してください。都道府県が変わる場合は保険料率が変更されます。</p>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>異動日</mat-label>
              <input matInput [(ngModel)]="transferDate" name="transferDate" placeholder="YYYY-MM-DD" required>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>異動先事業所</mat-label>
              <mat-select [(ngModel)]="transferOfficeId" name="transferOfficeId" required>
                @for (o of offices(); track o.id) {
                  @if (o.id !== form.officeId) {
                    <mat-option [value]="o.id">{{ o.name }}</mat-option>
                  }
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="flex-grow">
              <mat-label>異動理由</mat-label>
              <input matInput [(ngModel)]="transferReason" name="transferReason" placeholder="人事異動、組織再編 等">
            </mat-form-field>
          </div>
          <div class="panel-actions">
            <button mat-flat-button color="primary" (click)="onTransfer()" [disabled]="transferring() || !transferDate || !transferOfficeId">
              @if (transferring()) { <mat-spinner diameter="20"></mat-spinner> } @else { 異動処理を実行 }
            </button>
            <button mat-stroked-button (click)="showTransferPanel = false">キャンセル</button>
          </div>
        </mat-card-content>
      </mat-card>
    }

    @if (loading()) {
      <div class="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>
    } @else if (isNew) {
      @if (onboardResult()) {
        <mat-card class="onboard-complete">
          <mat-card-content>
            <div class="complete-header">
              <mat-icon class="complete-icon">check_circle</mat-icon>
              <h2>従業員登録と届出準備が完了しました</h2>
            </div>
            <p class="complete-desc">以下の処理が自動的に実行されました。社内承認・提出は、手続き画面から続けてください。</p>
            <a mat-stroked-button [routerLink]="['/procedures']" [queryParams]="{employeeId:onboardResult()!.employeeId}">承認・提出へ進む</a>
            <mat-list>
              <mat-list-item>
                <mat-icon matListItemIcon style="color:#2e7d32">person_add</mat-icon>
                <div matListItemTitle>従業員登録</div>
                <div matListItemLine>{{ onboardResult()!.summary.employee }}</div>
              </mat-list-item>
              <mat-list-item>
                <mat-icon matListItemIcon style="color:#1976d2">work</mat-icon>
                <div matListItemTitle>雇用条件</div>
                <div matListItemLine>{{ onboardResult()!.summary.employment }}</div>
              </mat-list-item>
              <mat-list-item>
                <mat-icon matListItemIcon style="color:#1976d2">payments</mat-icon>
                <div matListItemTitle>給与データ</div>
                <div matListItemLine>{{ onboardResult()!.summary.salary }}</div>
              </mat-list-item>
              @if (onboardResult()!.summary.grade) {
                <mat-list-item>
                  <mat-icon matListItemIcon style="color:#7b1fa2">grade</mat-icon>
                  <div matListItemTitle>等級決定</div>
                  <div matListItemLine>{{ onboardResult()!.summary.grade }}</div>
                </mat-list-item>
              }
              @if (onboardResult()!.summary.filing) {
                <mat-list-item>
                  <mat-icon matListItemIcon style="color:#e65100">description</mat-icon>
                  <div matListItemTitle>届出</div>
                  <div matListItemLine>{{ onboardResult()!.summary.filing }}</div>
                </mat-list-item>
              }
            </mat-list>
            <div class="complete-actions">
              <button mat-flat-button color="primary" (click)="goToEmployee()">
                <mat-icon>person</mat-icon> 従業員詳細を見る
              </button>
              @if (onboardResult()!.filingId) {
                <button mat-stroked-button (click)="goToFiling()">
                  <mat-icon>description</mat-icon> 届出を確認
                </button>
              }
              <button mat-stroked-button (click)="goToNewOnboard()">
                <mat-icon>person_add</mat-icon> 続けて登録
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-stepper linear #stepper>
          <mat-step label="基本情報">
            <mat-card>
              <mat-card-content>
                <div class="form-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>社員番号</mat-label>
                    <input matInput [(ngModel)]="form.employeeNumber" name="employeeNumber" required>
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
                    <input matInput [(ngModel)]="form.lastNameKana" name="lastNameKana" required>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>名（カナ）</mat-label>
                    <input matInput [(ngModel)]="form.firstNameKana" name="firstNameKana" required>
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
                    <input matInput [(ngModel)]="form.birthDate" name="birthDate" placeholder="YYYY-MM-DD">
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>入社日</mat-label>
                    <input matInput [(ngModel)]="form.hireDate" name="hireDate" placeholder="YYYY-MM-DD" required>
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
                <div class="step-actions">
                  <button mat-flat-button color="primary" matStepperNext
                    [disabled]="!form.employeeNumber || !form.lastName || !form.firstName || !form.hireDate || !form.officeId">
                    次へ：雇用条件 <mat-icon>arrow_forward</mat-icon>
                  </button>
                  <button mat-stroked-button (click)="goBack()">キャンセル</button>
                </div>
              </mat-card-content>
            </mat-card>
          </mat-step>

          <mat-step label="雇用条件・報酬">
            <mat-card>
              <mat-card-content>
                <div class="form-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>雇用形態</mat-label>
                    <mat-select [(ngModel)]="empForm.employmentType" name="employmentType" required>
                      <mat-option value="regular">正社員</mat-option>
                      <mat-option value="partTime">パートタイム</mat-option>
                      <mat-option value="contract">契約社員</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>基本給（月額）</mat-label>
                    <input matInput type="number" [(ngModel)]="empForm.baseSalary" name="baseSalary" required>
                    <span matTextSuffix>円</span>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>週所定労働時間</mat-label>
                    <input matInput type="number" [(ngModel)]="empForm.weeklyHours" name="weeklyHours" required>
                    <span matTextSuffix>時間</span>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>月所定労働日数</mat-label>
                    <input matInput type="number" [(ngModel)]="empForm.monthlyDays" name="monthlyDays" required>
                    <span matTextSuffix>日</span>
                  </mat-form-field>
                </div>
                <div class="checkbox-row">
                  <mat-checkbox [(ngModel)]="empForm.socialInsuranceEnrolled" name="socialInsurance">
                    社会保険に加入
                  </mat-checkbox>
                  <mat-checkbox [(ngModel)]="empForm.longTermCareEnrolled" name="longTermCare">
                    介護保険に加入（40歳以上65歳未満）
                  </mat-checkbox>
                </div>
                @if (empForm.socialInsuranceEnrolled) {
                  <div class="auto-info">
                    <mat-icon>info</mat-icon>
                    <span>登録と同時に、等級決定（入社時決定）と資格取得届が自動生成されます</span>
                  </div>
                }
                <div class="step-actions">
                  <button mat-flat-button color="primary" (click)="onOnboard()"
                    [disabled]="saving() || !empForm.baseSalary || empForm.baseSalary <= 0">
                    @if (saving()) {
                      <mat-spinner diameter="20"></mat-spinner>
                    } @else {
                      <mat-icon>check</mat-icon> 入社手続きを実行
                    }
                  </button>
                  <button mat-stroked-button matStepperPrevious>
                    <mat-icon>arrow_back</mat-icon> 戻る
                  </button>
                </div>
              </mat-card-content>
            </mat-card>
          </mat-step>
        </mat-stepper>
      }
    } @else {
      <mat-tab-group [selectedIndex]="initialTab" (selectedTabChange)="onTabChange($event.tab.textLabel)">
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
                      更新
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
            <ng-template matTabContent>
            @if (tabLoading()['扶養家族']) {
              <div class="loading"><mat-spinner diameter="32" /></div>
            } @else if (tabErrors()['扶養家族']) {
              <p role="alert">{{ tabErrors()['扶養家族'] }}</p>
              <button mat-stroked-button (click)="loadDependents()">再読み込み</button>
            } @else {
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
                      @if (tabMore()['扶養家族']) { <button mat-stroked-button (click)="loadDependents(true)">さらに読み込む</button> }
            }
            </ng-template>
          </mat-tab>

          <mat-tab label="雇用条件">
            <ng-template matTabContent>
            @if (tabLoading()['雇用条件']) {
              <div class="loading"><mat-spinner diameter="32" /></div>
            } @else if (tabErrors()['雇用条件']) {
              <p role="alert">{{ tabErrors()['雇用条件'] }}</p>
              <button mat-stroked-button (click)="loadEmployments()">再読み込み</button>
            } @else {
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
                      @if (tabMore()['雇用条件']) { <button mat-stroked-button (click)="loadEmployments(true)">さらに読み込む</button> }
            }
            </ng-template>
          </mat-tab>

          <mat-tab label="等級・報酬">
            <ng-template matTabContent>
            @if (tabLoading()['等級・報酬']) {
              <div class="loading"><mat-spinner diameter="32" /></div>
            } @else if (tabErrors()['等級・報酬']) {
              <p role="alert">{{ tabErrors()['等級・報酬'] }}</p>
              <button mat-stroked-button (click)="loadGrades()">再読み込み</button>
            } @else {
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
                      @if (tabMore()['等級・報酬']) { <button mat-stroked-button (click)="loadGrades(true)">さらに読み込む</button> }
            }
            </ng-template>
          </mat-tab>

          <mat-tab label="給与">
            <ng-template matTabContent>
            @if (tabLoading()['給与']) {
              <div class="loading"><mat-spinner diameter="32" /></div>
            } @else if (tabErrors()['給与']) {
              <p role="alert">{{ tabErrors()['給与'] }}</p>
              <button mat-stroked-button (click)="loadSalaries()">再読み込み</button>
            } @else {
            <div class="tab-content">
              <div class="page-header">
                <h2>月次給与一覧</h2>
              </div>

              @if (salaries().length > 0) {
                <table mat-table [dataSource]="salaries()">
                  <ng-container matColumnDef="yearMonth">
                    <th mat-header-cell *matHeaderCellDef>年月</th>
                    <td mat-cell *matCellDef="let s">{{ s.yearMonth }}</td>
                  </ng-container>
                  <ng-container matColumnDef="baseSalary">
                    <th mat-header-cell *matHeaderCellDef>基本給</th>
                    <td mat-cell *matCellDef="let s">{{ s.baseSalary | number }}円</td>
                  </ng-container>
                  <ng-container matColumnDef="totalSalary">
                    <th mat-header-cell *matHeaderCellDef>総支給額</th>
                    <td mat-cell *matCellDef="let s">{{ s.totalSalary | number }}円</td>
                  </ng-container>
                  <ng-container matColumnDef="isConfirmed">
                    <th mat-header-cell *matHeaderCellDef>状態</th>
                    <td mat-cell *matCellDef="let s">{{ s.isConfirmed ? '承認済' : '下書き' }}</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="salaryColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: salaryColumns"></tr>
                </table>
              } @else {
                <div class="empty-state">
                  <p>給与データが登録されていません</p>
                </div>
              }
            </div>
                      @if (tabMore()['給与']) { <button mat-stroked-button (click)="loadSalaries(true)">さらに読み込む</button> }
            }
            </ng-template>
          </mat-tab>

          <mat-tab label="休業">
            <ng-template matTabContent>
              <div class="tab-content"><app-employee-leaves [employeeId]="employeeId" /></div>
            </ng-template>
          </mat-tab>
          <mat-tab label="保険料免除">
            <ng-template matTabContent>
              <div class="tab-content"><app-employee-exemptions [employeeId]="employeeId" /></div>
            </ng-template>
          </mat-tab>
          <mat-tab label="賞与">
            <ng-template matTabContent>
            <div class="tab-content"><app-employee-bonus [employeeId]="employeeId" (changed)="loadBonuses()" /></div>
            @if (tabLoading()['賞与']) {
              <div class="loading"><mat-spinner diameter="32" /></div>
            } @else if (tabErrors()['賞与']) {
              <p role="alert">{{ tabErrors()['賞与'] }}</p>
              <button mat-stroked-button (click)="loadBonuses()">再読み込み</button>
            } @else {
            <div class="tab-content">
              <div class="page-header">
                <h2>賞与一覧</h2>
              </div>

              @if (bonuses().length > 0) {
                <table mat-table [dataSource]="bonuses()">
                  <ng-container matColumnDef="yearMonth">
                    <th mat-header-cell *matHeaderCellDef>支給年月</th>
                    <td mat-cell *matCellDef="let b">{{ b.yearMonth }}</td>
                  </ng-container>
                  <ng-container matColumnDef="totalAmount">
                    <th mat-header-cell *matHeaderCellDef>賞与総額</th>
                    <td mat-cell *matCellDef="let b">{{ b.totalAmount | number }}円</td>
                  </ng-container>
                  <ng-container matColumnDef="standardBonusAmount">
                    <th mat-header-cell *matHeaderCellDef>標準賞与額</th>
                    <td mat-cell *matCellDef="let b">{{ b.standardBonusAmount | number }}円</td>
                  </ng-container>
                  <ng-container matColumnDef="isConfirmed">
                    <th mat-header-cell *matHeaderCellDef>状態</th>
                    <td mat-cell *matCellDef="let b">{{ b.isConfirmed ? '承認済' : '下書き' }}</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="bonusColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: bonusColumns"></tr>
                </table>
              } @else {
                <div class="empty-state">
                  <p>賞与データが登録されていません</p>
                </div>
              }
            </div>
                      @if (tabMore()['賞与']) { <button mat-stroked-button (click)="loadBonuses(true)">さらに読み込む</button> }
            }
            </ng-template>
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
    .spacer { flex: 1; }
    .action-panel { margin-bottom: 16px; border-left: 4px solid #1976d2; }
    .action-panel.warn-panel { border-left-color: #f44336; }
    .action-panel h3 { margin: 0 0 8px; font-size: 16px; font-weight: 500; }
    .panel-desc { margin: 0 0 16px; color: rgba(0,0,0,.6); font-size: 13px; }
    .form-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
    .form-row mat-form-field { min-width: 200px; }
    .flex-grow { flex: 1; }
    .panel-actions { display: flex; gap: 12px; margin-top: 8px; }
    .step-actions { display: flex; gap: 12px; margin-top: 24px; }
    .checkbox-row { display: flex; gap: 24px; margin: 16px 0; }
    .auto-info { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #e8f5e9; border-radius: 8px; margin: 16px 0; font-size: 13px; color: #2e7d32; }
    .auto-info mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .onboard-complete { max-width: 640px; margin: 0 auto; }
    .complete-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .complete-header h2 { margin: 0; font-size: 20px; font-weight: 500; }
    .complete-icon { font-size: 36px; width: 36px; height: 36px; color: #2e7d32; }
    .complete-desc { margin: 0 0 16px; color: rgba(0,0,0,.6); font-size: 14px; }
    .complete-actions { display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }
  `],
})
export class EmployeeDetailComponent implements OnInit {
  office = inject(OfficeContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  saving = signal(false);
  resigning = signal(false);
  transferring = signal(false);
  employeeStatus = signal<string>('active');

  showResignPanel = false;
  showTransferPanel = false;
  resignDate = '';
  resignReason = '';
  transferDate = '';
  transferOfficeId = '';
  transferReason = '';
  offices = signal<Office[]>([]);
  departments = signal<Department[]>([]);
  isNew = true;
  employeeId = '';
  private version = 0;

  dependents = signal<Dependent[]>([]);
  dependentColumns = ['name', 'relationship', 'birthDate', 'qualificationDate'];

  employments = signal<Employment[]>([]);
  employmentColumns = ['effectiveDate', 'employmentType', 'baseSalary', 'weeklyHours', 'socialInsurance'];

  grades = signal<Grade[]>([]);
  gradeColumns = ['effectiveMonth', 'determinationType', 'healthGrade', 'pensionGrade'];

  salaries = signal<Salary[]>([]);
  salaryColumns = ['yearMonth', 'baseSalary', 'totalSalary', 'isConfirmed'];

  bonuses = signal<Bonus[]>([]);
  bonusColumns = ['yearMonth', 'totalAmount', 'standardBonusAmount', 'isConfirmed'];

  onboardResult = signal<OnboardResult | null>(null);
  empForm = {
    employmentType: 'regular' as 'regular' | 'partTime' | 'contract',
    baseSalary: 0,
    weeklyHours: 40,
    monthlyDays: 20,
    socialInsuranceEnrolled: true,
    longTermCareEnrolled: false,
  };

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
    if(this.office.selected()) this.form.officeId=this.office.selected();
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isNew = false;
      this.employeeId = id;
      const action = this.route.snapshot.queryParamMap.get('action');
      this.showResignPanel = action === 'loss'; this.showTransferPanel = action === 'transfer';
      this.initialTab = action === 'dependent_change' ? 1 : action === 'leave' ? 5 : 0;
      this.loadEmployee();
    }
  }

  tabLoading = signal<Record<string, boolean>>({});
  initialTab = 0;
  tabErrors = signal<Record<string, string>>({});
  tabMore = signal<Record<string, boolean>>({});
  private tabCursors: Record<string, string | null> = {};
  private async fetchHistory<T>(label: string, collection: string, store: WritableSignal<T[]>, append: boolean) {
    if (this.tabLoading()[label]) return;
    this.tabLoading.update(state => ({ ...state, [label]: true }));
    this.tabErrors.update(state => ({ ...state, [label]: '' }));
    try {
      const fn = httpsCallable<object, { items: T[]; hasMore: boolean; lastDocId: string | null }>(this.functions, collection === 'dependents' ? 'dependentList' : 'employeeHistoryList');
      const cursor = append ? this.tabCursors[label] : null;
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, collection, limit: 20, ...(cursor ? { lastDocId: cursor } : {}) });
      store.set(append ? [...store(), ...data.items] : data.items);
      this.tabCursors[label] = data.lastDocId ?? null;
      this.tabMore.update(state => ({ ...state, [label]: data.hasMore }));
      this.loadedTabs.add(label);
    } catch {
      this.loadedTabs.delete(label);
      this.tabErrors.update(state => ({ ...state, [label]: `${label}を取得できませんでした。再読み込みしてください。` }));
    } finally {
      this.tabLoading.update(state => ({ ...state, [label]: false }));
    }
  }

  private loadedTabs = new Set<string>();
  onTabChange(label: string) {
    if (this.isNew || this.loadedTabs.has(label)) return;
    const loaders: Record<string, () => Promise<void>> = {
      '扶養家族': () => this.loadDependents(), '雇用条件': () => this.loadEmployments(),
      '等級・報酬': () => this.loadGrades(), '給与': () => this.loadSalaries(), '賞与': () => this.loadBonuses(),
    };
    if (loaders[label]) { this.loadedTabs.add(label); void loaders[label](); }
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
      this.employeeStatus.set(data.status ?? 'active');
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

  async loadDependents(append = false) {
    await this.fetchHistory('扶養家族', 'dependents', this.dependents, append);
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
    } catch (e: any) {
      console.error('Failed to save employee', e);
      const detail = e?.message ?? e?.code ?? '';
      this.snackBar.open(`保存に失敗しました: ${detail}`, '閉じる', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  async onOnboard() {
    this.saving.set(true);
    try {
      const fn = httpsCallable<any, OnboardResult>(this.functions, 'employeeOnboard');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeNumber: this.form.employeeNumber,
        lastName: this.form.lastName,
        firstName: this.form.firstName,
        lastNameKana: this.form.lastNameKana,
        firstNameKana: this.form.firstNameKana,
        birthDate: this.form.birthDate,
        gender: this.form.gender,
        officeId: this.form.officeId,
        hireDate: this.form.hireDate,
        ...this.empForm,
      });
      this.onboardResult.set(result.data);
      this.snackBar.open('従業員を登録しました。続けて社内承認・提出を進めてください', '閉じる', { duration: 5000 });
    } catch (e: any) {
      const detail = e?.message ?? e?.code ?? '';
      this.snackBar.open(`入社手続きに失敗しました: ${detail}`, '閉じる', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  goToEmployee() {
    const result = this.onboardResult();
    if (result) this.router.navigate(['/employees', result.employeeId]);
  }

  goToFiling() {
    const result = this.onboardResult();
    if (result?.filingId) {
      this.router.navigate(['/filings', result.filingId]);
    }
  }

  goToNewOnboard() {
    this.onboardResult.set(null);
    this.form = {
      employeeNumber: '', lastName: '', firstName: '',
      lastNameKana: '', firstNameKana: '', birthDate: '',
      gender: 'male', hireDate: '', officeId: '',
      healthInsuranceNumber: '', pensionNumber: '',
      basicPensionNumber: '', myNumber: '', address: '', memo: '',
    };
    this.empForm = {
      employmentType: 'regular', baseSalary: 0,
      weeklyHours: 40, monthlyDays: 20,
      socialInsuranceEnrolled: true, longTermCareEnrolled: false,
    };
  }

  async loadEmployments(append = false) {
    await this.fetchHistory('雇用条件', 'employments', this.employments, append);
  }

  async loadGrades(append = false) {
    await this.fetchHistory('等級・報酬', 'grades', this.grades, append);
  }

  async loadSalaries(append = false) {
    await this.fetchHistory('給与', 'salaries', this.salaries, append);
  }

  async loadBonuses(append = false) {
    await this.fetchHistory('賞与', 'bonuses', this.bonuses, append);
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

  async onResign() {
    if (this.resigning() || !this.resignDate) return;
    this.resigning.set(true);
    try {
      const dateStr = this.resignDate.includes('T') ? this.resignDate : `${this.resignDate}T00:00:00.000Z`;
      const fn = httpsCallable<any, any>(this.functions, 'employeeResign');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        expectedVersion: this.version,
        resignationDate: dateStr,
        ...(this.resignReason ? { reason: this.resignReason } : {}),
      });
      this.version++;
      this.employeeStatus.set('resigned');
      this.showResignPanel = false;
      const msg = result.data?.summary?.filing
        ? `退職処理が完了しました。${result.data.summary.filing}`
        : '退職処理が完了しました。';
      this.snackBar.open(msg, '閉じる', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(`退職処理に失敗しました：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally {
      this.resigning.set(false);
    }
  }

  async onTransfer() {
    if (this.transferring() || !this.transferDate || !this.transferOfficeId) return;
    this.transferring.set(true);
    try {
      const dateStr = this.transferDate.includes('T') ? this.transferDate : `${this.transferDate}T00:00:00.000Z`;
      const fn = httpsCallable(this.functions, 'employeeTransfer');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        expectedVersion: this.version,
        newOfficeId: this.transferOfficeId,
        transferDate: dateStr,
        ...(this.transferReason ? { reason: this.transferReason } : {}),
      });
      this.version++;
      this.form.officeId = this.transferOfficeId;
      this.showTransferPanel = false;
      this.transferOfficeId = '';
      this.transferDate = '';
      this.transferReason = '';
      this.snackBar.open('異動処理が完了しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`異動処理に失敗しました：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally {
      this.transferring.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/employees']);
  }
}
