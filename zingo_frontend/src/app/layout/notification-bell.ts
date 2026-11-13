import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Tone, fmtDate } from '../shared/format';
import { IconComponent, Offcanvas, Tag } from '../ui';
import { NotificationCenter } from './notification-center';

export interface AppNotice {
  id: string;
  kind: string;
  tone: Tone;
  title: string;
  body: string | null;
  link: string | null;
  refNo: string | null;
  actorName: string | null;
  createdAt: string;
  read: boolean;
}

export interface WaitItem {
  kind: string;
  refNo: string;
  title: string;
  party: string;
  waitingOn: string;
  mine: boolean;
  since: string;
  link: string | null;
  tone: Tone;
}

/** how long ago, in words ("just now", "5 min ago", "3 h ago", "12 Nov 2026") */
function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return fmtDate(iso.slice(0, 10));
}

/**
 * The bell in the top bar, for every login. "Updates" are notices about what happened (newest first, unread
 * highlighted); "Waiting" lists every open request this login can see and who has to act on it. Counts refresh
 * every 45 seconds while the tab is visible, after every navigation and after any change on a page.
 */
@Component({
  selector: 'app-notification-bell',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, Offcanvas, Tag],
  styles: `
    .bell {
      position: relative;

      & .bell__badge {
        position: absolute;
        inset-block-start: 2px;
        inset-inline-end: 2px;
        min-inline-size: 1.15rem;
        block-size: 1.15rem;
        padding-inline: 0.3rem;
        border-radius: var(--radius-pill);
        background: var(--danger-solid);
        color: var(--on-accent);
        font-size: var(--text-2xs);
        font-weight: var(--weight-bold);
        line-height: 1.15rem;
        text-align: center;
        pointer-events: none;
      }
    }

    .notices {
      display: grid;
      gap: var(--space-3);

      & .notices__bar {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }

      & .notices__seg {
        display: inline-flex;
        padding: 2px;
        border-radius: var(--radius-md);
        background: var(--surface-sunken);

        & button {
          border: 0;
          background: transparent;
          color: var(--text-2);
          font: inherit;
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-sm);
          cursor: pointer;

          &[aria-pressed='true'] {
            background: var(--surface-card);
            color: var(--text);
            box-shadow: var(--elev-1);
          }

          &:focus-visible {
            outline: none;
            box-shadow: var(--focus-ring);
          }
        }
      }

      & .notices__spacer {
        flex: 1;
      }

      & .notices__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }

      & .notice {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--space-3);
        inline-size: 100%;
        text-align: start;
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-card);
        color: inherit;
        font: inherit;
        cursor: pointer;

        &:hover {
          border-color: var(--border-strong);
        }

        &:focus-visible {
          outline: none;
          box-shadow: var(--focus-ring);
        }

        &[data-unread] {
          background: var(--tone-info-bg);
          border-color: var(--tone-info-line);
        }

        &[data-mine] {
          border-inline-start: 3px solid var(--tone-warning-line);
        }
      }

      & .notice__dot {
        inline-size: 0.6rem;
        block-size: 0.6rem;
        margin-block-start: 0.35rem;
        border-radius: 50%;
        background: var(--tone-neutral-line);

        &[data-tone='success'] { background: var(--tone-success-fg); }
        &[data-tone='warning'] { background: var(--tone-warning-fg); }
        &[data-tone='danger'] { background: var(--tone-danger-fg); }
        &[data-tone='info'] { background: var(--tone-info-fg); }
      }

      & .notice__title {
        display: block;
        font-weight: var(--weight-semibold);
        line-height: var(--leading-snug);
      }

      & .notice__body {
        display: block;
        margin-block-start: var(--space-1);
        color: var(--text-2);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
      }

      & .notice__meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        margin-block-start: var(--space-2);
        color: var(--text-3);
        font-size: var(--text-xs);
      }

      & .notices__empty {
        padding: var(--space-8) var(--space-4);
        text-align: center;
        color: var(--text-3);
      }
    }
  `,
  template: `
    <button type="button" class="btn btn-icon bell" data-variant="ghost" (click)="toggle()"
            [attr.aria-label]="label()" [attr.title]="label()" aria-haspopup="dialog" [attr.aria-expanded]="open()">
      <app-icon name="bell" [size]="18" />
      @if (badge()) {
        <span class="bell__badge" aria-hidden="true">{{ badge() > 99 ? '99+' : badge() }}</span>
      }
    </button>

    <app-offcanvas [(open)]="open" title="Notifications" [subtitle]="subtitle()" size="md">
      <div class="notices">
        <div class="notices__bar">
          <div class="notices__seg" role="group" aria-label="Show">
            <button type="button" [attr.aria-pressed]="view() === 'updates'" (click)="view.set('updates')">
              Updates{{ center.unread() ? ' (' + center.unread() + ')' : '' }}
            </button>
            <button type="button" [attr.aria-pressed]="view() === 'waiting'" (click)="view.set('waiting'); loadWaiting()">
              Waiting{{ center.waiting() ? ' (' + center.waiting() + ' on you)' : '' }}
            </button>
          </div>
          <span class="notices__spacer"></span>
          @if (view() === 'updates' && center.unread()) {
            <button type="button" class="btn" data-size="sm" data-variant="ghost" (click)="readAll()">Mark all read</button>
          }
        </div>

        @if (view() === 'updates') {
          @if (items().length) {
            <ul class="notices__list">
              @for (n of items(); track n.id) {
                <li>
                  <button type="button" class="notice" [attr.data-unread]="n.read ? null : ''" (click)="openNotice(n)">
                    <span class="notice__dot" [attr.data-tone]="n.tone" aria-hidden="true"></span>
                    <span>
                      <span class="notice__title">{{ n.title }}</span>
                      @if (n.body) {
                        <span class="notice__body">{{ n.body }}</span>
                      }
                      <span class="notice__meta">
                        @if (!n.read) { <app-tag tone="info">New</app-tag> }
                        @if (n.refNo) { <span>{{ n.refNo }}</span> }
                        @if (n.actorName) { <span>by {{ n.actorName }}</span> }
                        <span>{{ ago(n.createdAt) }}</span>
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="notices__empty">{{ loading() ? 'Loading…' : 'No notifications yet. Requests, approvals, dispatches and claims show up here.' }}</p>
          }
        } @else {
          @if (waiting().length) {
            <ul class="notices__list">
              @for (w of waiting(); track w.kind + w.refNo) {
                <li>
                  <button type="button" class="notice" [attr.data-mine]="w.mine ? '' : null" (click)="go(w.link)" [disabled]="!w.link">
                    <span class="notice__dot" [attr.data-tone]="w.tone" aria-hidden="true"></span>
                    <span>
                      <span class="notice__title">{{ w.kind }} {{ w.refNo }}: {{ w.title }}</span>
                      <span class="notice__meta">
                        <app-tag [tone]="w.mine ? 'warning' : 'neutral'">{{ w.mine ? 'Waiting on you' : 'Waiting on ' + w.waitingOn }}</app-tag>
                        <span>{{ w.party }}</span>
                        <span>since {{ fmtDate(w.since) }}</span>
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="notices__empty">{{ loading() ? 'Loading…' : 'Nothing is open. Every request has an answer.' }}</p>
          }
        }
      </div>
    </app-offcanvas>
  `,
})
export class NotificationBell {
  private api = inject(ApiService);
  private router = inject(Router);
  protected center = inject(NotificationCenter);

  protected open = signal(false);
  protected view = signal<'updates' | 'waiting'>('updates');
  protected items = signal<AppNotice[]>([]);
  protected waiting = signal<WaitItem[]>([]);
  protected loading = signal(false);

  protected badge = computed(() => this.center.unread() + this.center.waiting());
  protected label = computed(() => {
    const u = this.center.unread();
    const w = this.center.waiting();
    const parts = [u && `${u} unread`, w && `${w} waiting on you`].filter(Boolean);
    return `Notifications${parts.length ? ` (${parts.join(', ')})` : ''}`;
  });
  protected subtitle = computed(() => (this.view() === 'updates' ? 'What happened on your requests and orders' : 'Open requests and who has to act'));

  protected ago = ago;
  protected fmtDate = fmtDate;

  constructor() {
    this.center.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.center.refresh();
    }, 45_000);
    const onVisible = () => document.visibilityState === 'visible' && this.center.refresh();
    document.addEventListener('visibilitychange', onVisible);
    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.center.refresh());
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      sub.unsubscribe();
    });
  }

  protected toggle() {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      // land on what needs the reader: unread updates first, else the open items on them
      if (!this.center.unread() && this.center.waiting()) this.view.set('waiting');
      this.loadUpdates();
      this.loadWaiting();
    }
  }

  private loadUpdates() {
    this.loading.set(true);
    this.api.get<{ items: AppNotice[]; unread: number }>('notifications', { limit: '50' }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.center.unread.set(r.unread);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected loadWaiting() {
    this.api.get<WaitItem[]>('notifications/waiting').subscribe({
      next: (w) => {
        this.waiting.set(w);
        this.center.waiting.set(w.filter((x) => x.mine).length);
      },
      error: () => {},
    });
  }

  protected readAll() {
    this.api.post<{ unread: number }>('notifications/read', {}).subscribe({
      next: (r) => {
        this.items.update((l) => l.map((n) => ({ ...n, read: true })));
        this.center.unread.set(r.unread);
      },
      error: () => {},
    });
  }

  protected openNotice(n: AppNotice) {
    if (!n.read) {
      this.items.update((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      this.center.unread.update((v) => Math.max(0, v - 1));
      this.api.post<{ unread: number }>('notifications/read', { ids: [n.id] }).subscribe({ next: (r) => this.center.unread.set(r.unread), error: () => {} });
    }
    this.go(n.link);
  }

  protected go(link: string | null) {
    if (!link) return;
    this.open.set(false);
    this.router.navigateByUrl(link);
  }
}
