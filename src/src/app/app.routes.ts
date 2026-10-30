import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
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
    data: { title: '入社の手続き' },
    loadComponent: () =>
      import('./features/onboard/onboard-form').then((m) => m.OnboardFormComponent),
  },
  {
    path: 'login',
    data: { title: 'ログイン' },
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
      {path:'monthly',canActivate:[roleGuard('admin','operator','approver')],data:{title:'毎月の処理'},loadComponent:()=>import('./features/monthly/monthly').then(m=>m.MonthlyComponent)},
      // 旧「定例業務」は毎月の処理に置き換え、賞与・算定への入口は「手続きを始める」に移した
      { path: 'operations', redirectTo: 'procedures/new', pathMatch: 'full' },
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
          // 入社は入社手続きのウィザードで行う（従業員詳細の新規登録は使わない）
          { path: 'new', redirectTo: '/onboarding/new', pathMatch: 'full' },
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
            // 旧い随時改定の画面。ウィザードへ移す
            path: ':id/revision',
            redirectTo: ({ params }) => inject(Router).createUrlTree(['/revisions', 'new'], { queryParams: { employeeId: params['id'] } }),
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
          // 旧い賞与保険料の画面は、賞与（一括型）に移した
          { path: 'bonus', redirectTo: '/bonus', pathMatch: 'full' },
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
        path: 'onboarding',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '入社手続き' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/onboarding/onboarding-list').then((m) => m.OnboardingListComponent),
          },
          {
            path: 'new',
            data: { title: '人が入社する' },
            loadComponent: () =>
              import('./features/onboarding/onboarding-start').then((m) => m.OnboardingStartComponent),
          },
          {
            path: ':id',
            data: { title: '入社手続き' },
            loadComponent: () =>
              import('./features/onboarding/onboarding-wizard').then((m) => m.OnboardingWizardComponent),
          },
        ],
      },
      {
        path: 'dependents/:id',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '扶養の手続き' },
        loadComponent: () =>
          import('./features/dependent-change/dependent-change-wizard').then((m) => m.DependentChangeWizardComponent),
      },
      {
        path: 'leaves/:id',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '産休・育休の手続き' },
        loadComponent: () =>
          import('./features/leave/leave-wizard').then((m) => m.LeaveWizardComponent),
      },
      {
        path: 'age-events/:id',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '年齢到達の手続き' },
        loadComponent: () =>
          import('./features/age-event/age-event-wizard').then((m) => m.AgeEventWizardComponent),
      },
      {
        path: 'revisions/:id',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '等級の見直し' },
        loadComponent: () =>
          import('./features/revision/revision-wizard').then((m) => m.RevisionWizardComponent),
      },
      {
        path: 'resignation/:id',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '退職手続き' },
        loadComponent: () =>
          import('./features/resignation/resignation-wizard').then((m) => m.ResignationWizardComponent),
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
      // 算定基礎届（一括型）。承認者も等級と届出の承認のために開く
      {path:'santei',canActivate:[roleGuard('admin','operator','approver')],data:{title:'算定基礎届'},loadComponent:()=>import('./features/santei/santei').then(m=>m.SanteiComponent)},
      {path:'bonus',canActivate:[roleGuard('admin','operator','approver')],data:{title:'賞与'},loadComponent:()=>import('./features/bonus/bonus').then(m=>m.BonusComponent)},
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
      {
        path: 'glossary',
        data: { title: '用語集' },
        loadComponent: () =>
          import('./features/glossary/glossary').then((m) => m.GlossaryComponent),
      },
      {
        path: 'ui-samples',
        canActivate: [roleGuard('admin', 'operator')],
        data: { title: '画面部品の見本' },
        loadComponent: () =>
          import('./features/ui-samples/ui-samples').then((m) => m.UiSamplesComponent),
      },
    ],
  },
];
