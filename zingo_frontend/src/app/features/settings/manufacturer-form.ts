import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Manufacturer } from '../ops/models';
import { SettingsApi } from './settings.api';

/** Add or change a contract manufacturer: who makes the goods, how many days they allow to pay, and in which currency. */
@Component({
  selector: 'app-manufacturer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="md" [title]="manufacturer() ? 'Edit manufacturer' : 'Add manufacturer'"
               subtitle="The factory that makes the goods for Zen Foods.">
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
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ manufacturer() ? 'Save changes' : 'Add manufacturer' }}
        </button>
      </ng-container>
    </app-modal>
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
  });

  protected reset() {
    const m = this.manufacturer();
    this.form.reset({ name: m?.name ?? '', paymentDays: m?.paymentDays ?? 30, currency: m?.currency ?? 'PKR', contact: m?.contact ?? '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.settingsApi.saveManufacturer(this.manufacturer()?.id ?? null, { ...v, paymentDays: Number(v.paymentDays) });
  }

  protected successMessage() {
    return this.manufacturer() ? 'Manufacturer updated.' : 'Manufacturer added.';
  }
}
