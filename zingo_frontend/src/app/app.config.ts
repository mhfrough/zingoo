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
    // withViewTransitions: the page area cross-fades and rises on every route change (styles/components/motion.css);
    // with prefers-reduced-motion the transition is skipped altogether.
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        onViewTransitionCreated: ({ transition }) => {
          if (prefersReducedMotion()) transition.skipTransition();
        },
      }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
