import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DoCheck, ElementRef, ViewEncapsulation, inject, input, signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { caretAfter, cleanMoney, countSignificant, formatMoney, groupMoney, parseMoney } from '../shared/money-format';

/**
 * Amount input that adds thousands commas as you type: 1500000 shows as 1,500,000. Works with formControlName,
 * formControl and ngModel; the value is a plain number (or null when empty), never the text with commas.
 *
 *   <app-field label="Amount"><app-money-input formControlName="amount" /></app-field>
 *   <app-field label="Rate per pack"><app-money-input formControlName="rate" [decimals]="4" /></app-field>
 *   <app-money-input formControlName="share" currency="" />        <- no currency chip
 *
 * Only digits and one point can be typed or pasted; extra decimals are cut. The whole number is selected when the
 * field gets focus, so typing replaces it. Limits (min / max) are the form's job: use Validators.min.
 */
@Component({
  selector: 'app-money-input',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'money-input', '[class.money-input--bare]': '!currency()', '[attr.data-disabled]': 'disabled() ? "" : null' },
  template: `
    @if (currency()) {
      <span class="money-input__cur" aria-hidden="true">{{ currency() }}</span>
    }
    <input
      #input
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      [value]="text()"
      [attr.placeholder]="placeholder() || null"
      [attr.name]="name() || null"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [disabled]="disabled()"
      (input)="onInput($event)"
      (focus)="onFocus($event)"
      (mouseup)="onMouseUp($event)"
      (blur)="onBlur()"
    />
  `,
})
export class MoneyInput implements ControlValueAccessor, DoCheck {
  /** Currency chip at the start. Empty text shows no chip (for shares and counts). */
  readonly currency = input('PKR');
  /** Most decimals allowed: 2 for amounts, 4 to 6 for per-pack rates and exchange rates. */
  readonly decimals = input(2);
  readonly allowNegative = input(false);
  /** The biggest value allowed: typing more shows this value instead (a percent never goes over 100). */
  readonly max = input<number | null>(null);
  readonly placeholder = input('');
  readonly name = input('');
  /** Accessible name when the box has no visible label (a table cell, a ledger line). */
  readonly ariaLabel = input('');
  readonly forceInvalid = input(false);

  protected text = signal('');
  protected disabled = signal(false);

  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private selectOnMouseUp = false;
  private lastInvalid = false;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected invalid() {
    const c = this.ngControl;
    return this.forceInvalid() || !!(c && c.invalid && c.touched);
  }

  /** the form can become invalid / touched without this component hearing about it (a failed submit): follow it */
  ngDoCheck() {
    const v = this.invalid();
    if (v !== this.lastInvalid) {
      this.lastInvalid = v;
      this.cdr.markForCheck();
    }
  }

  protected onInput(event: Event) {
    const el = event.target as HTMLInputElement;
    const raw = el.value;
    let significant = countSignificant(raw, el.selectionStart ?? raw.length);
    const clean = cleanMoney(raw, this.decimals(), this.allowNegative());
    let shown = groupMoney(clean);
    // a typed "." in an empty box becomes "0." (a "0" was added in front of the caret)
    if (raw.replace(/[^\d.]/g, '').startsWith('.') && clean.replace('-', '').startsWith('0.')) significant++;
    let value = parseMoney(shown);
    const max = this.max();
    const clamped = max !== null && value !== null && value > max;
    if (clamped) {
      value = max;
      shown = formatMoney(max, this.decimals());
    }
    if (el.value !== shown) {
      el.value = shown;
      const at = clamped ? shown.length : caretAfter(shown, significant);
      el.setSelectionRange(at, at);
    }
    this.text.set(shown);
    this.onChange(value);
  }

  /** select all on focus so typing replaces the number; the mouse-up that ends the click must not undo it */
  protected onFocus(event: FocusEvent) {
    const el = event.target as HTMLInputElement;
    this.selectOnMouseUp = true;
    el.select();
  }

  protected onMouseUp(event: MouseEvent) {
    if (!this.selectOnMouseUp) return;
    this.selectOnMouseUp = false;
    event.preventDefault();
  }

  /** on leaving the field, drop a trailing point ("12." -> "12") */
  protected onBlur() {
    this.selectOnMouseUp = false;
    const el = this.inputEl().nativeElement;
    const tidy = formatMoney(parseMoney(el.value), this.decimals());
    if (tidy !== el.value) el.value = tidy;
    this.text.set(tidy);
    this.onTouched();
    this.cdr.markForCheck();
  }

  writeValue(v: number | string | null | undefined) {
    const n = v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
    const text = formatMoney(n, this.decimals());
    this.text.set(text);
    // the input keeps what was typed until the binding changes it; make sure a reset to the same text still shows
    try {
      const el = this.inputEl().nativeElement;
      if (el.value !== text) el.value = text;
    } catch {
      // the view is not created yet: the [value] binding writes it on the first render
    }
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: number | null) => void) {
    this.onChange = (v) => {
      fn(v);
      this.cdr.markForCheck();
    };
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.disabled.set(disabled);
    this.cdr.markForCheck();
  }
}
