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
import { NAV, NAV_GROUPS, visibleNav } from '../portal.config';
import { IconComponent, Tag } from '../ui';
import { prefersReducedMotion } from '../ui/motion';

/** Sidebar + top bar around every portal page. Below 1100px the sidebar is a drawer. */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, Tag],
  templateUrl: './shell.html',
})
export class Shell {
  protected auth = inject(AuthService);
  private router = inject(Router);

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

  protected current = computed(() => NAV.find((n) => this.url().startsWith(`/admin/${n.path}`)));

  protected initial = computed(() => (this.auth.user()?.name ?? '?').charAt(0).toUpperCase());

  constructor() {
    // close the drawer after every navigation, and start the new page at the top (instantly, not smoothly)
    effect(() => {
      this.url();
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

  protected toTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
  }
}
