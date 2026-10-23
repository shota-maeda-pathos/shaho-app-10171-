import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './shared/layout/layout';

export const routes: Routes = [
  {
    path: 'onboard/:token',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/onboard/onboard-form').then((m) => m.OnboardFormComponent),
      },
      {
        path: 'confirm',
        loadComponent: () =>
          import('./features/onboard/onboard-confirm').then((m) => m.OnboardConfirmComponent),
      },
      {
        path: 'complete',
        loadComponent: () =>
          import('./features/onboard/onboard-complete').then((m) => m.OnboardCompleteComponent),
      },
    ],
  },
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
          {
            path: ':id/grade',
            loadComponent: () =>
              import('./features/employees/grade-decide/grade-decide').then(
                (m) => m.GradeDecideComponent,
              ),
          },
        ],
      },
      {
        path: 'salary',
        canActivate: [roleGuard('admin', 'operator')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/salary/salary-list/salary-list').then(
                (m) => m.SalaryListComponent,
              ),
          },
          {
            path: ':employeeId',
            loadComponent: () =>
              import('./features/salary/salary-edit/salary-edit').then(
                (m) => m.SalaryEditComponent,
              ),
          },
        ],
      },
      {
        path: 'premium',
        canActivate: [roleGuard('admin', 'operator')],
        children: [
          {
            path: 'monthly',
            loadComponent: () =>
              import('./features/premium/premium-monthly/premium-monthly').then(
                (m) => m.PremiumMonthlyComponent,
              ),
          },
          {
            path: 'collection',
            loadComponent: () =>
              import('./features/premium/premium-collection/premium-collection').then(
                (m) => m.PremiumCollectionComponent,
              ),
          },
        ],
      },
      {
        path: 'filings',
        canActivate: [roleGuard('admin', 'operator')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/filings/filing-list/filing-list').then(
                (m) => m.FilingListComponent,
              ),
          },
          {
            path: ':filingId',
            loadComponent: () =>
              import('./features/filings/filing-detail/filing-detail').then(
                (m) => m.FilingDetailComponent,
              ),
          },
        ],
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
        path: 'santei',
        canActivate: [roleGuard('admin', 'operator')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/santei/santei-list/santei-list').then(
                (m) => m.SanteiListComponent,
              ),
          },
          {
            path: ':employeeId',
            loadComponent: () =>
              import('./features/santei/santei-detail/santei-detail').then(
                (m) => m.SanteiDetailComponent,
              ),
          },
        ],
      },
      {
        path: 'portal',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/portal/portal').then((m) => m.PortalComponent),
          },
          {
            path: 'payslip/:id',
            loadComponent: () =>
              import('./features/portal/portal-detail').then((m) => m.PortalDetailComponent),
          },
        ],
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
