import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { catchError, switchMap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  // Skip auth for login endpoint to avoid loops
  if (req.url.includes('/auth/token')) {
    return next(req);
  }

  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Token expired or invalid. Try to re-login automatically.
        return auth.login('demo', 'demo').pipe(
          switchMap((resp) => {
            // Retry the original request with the new token
            const newReq = req.clone({
              setHeaders: {
                Authorization: `Bearer ${resp.access_token}`,
              },
            });
            return next(newReq);
          }),
          catchError((loginErr) => {
            // If auto-login fails, propagate the error
            return throwError(() => loginErr);
          })
        );
      }
      return throwError(() => error);
    })
  );
};
