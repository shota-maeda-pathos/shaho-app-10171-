import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, Role } from '../services/auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.loading).pipe(
    filter(loading => !loading), take(1),
    map(() => {
      if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);
      const profile = auth.profile();
      if (profile?.isLoginDisabled) {
        auth.logout();
        return router.createUrlTree(['/login']);
      }
      // 退職などで閲覧のみになった本人は、ポータルだけ使える（停止の画面ではなくポータルへ戻す）
      if (profile?.isSuspended) return router.createUrlTree([profile.employeeId ? '/portal' : '/suspended']);
      return true;
    }),
  );
};

export const homeGuard:CanActivateFn=()=>{
  const auth=inject(AuthService),router=inject(Router);
  return toObservable(auth.loading).pipe(filter(loading=>!loading),take(1),map(()=>
    auth.profile()?.employeeId&&!auth.hasAnyRole('admin','operator','approver','viewer')?router.createUrlTree(['/portal']):true));
};

export function roleGuard(...requiredRoles: Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    return toObservable(auth.loading).pipe(
      filter(loading => !loading), take(1),
      map(() => {
        if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);
        const profile = auth.profile();
        if (profile?.isLoginDisabled) {
          auth.logout();
          return router.createUrlTree(['/login']);
        }
        // 退職などで閲覧のみになった本人は、ポータルだけ使える（停止の画面ではなくポータルへ戻す）
        if (profile?.isSuspended) return router.createUrlTree([profile.employeeId ? '/portal' : '/suspended']);
        return auth.hasAnyRole(...requiredRoles) ? true : router.createUrlTree(['/']);
      }),
    );
  };
}

export const portalGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.loading).pipe(
    filter(loading => !loading), take(1),
    map(() => {
      if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);
      const profile = auth.profile();
      if (profile?.isLoginDisabled) {
        auth.logout();
        return router.createUrlTree(['/login']);
      }
      if (!profile?.employeeId) return router.createUrlTree(['/']);
      return true;
    }),
  );
};
