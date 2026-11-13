import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';

/**
 * The bell's counts, shared app-wide: unread notices and open items waiting on this login. Pages call `refresh()`
 * after they change something, so the bell catches up without waiting for its timer.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private api = inject(ApiService);

  readonly unread = signal(0);
  readonly waiting = signal(0);
  private busy = false;

  refresh() {
    if (this.busy) return;
    this.busy = true;
    this.api.get<{ unread: number; waiting: number }>('notifications/counts').subscribe({
      next: (c) => {
        this.unread.set(c.unread);
        this.waiting.set(c.waiting);
        this.busy = false;
      },
      error: () => (this.busy = false),
    });
  }
}
