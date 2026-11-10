import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { homePath } from '../portal.config';
import { AuthService } from './auth.service';

/**
 * Keeps a role out of pages it cannot open (the server refuses the data anyway).
 * `page` is the page key from the server's role table: overview, manufacturing, finance ...
 */
export const pageGuard =
  (page: string): CanActivateFn =>
  () => {
    const pages = inject(AuthService).user()?.pages;
    return !pages || pages.includes(page) ? true : inject(Router).createUrlTree([homePath(pages)]);
  };
