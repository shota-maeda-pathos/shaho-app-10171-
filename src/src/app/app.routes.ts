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
    ],
  },
];
