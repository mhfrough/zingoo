import {
  ChangeDetectionStrategy, Component, ElementRef, Injectable, ViewEncapsulation, effect, inject, signal, viewChild,
} from '@angular/core';
import { IconComponent, IconName } from './icon';

interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'danger' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly items = signal<ToastItem[]>([]);
  private nextId = 0;

  show(message: string, tone: ToastItem['tone'] = 'neutral') {
    const id = ++this.nextId;
    this.items.update((list) => [...list, { id, message, tone }]);
    setTimeout(() => this.dismiss(id), 4500);
  }

  success(message: string) {
    this.show(message, 'success');
  }

  error(message: string) {
    this.show(message, 'danger');
  }

  warning(message: string) {
    this.show(message, 'warning');
  }

  dismiss(id: number) {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}

const TONE_ICON: Record<ToastItem['tone'], IconName> = {
  neutral: 'info',
  success: 'check-circle',
  danger: 'circle-alert',
  warning: 'alert',
};

/**
 * Put one <app-toast-host /> in the root component.
 * The host is a popover (top layer), so a toast raised while a dialog is open still shows above it.
 * Each toast slides in from the right and slides out when dismissed (animate.enter / animate.leave).
 */
@Component({
  selector: 'app-toast-host',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div #host class="toast-host" popover="manual" role="status" aria-live="polite">
      @for (t of toast.items(); track t.id) {
        <div class="toast" [attr.data-tone]="t.tone" animate.enter="toast-in" animate.leave="toast-out">
          <app-icon [name]="icon(t.tone)" [size]="18" />
          <span>{{ t.message }}</span>
          <button type="button" class="btn btn-icon toast__close" data-variant="ghost" data-size="sm"
                  aria-label="Dismiss message" (click)="toast.dismiss(t.id)">
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected toast = inject(ToastService);
  private host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected icon = (tone: ToastItem['tone']) => TONE_ICON[tone];

  constructor() {
    // Re-open the popover whenever a toast arrives: the top layer is ordered by time, so this lifts the toasts above
    // any dialog that was opened after the last one.
    effect(() => {
      const count = this.toast.items().length;
      const el = this.host().nativeElement;
      if (count === 0 || typeof el.showPopover !== 'function') return;
      if (!el.matches(':popover-open')) el.showPopover();
      else if (document.querySelector('dialog[open]')) {
        el.hidePopover();
        el.showPopover();
      }
    });
  }
}
