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
 * Attach several files (pictures, PDFs or Word documents, 5 MB each). Each file uploads as soon as it is chosen;
 * the form value is the list of their details. Works with formControlName.
 *
 *   <app-field label="Uploads"><app-files-input formControlName="files" /></app-field>
 */
@Component({
  selector: 'app-files-input',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'files-input', style: 'display: flex; flex-direction: column; gap: var(--space-2)' },
  template: `
    @for (f of files(); track f.id) {
      <div class="file-input">
        <app-icon name="file" [size]="16" />
        <button type="button" class="file-input__name" (click)="open(f)" [attr.aria-label]="'Download ' + f.name">{{ f.name }}</button>
        <span class="file-input__size">{{ size(f) }}</span>
        <button type="button" class="file-input__clear" [attr.aria-label]="'Remove ' + f.name" [disabled]="disabled() || busy()" (click)="remove(f)">
          <app-icon name="x" [size]="14" />
        </button>
      </div>
    }
    @if (files().length < max()) {
      <div class="file-input" [attr.data-invalid]="error() ? '' : null" [attr.data-disabled]="disabled() ? '' : null">
        <button type="button" class="file-input__pick" [disabled]="disabled() || busy()" (click)="picker.click()">
          <app-icon name="upload" [size]="16" />
          {{ busy() ? 'Uploading…' : files().length ? 'Add more files' : label() }}
        </button>
        <span class="file-input__hint">{{ error() || hint() }}</span>
      </div>
    }
    <input #picker data-field-skip type="file" multiple hidden [accept]="accept" (change)="pick($event)" />
  `,
})
export class FilesInput implements ControlValueAccessor {
  readonly label = input('Choose files');
  readonly hint = input('Pictures, PDF or Word, up to 5 MB each');
  readonly max = input(20);

  protected accept = ATTACHMENT_ACCEPT;
  protected files = signal<AttachmentMeta[]>([]);
  protected busy = signal(false);
  protected disabled = signal(false);
  protected error = signal('');
  protected size = (f: AttachmentMeta) => sizeText(f.size);
  /** files uploaded here and not saved on a record yet: only these are deleted on remove */
  private fresh = new Set<string>();

  private api = inject(AttachmentsApi);
  private cdr = inject(ChangeDetectorRef);
  private ngControl = inject(NgControl, { self: true, optional: true });
  private picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private onChange: (v: AttachmentMeta[]) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected async pick(event: Event) {
    const el = event.target as HTMLInputElement;
    const chosen = Array.from(el.files ?? []).slice(0, Math.max(0, this.max() - this.files().length));
    el.value = '';
    if (!chosen.length) return;
    this.error.set('');
    const tooBig = chosen.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig.length) this.error.set(`${tooBig.map((f) => f.name).join(', ')}: too large. Keep each under 5 MB.`);
    this.busy.set(true);
    for (const file of chosen.filter((f) => f.size <= ATTACHMENT_MAX_BYTES)) {
      await new Promise<void>((done) => {
        this.api.upload(file).subscribe({
          next: (meta) => {
            this.fresh.add(meta.id);
            this.files.update((l) => [...l, meta]);
            this.emit();
            done();
          },
          error: (err) => {
            this.error.set(`${file.name}: ${errorText(err)}`);
            done();
          },
        });
      });
      this.cdr.markForCheck();
    }
    this.busy.set(false);
    this.cdr.markForCheck();
  }

  protected remove(f: AttachmentMeta) {
    this.files.update((l) => l.filter((x) => x.id !== f.id));
    this.error.set('');
    this.emit();
    // a file already saved on the record stays until the record is saved without it
    if (this.fresh.delete(f.id)) this.api.remove(f.id).subscribe({ error: () => {} });
  }

  protected open(f: AttachmentMeta) {
    this.api.download(f).subscribe({
      error: (err) => {
        this.error.set(errorText(err));
        this.cdr.markForCheck();
      },
    });
  }

  private emit() {
    this.onChange(this.files().map(({ id, name, mime, size }) => ({ id, name, mime, size })));
    this.onTouched();
  }

  writeValue(v: AttachmentMeta[] | null | undefined) {
    this.files.set(v ?? []);
    this.fresh.clear();
    this.error.set('');
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: AttachmentMeta[]) => void) {
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
