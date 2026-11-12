import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterLink, RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { SettingsStore } from '../core/settings.store';
import { NAV, NAV_GROUPS, homePath, visibleNav } from '../portal.config';
import { errorText } from '../shared/errors';
import { CONNECTION_STATUS, ConnectionStatus, IconComponent, Tag, ToastService } from '../ui';
import { ViewAsOption } from '../core/auth.service';
import { prefersReducedMotion } from '../ui/motion';

/** Sidebar + top bar around every portal page. Below 1100px the sidebar is a drawer. */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, Tag, ConnectionStatus],
  templateUrl: './shell.html',
})
export class Shell {
  protected auth = inject(AuthService);
  /** loads the company settings and pick-lists once after sign-in, so every page and form can use them */
  private store = inject(SettingsStore);
  private router = inject(Router);

  /** realtime connection state for the top bar pill (hidden until the platform layer provides CONNECTION_STATUS) */
  protected conn = inject(CONNECTION_STATUS, { optional: true });

  private toast = inject(ToastService);
  /** an Admin can preview the app as another login; while previewing, a banner offers the way back */
  protected viewing = computed(() => !!this.auth.user()?.viewAs);
  protected viewAsOptions = signal<ViewAsOption[]>([]);
  protected viewAsGroups = computed(() => {
    const by = new Map<string, ViewAsOption[]>();
    for (const o of this.viewAsOptions()) if (o.id !== this.auth.user()?.id) by.set(o.role, [...(by.get(o.role) ?? []), o]);
    return [...by.entries()].map(([role, users]) => ({ role, users }));
  });

  protected navOpen = signal(false);
  /** page has scrolled under the top bar */
  protected scrolled = signal(false);
  /** page has scrolled about a screen: show the back-to-top button */
  protected showTop = signal(false);
  /** a lazy page chunk is loading */
  protected loadingPage = signal(false);

  /** menu groups, limited to the pages this role may open (empty groups are dropped) */
  protected groups = computed(() => {
    const items = visibleNav(this.auth.user()?.pages);
    return NAV_GROUPS.map((name) => ({ name, items: items.filter((n) => n.group === name) })).filter(
      (g) => g.items.length,
    );
  });

  private url = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );

  /** the page path without ?query, so switching a tab does not scroll the page back to the top */
  private path = computed(() => this.url().split('?')[0].split('#')[0]);

  protected current = computed(() => NAV.find((n) => this.url().startsWith(`/admin/${n.path}`)));

  protected initial = computed(() => (this.auth.user()?.name ?? '?').charAt(0).toUpperCase());

  constructor() {
    // close the drawer after every navigation, and start the new page at the top (instantly, not smoothly)
    effect(() => {
      this.path();
      this.navOpen.set(false);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });

    // scroll state, read at most once per frame
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        this.scrolled.set(y > 4);
        this.showTop.set(y > 480);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) this.loadingPage.set(true);
      else if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        this.loadingPage.set(false);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      sub.unsubscribe();
    });
  }

  /** the logins to preview, loaded once for an Admin */
  protected loadViewAs() {
    if (this.viewAsOptions().length || this.auth.user()?.role !== 'Admin' || this.viewing()) return;
    this.auth.viewAsOptions().subscribe({ next: (o) => this.viewAsOptions.set(o), error: () => {} });
  }

  protected switchTo(select: HTMLSelectElement) {
    const id = select.value;
    select.value = '';
    if (!id) return;
    this.auth.viewAs(id).subscribe({
      // a full reload so every page and store reads with the new login
      next: (res) => location.assign(homePath(res.user.pages)),
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected backToOwn() {
    this.auth.backToOwn();
    location.assign('/admin/settings');
  }

  protected toTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
  }
}
