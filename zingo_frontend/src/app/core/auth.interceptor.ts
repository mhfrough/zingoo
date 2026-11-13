import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { NotificationCenter } from '../layout/notification-center';

let bellTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Adds the JWT to every API call; logs out when the server says 401. After any saved change the bell's counts are
 * refreshed (a change usually tells someone, or answers something that was waiting).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const injector = inject(Injector);
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const token = auth.token;
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  const change = req.method !== 'GET' && !/\/(auth|notifications)\//.test(req.url);
  return next(authed).pipe(
    tap((ev) => {
      if (!change || !(ev instanceof HttpResponse)) return;
      clearTimeout(bellTimer);
      bellTimer = setTimeout(() => injector.get(NotificationCenter).refresh(), 400);
    }),
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.endsWith('/auth/login')) auth.logout();
      return throwError(() => err);
    }),
  );
};
