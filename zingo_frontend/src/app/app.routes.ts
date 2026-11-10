import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { pageGuard } from './core/page.guard';
import { NAV, pageKey } from './portal.config';

/** Pages that are built. Every other menu item still shows its "coming in phase N" placeholder. */
const BUILT: Record<string, () => Promise<unknown>> = {
  overview: () => import('./features/overview/overview').then((m) => m.Overview),
  manufacturing: () => import('./features/manufacturing/manufacturing').then((m) => m.Manufacturing),
  distribution: () => import('./features/distribution/distribution').then((m) => m.Distribution),
  finance: () => import('./features/finance/finance').then((m) => m.Finance),
  accounting: () => import('./features/accounting/accounting').then((m) => m.Accounting),
  pricing: () => import('./features/pricing/pricing').then((m) => m.Pricing),
  exports: () => import('./features/exports/exports').then((m) => m.Exports),
  ledger: () => import('./features/ledger/ledger').then((m) => m.Ledger),
  settings: () => import('./features/settings/settings').then((m) => m.Settings),
  users: () => import('./features/users/users').then((m) => m.Users),
  'partner-portal': () => import('./features/portal/portal').then((m) => m.Portal),
};

export const routes: Routes = [
  // Distributor Portal login (public)
  {
    path: 'admin/login',
    loadComponent: () => import('./pages/login').then((m) => m.Login),
  },

  // Distributor Portal (needs login)
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },

      {
        path: 'ui',
        loadComponent: () => import('./pages/ui-specimen').then((m) => m.UiSpecimen),
      },

      ...NAV.filter((n) => n.path !== 'ui').map((n) =>
        BUILT[n.path]
          ? { path: n.path, canActivate: [pageGuard(pageKey(n))], loadComponent: BUILT[n.path] as () => Promise<any> }
          : {
              path: n.path,
              canActivate: [pageGuard(pageKey(n))],
              loadComponent: () => import('./pages/coming-soon').then((m) => m.ComingSoon),
              data: { label: n.label, description: n.description, phase: n.phase, forms: n.forms, tables: n.tables },
            },
      ),
    ],
  },

  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  { path: '**', redirectTo: 'admin' },
];
