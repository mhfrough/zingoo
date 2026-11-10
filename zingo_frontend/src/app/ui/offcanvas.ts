/**
 * offcanvas.ts - the off-canvas panel that slides in from the right edge and holds forms.
 * Owned by the design-system session. Modal stays for short alerts and confirms; forms use this.
 */
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, booleanAttribute, effect, inject,
  input, model, signal, untracked, viewChild,
} from '@angular/core';
import { ConfirmService } from './confirm';
import { IconComponent, IconName } from './icon';
import { tokenMs } from './motion';

let nextOffcanvasId = 0;

/**
 * Right-hand panel for forms: slides in and out, traps focus, Esc and a click on the backdrop close it, the footer
 * stays at the bottom while the body scrolls (with scroll-edge shadows).
 *
 *   <app-offcanvas [(open)]="show" title="New production batch" subtitle="B-1005" size="lg" [dirty]="form.dirty">
 *     <form id="batch-form" [formGroup]="form" class="form-grid">...</form>
 *     <ng-container offcanvasFooter>
 *       <button appBtn (click)="show.set(false)">Cancel</button>
 *       <button appBtn intent="save" type="submit" form="batch-form">Save batch</button>
 *     </ng-container>
 *   </app-offcanvas>
 *
 * Sizes: md = 32rem, lg = 50dvw (at least 36rem), xl = 70dvw; under 820px every size is full width.
 * While `dirty` is true, every way a person can close the panel (Esc, backdrop, the close button, Cancel buttons that
 * call `requestClose()`) first asks "Discard changes?" through ConfirmService and only closes on Discard.
 * Setting `open` to false from code (after a successful save) closes without asking.
 */
@Component({
  selector: 'app-offcanvas',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <dialog
      #dlg
      class="offcanvas"
      [attr.data-size]="size()"
      [attr.data-closing]="closing() ? '' : null"
      [attr.aria-labelledby]="titleId"
      (cancel)="onCancel($event)"
      (close)="open.set(false)"
      (click)="onBackdrop($event)"
    >
      <div class="offcanvas__panel">
        <header class="offcanvas__head">
          <div>
            <h2 [id]="titleId">{{ title() }}</h2>
            @if (subtitle()) {
              <p>{{ subtitle() }}</p>
            }
          </div>
          <button type="button" class="btn btn-icon" data-variant="ghost" data-size="sm" aria-label="Close panel"
                  (click)="requestClose()">
            <app-icon name="x" [size]="18" />
          </button>
        </header>
        <div class="offcanvas__body scroll-shadow"><ng-content /></div>
        <footer class="offcanvas__foot"><ng-content select="[offcanvasFooter]" /></footer>
      </div>
    </dialog>
  `,
})
export class Offcanvas {
  /** two-way: true shows the panel */
  readonly open = model(false);
  /** panel heading */
  readonly title = input.required<string>();
  /** small line under the heading (a record number, a distributor name) */
  readonly subtitle = input<string>();
  /** md = 32rem, lg = 50dvw, xl = 70dvw; full width on phones and small tablets */
  readonly size = input<'md' | 'lg' | 'xl'>('md');
  /** the form has unsaved changes: closing asks "Discard changes?" first */
  readonly dirty = input(false, { transform: booleanAttribute });
  /** CSS selector of the element that gets focus when the panel opens (default: the first control) */
  readonly focusSelector = input<string>();

  protected titleId = `offcanvas-title-${nextOffcanvasId++}`;
  protected closing = signal(false);

  private confirm = inject(ConfirmService);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private closeTimer?: ReturnType<typeof setTimeout>;
  private asking = false;

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
          this.closing.set(true);
          this.closeTimer = setTimeout(() => {
            if (el.open) el.close();
            this.closing.set(false);
          }, tokenMs(el, '--dur-base'));
        }
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.closeTimer));
  }

  /**
   * Close the panel the way a person would: asks "Discard changes?" first when `dirty` is true.
   * Resolves true when the panel closed. Call this from a Cancel button.
   */
  async requestClose(): Promise<boolean> {
    if (!this.open()) return true;
    if (this.dirty()) {
      if (this.asking) return false;
      this.asking = true;
      const discard = await this.confirm.discard();
      this.asking = false;
      if (!discard) return false;
    }
    this.open.set(false);
    return true;
  }

  private focusInitial(el: HTMLDialogElement) {
    const sel = this.focusSelector();
    queueMicrotask(() => {
      const target = sel ? el.querySelector<HTMLElement>(sel) : el.querySelector<HTMLElement>('.offcanvas__body :is(input, select, textarea, [role=combobox], [contenteditable]):not([disabled])');
      (target ?? el.querySelector<HTMLElement>('.offcanvas__head button'))?.focus();
    });
  }

  protected onCancel(event: Event) {
    event.preventDefault(); // Esc: go through requestClose (discard check + animated exit)
    void this.requestClose();
  }

  protected onBackdrop(event: MouseEvent) {
    if (event.target === this.dlg().nativeElement) void this.requestClose();
  }
}

export type { IconName };
