import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, RouteReuseStrategy, TitleStrategy } from '@angular/router';
import { OfficeRouteReuseStrategy } from './core/services/office-route-reuse';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, getFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { provideFunctions, getFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/services/error-handler.service';
import { PageTitleStrategy } from './core/services/page-title.strategy';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { IsoStringDateAdapter, ISO_DATE_FORMATS } from './shared/ui/date-adapter';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes),
    {provide:RouteReuseStrategy,useClass:OfficeRouteReuseStrategy},
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    provideAnimationsAsync(),
    // 日付の入力は Material の日付ピッカー。値は今までどおり「YYYY-MM-DD」の文字列
    { provide: DateAdapter, useClass: IsoStringDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: ISO_DATE_FORMATS },
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useEmulators) {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      }
      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();
      if (environment.useEmulators) {
        connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
      }
      return firestore;
    }),
    provideFunctions(() => {
      // 関数は Firestore と同じ東京（functions/src/config.ts の既定）
      const functions = getFunctions(getApp(), 'asia-northeast1');
      if (environment.useEmulators) {
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      }
      return functions;
    }),
  ],
};
