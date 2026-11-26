import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { AttachmentsApi, logoUrl } from '../core/attachments.api';
import { errorText } from '../shared/errors';
import { IconComponent } from './icon';

const LOGO_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif';
const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * Pick a logo: a square preview, Upload / Replace and Remove. The image uploads as soon as it is chosen (as a logo,
 * so every page can show it); the form value is the image id or null. Works with formControlName.
 *
 *   <app-field label="Logo"><app-logo-input formControlName="logoId" /></app-field>
 */
@Component({
  selector: 'app-logo-input',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'logo-input', '[attr.data-disabled]': 'disabled() ? "" : null', '[attr.data-invalid]': 'error() ? "" : null' },
  template: `
    <span class="logo-input__preview" aria-hidden="true">
      @if (src(); as s) {
        <img [src]="s" alt="" (error)="broken.set(true)" />
      } @else {
        <app-icon name="image" [size]="20" />
      }
    </span>
    <span class="logo-input__text">
      <span class="logo-input__actions">
        <button type="button" class="logo-input__btn" [disabled]="disabled() || busy()" (click)="picker.click()">
          <app-icon name="upload" [size]="14" /> {{ busy() ? 'Uploading…' : id() ? 'Replace' : label() }}
        </button>
        @if (id()) {
          <button type="button" class="logo-input__btn" data-tone="danger" [disabled]="disabled() || busy()" (click)="clear()">
            <app-icon name="x" [size]="14" /> Remove
          </button>
        }
      </span>
      <span class="logo-input__hint">{{ error() || hint() }}</span>
    </span>
    <input #picker data-field-skip type="file" hidden [accept]="accept" (change)="pick($event)" />
  `,
})
export class LogoInput implements ControlValueAccessor {
  readonly label = input('Upload logo');
  readonly hint = input('PNG, JPEG or WebP, square works best, up to 1 MB');

  protected accept = LOGO_ACCEPT;
  protected id = signal<string | null>(null);
  protected busy = signal(false);
  protected disabled = signal(false);
  protected error = signal('');
  protected broken = signal(false);
  protected src = computed(() => (this.broken() ? null : logoUrl(this.id())));

  private api = inject(AttachmentsApi);
  private cdr = inject(ChangeDetectorRef);
  private ngControl = inject(NgControl, { self: true, optional: true });
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected pick(event: Event) {
    const el = event.target as HTMLInputElement;
    const chosen = el.files?.[0];
    el.value = '';
    if (!chosen) return;
    this.error.set('');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(chosen.type)) return this.error.set('Choose a PNG, JPEG, WebP or GIF image.');
    if (chosen.size > LOGO_MAX_BYTES) return this.error.set('The logo is too large. Keep it under 1 MB.');
    this.busy.set(true);
    this.api.upload(chosen, 'logo').subscribe({
      next: ({ id }) => {
        this.busy.set(false);
        this.set(id);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
        this.cdr.markForCheck();
      },
    });
  }

  /** the old image stays on the server: a saved record may still show it until the form is saved */
  protected clear() {
    this.error.set('');
    this.set(null);
  }

  private set(id: string | null) {
    this.broken.set(false);
    this.id.set(id);
    this.onChange(id);
    this.onTouched();
    this.cdr.markForCheck();
  }

  writeValue(v: string | null | undefined) {
    this.broken.set(false);
    this.id.set(v || null);
    this.error.set('');
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: string | null) => void) {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean) {
    this.disabled.set(d);
    this.cdr.markForCheck();
  }
}
