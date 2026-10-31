import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { UserManagementComponent } from './user-management/user-management';
import { CompanySettingsComponent } from './company-settings/company-settings';
import { OfficeManagementComponent } from './office-management/office-management';
import { AuditLogComponent } from './audit-log/audit-log';
import { NotificationManagementComponent } from './notification-management/notification-management';
import { MockSubmissionSettingsComponent } from './mock-submission/mock-submission-settings';
import { PortalSettingsComponent } from './portal-settings/portal-settings';
import { RateManagementComponent } from './rate-management/rate-management';
import { DepartmentManagementComponent } from './department-management/department-management';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    MatTabsModule,
    UserManagementComponent,
    CompanySettingsComponent,
    OfficeManagementComponent,
    AuditLogComponent,
    NotificationManagementComponent,
    MockSubmissionSettingsComponent,
    PortalSettingsComponent,
    RateManagementComponent,
    DepartmentManagementComponent,
  ],
  template: `
    <div class="settings-container">
      <h1>設定</h1>
      <mat-tab-group>
        <mat-tab label="会社情報">
          <ng-template matTabContent><app-company-settings /></ng-template>
        </mat-tab>
        <mat-tab label="事業所管理">
          <ng-template matTabContent><app-office-management /></ng-template>
        </mat-tab>
        <mat-tab label="部署">
          <ng-template matTabContent><app-department-management /></ng-template>
        </mat-tab>
        <mat-tab label="ユーザー管理">
          <ng-template matTabContent><app-user-management /></ng-template>
        </mat-tab>
        <mat-tab label="お知らせ管理">
          <ng-template matTabContent><app-notification-management /></ng-template>
        </mat-tab>
        <mat-tab label="提出・承認">
          <ng-template matTabContent><app-mock-submission-settings /></ng-template>
        </mat-tab>
        <mat-tab label="料率">
          <ng-template matTabContent><app-rate-management /></ng-template>
        </mat-tab>
        <mat-tab label="本人ポータル">
          <ng-template matTabContent><app-portal-settings /></ng-template>
        </mat-tab>
        <mat-tab label="監査ログ">
          <ng-template matTabContent><app-audit-log /></ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .settings-container { padding: 24px; }
    h1 { margin: 0 0 24px; font-size: 24px; font-weight: 500; }
  `],
})
export class SettingsComponent {}
