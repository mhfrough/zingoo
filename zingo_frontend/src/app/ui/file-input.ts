import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, ViewEncapsulation, inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, AttachmentMeta, AttachmentsApi } from '../core/attachments.api';
import { errorText } from '../shared/errors';
import { IconComponent } from './icon';

/** "2.4 MB", "310 KB" */
function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Attach a file (picture, PDF or Word document, 5 MB at most). The file uploads as soon as it is chosen; the form
 * value is its details (id, name, size) or null. Works with formControlName, formControl and ngModel.
 *
 *   <app-field label="Payment proof"><app-file-input formControlName="proof" /></app-field>
 *
 * Removing a file that is not saved on a record yet also deletes it from the server.
 */
@Component({
  selector: 'app-file-input',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'file-input', '[attr.data-disabled]': 'disabled() ? "" : null', '[attr.data-invalid]': 'error() ? "" : null' },
  template: `
    @if (file(); as f) {
      <app-icon name="file" [size]="16" />
      <button type="button" class="file-input__name" (click)="open(f)" [attr.aria-label]="'Download ' + f.name">
        {{ f.name }}
      </button>
      <span class="file-input__size">{{ size(f) }}</span>
      <button type="button" class="file-input__clear" aria-label="Remove file" [disabled]="disabled() || busy()" (click)="clear()">
        <app-icon name="x" [size]="14" />
      </button>
    } @else {
      <button type="button" class="file-input__pick" [disabled]="disabled() || busy()" (click)="picker.click()">
        <app-icon name="upload" [size]="16" />
        {{ busy() ? 'Uploading…' : label() }}
      </button>
      <span class="file-input__hint">{{ error() || hint() }}</span>
    }
    <input #picker data-field-skip type="file" hidden [accept]="accept" (change)="pick($event)" />
  `,
})
export class FileInput implements ControlValueAccessor {
  readonly label = input('Choose file');
  readonly hint = input('Picture, PDF or Word, up to 5 MB');

  protected accept = ATTACHMENT_ACCEPT;
  protected file = signal<AttachmentMeta | null>(null);
  protected busy = signal(false);
  protected disabled = signal(false);
  protected error = signal('');
  protected size = (f: AttachmentMeta) => sizeText(f.size);

  private api = inject(AttachmentsApi);
  private cdr = inject(ChangeDetectorRef);
  private ngControl = inject(NgControl, { self: true, optional: true });
  private picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private onChange: (v: AttachmentMeta | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = ''; // so choosing the same file again still fires
    if (!chosen) return;
    this.error.set('');
    if (chosen.size > ATTACHMENT_MAX_BYTES) {
      this.error.set('The file is too large. Keep it under 5 MB.');
      return;
    }
    this.busy.set(true);
    this.api.upload(chosen).subscribe({
      next: (meta) => {
        this.busy.set(false);
        this.file.set(meta);
        this.onChange(meta);
        this.onTouched();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
        this.cdr.markForCheck();
      },
    });
  }

  protected clear() {
    const old = this.file();
    this.file.set(null);
    this.error.set('');
    this.onChange(null);
    this.onTouched();
    if (old) this.api.remove(old.id).subscribe({ error: () => {} }); // a file already on a record stays; only an Admin can remove it
  }

  protected open(f: AttachmentMeta) {
    this.api.download(f).subscribe({
      error: (err) => {
        this.error.set(errorText(err));
        this.cdr.markForCheck();
      },
    });
  }

  writeValue(v: AttachmentMeta | null | undefined) {
    this.file.set(v ?? null);
    this.error.set('');
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: AttachmentMeta | null) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.disabled.set(disabled);
    this.cdr.markForCheck();
  }
}
