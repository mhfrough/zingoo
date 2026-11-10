/**
 * app.config.ts - application providers: router (with view transitions), HTTP client and the auth interceptor.
 * Owner: design-system session. Route changes never depend on painting a frame (see the view-transition guard below).
 */
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';

import { authInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';
import { prefersReducedMotion } from './ui/motion';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route `data` arrives as component inputs (used by the list page)
    // withViewTransitions: the page area cross-fades and rises on every route change (styles/components/motion.css).
    // The transition is skipped (so the new page still renders at once) when:
    //   - the user prefers reduced motion,
    //   - the tab is hidden or occluded and will not paint frames (a transition would wait for a frame that never comes),
    //   - or the browser has not started it within 400ms (watchdog).
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition, from, to }) => {
          // same route, only the query changed (a tab or filter): nothing to animate
          const samePage = from.routeConfig === to.routeConfig && from.routeConfig !== null;
          if (samePage || prefersReducedMotion() || document.visibilityState !== 'visible') {
            transition.skipTransition();
            return;
          }
          const watchdog = setTimeout(() => transition.skipTransition(), 400);
          transition.ready.then(() => clearTimeout(watchdog), () => clearTimeout(watchdog));
          transition.finished.finally(() => clearTimeout(watchdog));
        },
      }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
