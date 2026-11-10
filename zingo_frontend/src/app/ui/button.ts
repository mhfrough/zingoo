import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewEncapsulation, booleanAttribute, computed, effect,
  inject, input, isDevMode, signal, untracked,
} from '@angular/core';
import { IconComponent, IconName } from './icon';

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'danger-solid';

/** Ready-made look for the common actions: create = orange + plus, save = orange + check, delete = red + trash. */
const INTENTS = {
  create: { variant: 'primary', icon: 'plus' },
  save: { variant: 'primary', icon: 'check' },
  delete: { variant: 'danger', icon: 'trash' },
  confirm: { variant: 'primary', icon: 'check' },
  'confirm-delete': { variant: 'danger-solid', icon: 'trash' },
  send: { variant: 'primary', icon: 'send' },
  download: { variant: 'secondary', icon: 'download' },
  edit: { variant: 'secondary', icon: 'edit' },
} as const satisfies Record<string, { variant: BtnVariant; icon: IconName }>;

export type BtnIntent = keyof typeof INTENTS;

/**
 * <button appBtn variant="primary" icon="plus">Add batch</button>
 * Styling lives in styles/components/button.css (.btn + data-variant / data-size).
 *
 * Existing inputs (variant, size, icon, loading, block) are unchanged. New, all optional:
 *   intent     "create" | "save" | "delete" | ...  default variant + icon for the action; variant / icon win if given
 *   iconEnd    trailing icon, e.g. iconEnd="arrow-right" (nudges forward on hover)
 *   iconOnly   square button with just the icon: always add aria-label
 *   success    set true after a save: the button flashes green with a tick for ~1.4s
 *   size       'lg' (new) next to 'md' and 'sm'
 *   variant    'danger-solid' (new) is the solid red button
 * A loading button swallows clicks (also Enter on a focused submit button) and sets aria-busy.
 */
@Component({
  selector: 'button[appBtn], a[appBtn]',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'btn',
    '[class.btn-icon]': 'iconOnly()',
    '[attr.data-variant]': 'resolvedVariant()',
    '[attr.data-size]': 'size()',
    '[attr.data-block]': 'block() ? "" : null',
    '[attr.data-done]': 'done() ? "" : null',
    '[attr.aria-busy]': 'loading() ? "true" : null',
  },
  template: `
    @if (loading()) {
      <span class="btn__overlay" aria-hidden="true"><span class="spinner"></span></span>
    } @else if (done()) {
      <span class="btn__overlay btn__done" aria-hidden="true"><app-icon name="check" [size]="18" /></span>
    }
    <span class="btn__content">
      @if (resolvedIcon(); as name) {
        <app-icon class="btn__icon" [name]="name" [size]="16" />
      }
      @if (!iconOnly()) {
        <span class="btn__label"><ng-content /></span>
      }
      @if (iconEnd(); as name) {
        <app-icon class="btn__icon btn__icon--end" [name]="name" [size]="16" />
      }
    </span>
  `,
})
export class Btn implements OnDestroy {
  readonly variant = input<BtnVariant>();
  readonly size = input<'md' | 'sm' | 'lg'>('md');
  readonly icon = input<IconName>();
  readonly iconEnd = input<IconName>();
  readonly iconOnly = input(false, { transform: booleanAttribute });
  readonly intent = input<BtnIntent>();
  readonly loading = input(false, { transform: booleanAttribute });
  readonly block = input(false, { transform: booleanAttribute });
  /** flips to true after a successful save: shows the green flash, then resets itself */
  readonly success = input(false, { transform: booleanAttribute });

  protected resolvedVariant = computed<BtnVariant>(
    () => this.variant() ?? (this.intent() ? INTENTS[this.intent()!].variant : 'secondary'),
  );
  protected resolvedIcon = computed<IconName | undefined>(
    () => this.icon() ?? (this.intent() ? INTENTS[this.intent()!].icon : undefined),
  );

  protected done = signal(false);
  private doneTimer?: ReturnType<typeof setTimeout>;
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    // Block clicks while busy. Capture phase on the element itself runs before the page's (click) handler,
    // and preventDefault also stops a submit button from submitting twice.
    this.host.addEventListener(
      'click',
      (event) => {
        if (this.loading()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    effect(() => {
      const on = this.success();
      untracked(() => {
        clearTimeout(this.doneTimer);
        this.done.set(on);
        if (on) this.doneTimer = setTimeout(() => this.done.set(false), 1400);
      });
    });

    if (isDevMode()) {
      queueMicrotask(() => {
        if (this.iconOnly() && !this.host.getAttribute('aria-label') && !this.host.getAttribute('title')) {
          console.warn('[appBtn] icon-only button needs an aria-label', this.host);
        }
      });
    }
  }

  ngOnDestroy() {
    clearTimeout(this.doneTimer);
  }
}
