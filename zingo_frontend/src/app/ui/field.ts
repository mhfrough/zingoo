import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterEveryRender, booleanAttribute, computed,
  inject, input, signal,
} from '@angular/core';
import { IconComponent, IconName } from './icon';

let nextFieldId = 0;

/** Standard maximum lengths for free text, so every notes / description field counts the same way. */
export const TEXT_LIMITS = { title: 100, note: 500, description: 1000 } as const;

const CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
  'select',
  'textarea',
  '[contenteditable]',
  '[role="combobox"]',
].join(',');

/**
 * Label + control + hint/error. The label is wired to the control (for/id) and the hint, error and counter are
 * wired with aria-describedby, so a plain native control needs nothing extra:
 *
 *   <app-field label="Order date" [required]="true" hint="Defaults to today">
 *     <input type="date" formControlName="date" />
 *   </app-field>
 *
 * Existing inputs: label, hint, error, required, wide. New, all optional:
 *   float      floating label (smaller, floats up on focus or when filled)
 *   icon       leading icon inside the control
 *   success    green border + tick (use after the value passed its checks)
 *   counter    true = count characters (standard max 500); a number = that max; false = off.
 *              Left unset, a <textarea maxlength> still gets a counter. The count sits bottom-right inside the field,
 *              stays grey, turns orange from 80% and red from 95%.
 *   loading    skeleton in place of the control while the record loads
 */
@Component({
  selector: 'app-field',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'field',
    '[class.field--wide]': 'wide()',
    '[attr.data-float]': 'float() ? "" : null',
    '[attr.data-icon]': 'icon() ? "" : null',
    '[attr.data-state]': 'state()',
    '[attr.data-multiline]': 'multiline() ? "" : null',
    '[attr.data-loading]': 'loading() ? "" : null',
    '(click)': 'onClick($event)',
  },
  template: `
    <label class="field__label" [id]="labelId" [attr.for]="controlId()">
      {{ label() }}
      @if (required()) {
        <span class="field__req" aria-hidden="true">*</span>
      }
    </label>
    <div class="field__control">
      <ng-content />
      @if (loading()) {
        <span class="skeleton field__skeleton" aria-hidden="true"></span>
      }
      @if (icon(); as name) {
        <app-icon class="field__icon" [name]="name" [size]="18" />
      }
      @if (success() && !error()) {
        <app-icon class="field__status" name="check-circle" [size]="18" />
      }
      @if (max() > 0) {
        <span class="char-count" [id]="countId" [attr.data-level]="level()">{{ length() }} / {{ max() }}</span>
      }
    </div>
    @if (error()) {
      <span class="field__error" role="alert" [id]="msgId">
        <app-icon name="circle-alert" [size]="14" />{{ error() }}
      </span>
    } @else if (hint()) {
      <span class="field__hint" [id]="msgId">{{ hint() }}</span>
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  /** span both columns of a .form-grid */
  readonly wide = input(false, { transform: booleanAttribute });
  readonly float = input(false, { transform: booleanAttribute });
  readonly icon = input<IconName>();
  readonly success = input(false, { transform: booleanAttribute });
  readonly counter = input<boolean | number>();
  readonly loading = input(false, { transform: booleanAttribute });

  private readonly uid = nextFieldId++;
  protected readonly labelId = `field-${this.uid}-label`;
  protected readonly msgId = `field-${this.uid}-msg`;
  protected readonly countId = `field-${this.uid}-count`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected controlId = signal<string | null>(null);
  protected multiline = signal(false);
  protected max = signal(0);
  protected length = signal(0);

  protected state = computed(() => (this.error() ? 'error' : this.success() ? 'success' : null));
  protected level = computed(() => {
    const max = this.max();
    if (!max) return 'ok';
    const n = this.length();
    return n >= max ? 'full' : n / max >= 0.95 ? 'danger' : n / max >= 0.8 ? 'warn' : 'ok';
  });

  private control: HTMLElement | null = null;
  private ownedInvalid = false;
  private grow?: () => void;

  constructor() {
    // projected content can change at any time (@if, @for in the page), so re-check after every render pass
    afterEveryRender(() => this.sync());
  }

  /** clicking the label of a contenteditable / custom control moves focus into it */
  protected onClick(event: Event) {
    const target = event.target as HTMLElement;
    if (target.closest('.field__label') && this.control?.hasAttribute('contenteditable')) this.control.focus();
  }

  private sync() {
    const el = this.host.querySelector<HTMLElement>(
      CONTROL_SELECTOR.split(',').map((s) => `.field__control ${s}:not([data-field-skip])`).join(','),
    );
    if (el !== this.control) this.attach(el);
    const control = this.control;
    if (!control) return;

    // character count
    const count = this.counter();
    const isText = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement;
    let max = 0;
    if (isText && count !== false) {
      const attr = control.maxLength > 0 ? control.maxLength : 0;
      if (typeof count === 'number') max = count;
      else if (count === true) max = attr || TEXT_LIMITS.note;
      else if (control instanceof HTMLTextAreaElement) max = attr;
      if (max > 0 && control.maxLength !== max) control.maxLength = max;
    }
    if (this.max() !== max) this.max.set(max);
    const len = isText ? control.value.length : 0;
    if (this.length() !== len) this.length.set(len);

    // describedby / invalid / required
    this.setTokens(control, 'aria-describedby', [
      this.error() || this.hint() ? this.msgId : '',
      max > 0 ? this.countId : '',
    ]);
    if (this.error()) {
      if (control.getAttribute('aria-invalid') !== 'true') {
        control.setAttribute('aria-invalid', 'true');
        this.ownedInvalid = true;
      }
    } else if (this.ownedInvalid) {
      control.removeAttribute('aria-invalid');
      this.ownedInvalid = false;
    }
    if (this.required() && !control.hasAttribute('aria-required') && !(control as HTMLInputElement).required) {
      control.setAttribute('aria-required', 'true');
    }
    this.grow?.();
  }

  private attach(el: HTMLElement | null) {
    this.control = el;
    this.grow = undefined;
    this.ownedInvalid = false;
    if (!el) {
      this.controlId.set(null);
      this.multiline.set(false);
      return;
    }
    const editable = el.hasAttribute('contenteditable');
    if (!el.id) el.id = `field-${this.uid}-control`;
    if (editable) {
      this.controlId.set(null); // not a labelable element: name it with aria-labelledby instead
      this.setTokens(el, 'aria-labelledby', [this.labelId]);
    } else {
      this.controlId.set(el.id);
    }
    this.multiline.set(el instanceof HTMLTextAreaElement || editable);

    // the floating label needs :placeholder-shown, which needs a placeholder
    if (this.float() && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.placeholder) {
      el.placeholder = ' ';
    }

    // browsers without `field-sizing: content` (Firefox): grow the textarea by hand
    if (el instanceof HTMLTextAreaElement && !CSS.supports('field-sizing', 'content')) {
      this.grow = () => {
        el.style.blockSize = 'auto';
        el.style.blockSize = `${Math.min(el.scrollHeight + 2, 256)}px`;
      };
      el.addEventListener('input', this.grow);
    }
  }

  /** keep ids of other describers that the page added itself, only manage our own */
  private setTokens(el: HTMLElement, attr: string, own: string[]) {
    const ours = new Set([this.msgId, this.countId, this.labelId]);
    const others = (el.getAttribute(attr) ?? '').split(/\s+/).filter((t) => t && !ours.has(t));
    const next = [...others, ...own.filter(Boolean)].join(' ');
    if (next) {
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    } else if (el.hasAttribute(attr)) {
      el.removeAttribute(attr);
    }
  }
}
