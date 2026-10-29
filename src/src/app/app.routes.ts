import { Routes } from '@angular/router';
import { authGuard, roleGuard, portalGuard, homeGuard } from './core/guards/auth.guard';
import { PortalLayoutComponent } from './features/portal/portal-layout';
import { LayoutComponent } from './shared/layout/layout';

export const routes: Routes = [
  {path:'portal',component:PortalLayoutComponent,canActivate:[portalGuard],children:[
    {path:'',loadComponent:()=>import('./features/portal/portal').then(m=>m.PortalComponent)},
    {path:'payslip/:id',loadComponent:()=>import('./features/portal/portal-detail').then(m=>m.PortalDetailComponent)},
  ]},
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
    path: 'suspended',
    loadComponent: () =>
      import('./features/suspended/suspended').then((m) => m.SuspendedComponent),
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'dashboard', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'home',
        canActivate:[homeGuard],
        data: { title: 'ホーム' },
        loadComponent: () =>
          import('./features/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {path:'operations',canActivate:[roleGuard('admin','operator')],data:{title:'定例業務'},loadComponent:()=>import('./features/operations/operations').then(m=>m.OperationsComponent)},
      {path:'analytics',canActivate:[roleGuard('admin','operator','viewer')],data:{title:'集計・試算'},loadComponent:()=>import('./features/analytics/analytics').then(m=>m.AnalyticsComponent)},
      {
        path: 'employees',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '従業員' },
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
            data: { title: '従業員詳細' },
            loadComponent: () =>
              import('./features/employees/employee-detail/employee-detail').then(
                (m) => m.EmployeeDetailComponent,
              ),
          },
          {
            path: ':id/grade',
            data: { title: '等級決定' },
            loadComponent: () =>
              import('./features/employees/grade-decide/grade-decide').then(
                (m) => m.GradeDecideComponent,
              ),
          },
          {
            path: ':id/revision',
            data: { title: '随時改定' },
            loadComponent: () =>
              import('./features/employees/grade-revision/grade-revision').then(
                (m) => m.GradeRevisionComponent,
              ),
          },
        ],
      },
      {
        path: 'salary',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '給与' },
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
            data: { title: '給与編集' },
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
        data: { title: '保険料' },
        children: [
          {
            path: 'monthly',
            data: { title: '月額保険料' },
            loadComponent: () =>
              import('./features/premium/premium-monthly/premium-monthly').then(
                (m) => m.PremiumMonthlyComponent,
              ),
          },
          {
            path: 'collection',
            data: { title: '徴収' },
            loadComponent: () =>
              import('./features/premium/premium-collection/premium-collection').then(
                (m) => m.PremiumCollectionComponent,
              ),
          },
          {
            path: 'bonus',
            data: { title: '賞与保険料' },
            loadComponent: () =>
              import('./features/premium/premium-bonus/premium-bonus').then(
                (m) => m.PremiumBonusComponent,
              ),
          },
        ],
      },
      {
        path: 'procedures',
        canActivate: [roleGuard('admin', 'operator', 'approver')],
        data: { title: '手続き' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/procedures/procedure-list').then(
                (m) => m.ProcedureListComponent,
              ),
          },
            {
              path: 'new', canActivate: [roleGuard('admin', 'operator')], data: {title: '手続きを始める'},
              loadComponent: () => import('./features/procedures/procedure-start').then(m => m.ProcedureStartComponent),
            },
          {
            path: ':id',
            data: { title: '手続き詳細' },
            loadComponent: () =>
              import('./features/procedures/procedure-detail').then(
                (m) => m.ProcedureDetailComponent,
              ),
          },
        ],
      },
      {
        path: 'filings',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '届出' },
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
            data: { title: '届出詳細' },
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
        data: { title: '承認' },
        loadComponent: () =>
          import('./features/approvals/approval-list/approval-list').then(
            (m) => m.ApprovalListComponent,
          ),
      },
      {
        path: 'santei',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '算定' },
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
            data: { title: '算定詳細' },
            loadComponent: () =>
              import('./features/santei/santei-detail/santei-detail').then(
                (m) => m.SanteiDetailComponent,
              ),
          },
        ],
      },
      {
        path: 'simulation',
        canActivate: [roleGuard('admin', 'operator', 'viewer')],
        data: { title: 'シミュレーション' },
        loadComponent: () =>
          import('./features/simulation/simulation').then((m) => m.SimulationComponent),
      },
      {
        path: 'settings',
        canActivate: [roleGuard('admin')],
        data: { title: '設定' },
        loadComponent: () =>
          import('./features/settings/settings').then(
            (m) => m.SettingsComponent,
          ),
      },
    ],
  },
];
