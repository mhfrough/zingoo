import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, ViewEncapsulation, computed,
  inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { IconComponent } from './icon';

/**
 * Number input with a minus / plus stepper. Works with formControlName, formControl and ngModel (value: number | null).
 *
 *   <app-field label="Cartons"><app-number-input formControlName="cartons" [min]="1" [max]="500" /></app-field>
 *
 * Arrow Up / Down and the mouse wheel stay native; the buttons repeat while held. They are out of the tab order
 * (the keys do the same job) but named for screen readers.
 */
@Component({
  selector: 'app-number-input',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'stepper', '[attr.data-disabled]': 'disabled() ? "" : null', '[attr.data-invalid]': 'invalid() ? "" : null' },
  template: `
    <button
      type="button"
      class="stepper__btn"
      tabindex="-1"
      aria-label="Decrease"
      [disabled]="disabled() || atMin()"
      (pointerdown)="press($event, -1)"
      (click)="click($event, -1)"
    >
      <app-icon name="minus" [size]="16" />
    </button>
    <input
      #input
      class="stepper__input"
      type="number"
      inputmode="decimal"
      [attr.min]="min() ?? null"
      [attr.max]="max() ?? null"
      [attr.step]="step()"
      [attr.placeholder]="placeholder() || null"
      [attr.name]="name() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [disabled]="disabled()"
      (input)="onInput($event)"
      (blur)="onBlur()"
    />
    <button
      type="button"
      class="stepper__btn"
      tabindex="-1"
      aria-label="Increase"
      [disabled]="disabled() || atMax()"
      (pointerdown)="press($event, 1)"
      (click)="click($event, 1)"
    >
      <app-icon name="plus" [size]="16" />
    </button>
  `,
})
export class NumberInput implements ControlValueAccessor {
  readonly min = input<number>();
  readonly max = input<number>();
  readonly step = input(1);
  readonly placeholder = input('');
  readonly name = input('');
  readonly forceInvalid = input(false);

  protected value = signal<number | null>(null);
  protected disabled = signal(false);
  protected atMin = computed(() => this.min() !== undefined && (this.value() ?? 0) <= this.min()!);
  protected atMax = computed(() => this.max() !== undefined && (this.value() ?? 0) >= this.max()!);

  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private holdTimer?: ReturnType<typeof setTimeout>;
  private holdRepeat?: ReturnType<typeof setInterval>;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected invalid() {
    const c = this.ngControl;
    return this.forceInvalid() || !!(c && c.invalid && c.touched);
  }

  // press and hold: first step now, then repeat after 400ms
  protected press(event: PointerEvent, dir: 1 | -1) {
    if (event.button !== 0) return;
    this.bump(dir);
    this.holdTimer = setTimeout(() => (this.holdRepeat = setInterval(() => this.bump(dir), 70)), 400);
    const stop = () => {
      this.stop();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  /** a mouse click was already handled by press(); a keyboard click (detail 0) steps once */
  protected click(event: MouseEvent, dir: 1 | -1) {
    if (event.detail === 0) this.bump(dir);
  }

  private stop() {
    clearTimeout(this.holdTimer);
    clearInterval(this.holdRepeat);
  }

  private bump(dir: 1 | -1) {
    const step = this.step();
    let next = Math.round(((this.value() ?? 0) + dir * step) * 1e6) / 1e6;
    if (this.min() !== undefined) next = Math.max(this.min()!, next);
    if (this.max() !== undefined) next = Math.min(this.max()!, next);
    this.set(next, true);
  }

  private set(v: number | null, emit: boolean) {
    this.value.set(v);
    this.inputEl().nativeElement.value = v === null ? '' : String(v);
    if (emit) this.onChange(v);
    this.cdr.markForCheck();
  }

  protected onInput(event: Event) {
    const el = event.target as HTMLInputElement;
    const v = el.value === '' || Number.isNaN(el.valueAsNumber) ? null : el.valueAsNumber;
    this.value.set(v);
    this.onChange(v);
  }

  /** on leaving the field, pull a typed value back inside min / max */
  protected onBlur() {
    const v = this.value();
    if (v !== null) {
      let c = v;
      if (this.min() !== undefined) c = Math.max(this.min()!, c);
      if (this.max() !== undefined) c = Math.min(this.max()!, c);
      if (c !== v) this.set(c, true);
    }
    this.onTouched();
    this.cdr.markForCheck();
  }

  writeValue(v: number | null | undefined) {
    const n = v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
    this.value.set(n);
    // the view may not exist yet when forms first write; a microtask runs after it is created
    queueMicrotask(() => {
      this.inputEl().nativeElement.value = n === null ? '' : String(n);
    });
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
