import { AttachmentMeta } from '../../core/attachments.api';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { Btn, Field, Offcanvas, FilesInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Manufacturer } from '../ops/models';
import { SettingsApi } from './settings.api';

/** Add or change a contract manufacturer: who makes the goods, how many days they allow to pay, and in which currency. */
@Component({
  selector: 'app-manufacturer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilesInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  styles: `
    .form-section {
      grid-column: 1 / -1;
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-3);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="manufacturer() ? 'Edit manufacturer' : 'Add manufacturer'"
               subtitle="The factory that makes the goods for Zen Foods." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Name" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
          <input type="text" formControlName="name" maxlength="150" />
        </app-field>
        <app-field label="Payment days" hint="How long they allow us to pay" [required]="true">
          <input type="number" formControlName="paymentDays" min="0" step="1" />
        </app-field>
        <app-field label="Currency">
          <select formControlName="currency">
            @for (c of currencies(); track c.code) {
              <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Contact" [wide]="true"><input type="text" formControlName="contact" maxlength="200" /></app-field>
        <h4 class="form-section">Contract</h4>
        <app-field label="Point of contact" hint="Who to speak to: name, phone or email"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Contract" hint="Contract number or title"><input type="text" formControlName="contract" maxlength="150" /></app-field>
        <app-field label="Terms" [wide]="true"><textarea formControlName="terms" maxlength="5000" placeholder="What was agreed: rates, payment, delivery, exclusivity"></textarea></app-field>
        <app-field label="Uploads" [wide]="true" hint="Signed contract, licences, pictures. Several files at once"><app-files-input formControlName="files" label="Upload files" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ manufacturer() ? 'Save changes' : 'Add manufacturer' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ManufacturerForm extends FormModal {
  readonly manufacturer = input<Manufacturer | null>(null);
  readonly formId = 'form-manufacturer';
  protected currencies = inject(SettingsStore).currencies;
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    paymentDays: [30, [Validators.required, Validators.min(0)]],
    currency: ['PKR'],
    contact: [''],
    poc: [''],
    contract: [''],
    terms: [''],
    files: [[] as AttachmentMeta[]],
  });

  protected reset() {
    const m = this.manufacturer();
    this.form.reset({ name: m?.name ?? '', paymentDays: m?.paymentDays ?? 30, currency: m?.currency ?? 'PKR', contact: m?.contact ?? '', poc: m?.poc ?? '', contract: m?.contract ?? '', terms: m?.terms ?? '', files: m?.files ?? [] });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.settingsApi.saveManufacturer(this.manufacturer()?.id ?? null, { ...v, paymentDays: Number(v.paymentDays) });
  }

  protected successMessage() {
    return this.manufacturer() ? 'Manufacturer updated.' : 'Manufacturer added.';
  }
}
