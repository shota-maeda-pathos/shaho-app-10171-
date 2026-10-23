import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './shared/layout/layout';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {
        path: 'employees',
        canActivate: [roleGuard('admin', 'operator')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/employees/employee-list/employee-list').then(
                (m) => m.EmployeeListComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/employees/employee-detail/employee-detail').then(
                (m) => m.EmployeeDetailComponent,
              ),
          },
        ],
      },
      {
        path: 'salary',
        canActivate: [roleGuard('admin', 'operator')],
        loadComponent: () =>
          import('./features/salary/salary-list/salary-list').then(
            (m) => m.SalaryListComponent,
          ),
      },
      {
        path: 'premium/monthly',
        canActivate: [roleGuard('admin', 'operator')],
        loadComponent: () =>
          import('./features/premium/premium-monthly/premium-monthly').then(
            (m) => m.PremiumMonthlyComponent,
          ),
      },
      {
        path: 'filings',
        canActivate: [roleGuard('admin', 'operator')],
        loadComponent: () =>
          import('./features/filings/filing-list/filing-list').then(
            (m) => m.FilingListComponent,
          ),
      },
      {
        path: 'approvals',
        canActivate: [roleGuard('admin', 'approver', 'operator')],
        loadComponent: () =>
          import('./features/approvals/approval-list/approval-list').then(
            (m) => m.ApprovalListComponent,
          ),
      },
      {
        path: 'settings',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./features/settings/user-management/user-management').then(
            (m) => m.UserManagementComponent,
          ),
      },
    ],
  },
];
