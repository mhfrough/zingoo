import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, effect, inject, input, model,
  signal, untracked, viewChild,
} from '@angular/core';
import { IconComponent, IconName } from './icon';
import { tokenMs } from './motion';

let nextId = 0;

/**
 * Native <dialog> modal (focus trap + Esc handled by the browser), with an animated entrance and exit.
 *
 *   <app-modal [(open)]="show" title="Record collection" subtitle="SO-201">
 *     <form id="f" class="form-grid">...</form>
 *     <ng-container modalFooter>
 *       <button appBtn (click)="show.set(false)">Cancel</button>
 *       <button appBtn variant="primary" type="submit" form="f">Save collection</button>
 *     </ng-container>
 *   </app-modal>
 *
 * New, optional: variant="alert" (compact confirm layout with an icon badge, used by ConfirmService),
 * tone, alertIcon, focusSelector (CSS selector of the element that gets focus when it opens).
 * Esc and a click on the backdrop close it through the same animated path as [(open)] = false.
 */
@Component({
  selector: 'app-modal',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <dialog
      #dlg
      class="modal"
      [attr.data-size]="size()"
      [attr.data-variant]="variant()"
      [attr.data-closing]="closing() ? '' : null"
      [attr.role]="variant() === 'alert' ? 'alertdialog' : null"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="variant() === 'alert' ? bodyId : null"
      (cancel)="onCancel($event)"
      (close)="open.set(false)"
      (click)="onBackdrop($event)"
    >
      <div class="modal__panel">
        <header>
          @if (variant() === 'alert') {
            <span class="modal__badge" [attr.data-tone]="tone()"><app-icon [name]="alertIcon()" [size]="22" /></span>
          }
          <div>
            <h2 [id]="titleId">{{ title() }}</h2>
            @if (subtitle()) {
              <p>{{ subtitle() }}</p>
            }
          </div>
          @if (variant() !== 'alert') {
            <button type="button" class="btn btn-icon" data-variant="ghost" data-size="sm" aria-label="Close dialog"
                    (click)="open.set(false)">
              <app-icon name="x" [size]="18" />
            </button>
          }
        </header>
        <div class="modal__body scroll-shadow" [id]="bodyId"><ng-content /></div>
        <footer><ng-content select="[modalFooter]" /></footer>
      </div>
    </dialog>
  `,
})
export class Modal {
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly variant = input<'default' | 'alert'>('default');
  readonly tone = input<'primary' | 'danger'>('primary');
  readonly alertIcon = input<IconName>('circle-alert');
  readonly focusSelector = input<string>();

  protected titleId = `modal-title-${nextId}`;
  protected bodyId = `modal-body-${nextId++}`;
  protected closing = signal(false);

  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private closeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const want = this.open();
      untracked(() => {
        const el = this.dlg().nativeElement;
        if (want) {
          clearTimeout(this.closeTimer);
          this.closing.set(false);
          if (!el.open) {
            el.showModal();
            this.focusInitial(el);
          }
        } else if (el.open && !this.closing()) {
          // play the exit, then really close
          this.closing.set(true);
          this.closeTimer = setTimeout(() => {
            if (el.open) el.close();
            this.closing.set(false);
          }, tokenMs(el, '--dur-fast'));
        }
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.closeTimer));
  }

  /** the browser would focus the first control; let the caller pick a safer one (Cancel on a delete) */
  private focusInitial(el: HTMLDialogElement) {
    const sel = this.focusSelector();
    if (!sel) return;
    queueMicrotask(() => el.querySelector<HTMLElement>(sel)?.focus());
  }

  protected onCancel(event: Event) {
    event.preventDefault(); // Esc: go through the animated close instead of an instant one
    this.open.set(false);
  }

  protected onBackdrop(event: MouseEvent) {
    if (event.target === this.dlg().nativeElement) this.open.set(false);
  }
}
