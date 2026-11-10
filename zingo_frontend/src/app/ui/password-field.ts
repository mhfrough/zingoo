import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, ViewEncapsulation, inject, input, signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { IconComponent } from './icon';

/**
 * Password input with a show / hide eye. Works with formControlName, formControl and ngModel.
 * Put it inside <app-field> so it gets the label, hint and error:
 *
 *   <app-field label="Password" [float]="true" icon="lock" [error]="...">
 *     <app-password-field formControlName="password" autocomplete="current-password" />
 *   </app-field>
 *
 * The toggle is a real <button aria-pressed>, reachable with Tab and Space / Enter. Its name stays "Show password";
 * aria-pressed says whether it is on. The eye icons rotate and scale past each other. A Caps Lock hint appears
 * while the field has focus and Caps Lock is on.
 */
@Component({
  selector: 'app-password-field',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'pw' },
  template: `
    <input
      #input
      [type]="shown() ? 'text' : 'password'"
      [value]="value()"
      [disabled]="disabled()"
      [attr.autocomplete]="autocomplete()"
      [attr.placeholder]="placeholder() || null"
      [attr.name]="name() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      (input)="onInput($event)"
      (blur)="onBlur()"
      (keydown)="onKey($event)"
      (keyup)="onKey($event)"
    />
    <button
      type="button"
      class="pw__toggle"
      title="Show password"
      aria-label="Show password"
      [attr.aria-pressed]="shown()"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      <app-icon class="pw__icon-show" name="eye" [size]="18" />
      <app-icon class="pw__icon-hide" name="eye-off" [size]="18" />
    </button>
    @if (caps()) {
      <div class="pw__caps" role="status"><app-icon name="alert" [size]="14" /> Caps Lock is on</div>
    }
  `,
})
export class PasswordField implements ControlValueAccessor {
  readonly autocomplete = input<'current-password' | 'new-password' | 'off'>('current-password');
  readonly placeholder = input('');
  readonly name = input('');
  /** force the invalid look (otherwise it follows the form control: invalid and touched) */
  readonly forceInvalid = input(false);

  protected shown = signal(false);
  protected caps = signal(false);
  protected value = signal('');
  protected disabled = signal(false);

  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected invalid() {
    const c = this.ngControl;
    return this.forceInvalid() || !!(c && c.invalid && c.touched);
  }

  focus() {
    this.inputEl().nativeElement.focus();
  }

  protected toggle() {
    this.shown.update((v) => !v);
    this.focus();
  }

  protected onInput(event: Event) {
    const v = (event.target as HTMLInputElement).value;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur() {
    this.caps.set(false);
    this.onTouched();
    this.cdr.markForCheck();
  }

  protected onKey(event: KeyboardEvent) {
    if (typeof event.getModifierState === 'function') this.caps.set(event.getModifierState('CapsLock'));
  }

  writeValue(v: string | null) {
    this.value.set(v ?? '');
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: string) => void) {
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
