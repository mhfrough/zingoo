import {
  ChangeDetectionStrategy, Component, Injectable, ViewEncapsulation, computed, inject, signal,
} from '@angular/core';
import { Btn } from './button';
import { IconName } from './icon';
import { Modal } from './modal';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red badge and a solid red button, for deletes and anything that cannot be undone */
  tone?: 'danger' | 'primary';
  /** badge icon; defaults to a trash can for danger and an info mark otherwise */
  icon?: IconName;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'danger' | 'primary';
  icon: IconName;
  resolve: (ok: boolean) => void;
}

/**
 * Ask before anything destructive:
 *
 *   if (await this.confirm.ask({ title: 'Delete batch B-1004?', message: 'This cannot be undone.', confirmLabel: 'Delete batch', tone: 'danger' })) { ... }
 *
 * Name the verb and the object on the button ("Delete batch", not "OK"). One <app-confirm-host /> lives in the root
 * component. Esc, a click outside and the Cancel button answer false. For a danger dialog focus starts on Cancel, so a
 * stray Enter never deletes; for any other tone focus starts on the confirm button.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState | null>(null);

  ask(opts: ConfirmOptions): Promise<boolean> {
    this.answer(false); // a dialog still open is cancelled, never left hanging
    return new Promise((resolve) => {
      const tone = opts.tone ?? 'primary';
      this.state.set({
        message: '',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        ...opts,
        tone,
        icon: opts.icon ?? (tone === 'danger' ? 'trash' : 'info'),
        resolve,
      });
    });
  }

  answer(ok: boolean) {
    const s = this.state();
    if (!s) return; // already answered (the dialog also reports "closed" after an answer)
    this.state.set(null);
    s.resolve(ok);
  }
}

@Component({
  selector: 'app-confirm-host',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal, Btn],
  template: `
    @let v = last();
    <app-modal
      variant="alert"
      size="sm"
      focusSelector="[data-autofocus]"
      [title]="v?.title ?? ''"
      [tone]="v?.tone ?? 'primary'"
      [alertIcon]="v?.icon ?? 'info'"
      [open]="!!s()"
      (openChange)="!$event && svc.answer(false)"
    >
      @if (v?.message) {
        <p>{{ v!.message }}</p>
      }
      <ng-container modalFooter>
        <button appBtn type="button" [attr.data-autofocus]="v?.tone === 'danger' ? '' : null" (click)="svc.answer(false)">
          {{ v?.cancelLabel }}
        </button>
        <button
          appBtn
          type="button"
          [variant]="v?.tone === 'danger' ? 'danger-solid' : 'primary'"
          [icon]="v?.tone === 'danger' ? 'trash' : 'check'"
          [attr.data-autofocus]="v?.tone === 'danger' ? null : ''"
          (click)="svc.answer(true)"
        >
          {{ v?.confirmLabel }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ConfirmHost {
  protected svc = inject(ConfirmService);
  protected s = this.svc.state;
  private latest: ConfirmState | null = null;
  /** the last question asked: kept while the dialog animates out, so its text does not vanish mid-exit */
  protected last = computed(() => {
    const s = this.svc.state();
    if (s) this.latest = s;
    return this.latest;
  });
}
