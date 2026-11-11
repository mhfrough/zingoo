import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor } from '../ops/models';

/** Add or edit a distributor: who they are and the trading terms we agreed. */
@Component({
  selector: 'app-distributor-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="distributor() ? 'Edit distributor' : 'Add distributor'"
               subtitle="Company details and trading terms." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Distributor / company" [required]="true" [error]="invalid('name') ? 'Enter the company name' : null">
          <input type="text" formControlName="name" />
        </app-field>
        <app-field label="Territory / city" [required]="true" [error]="invalid('region') ? 'Enter the territory' : null">
          <input type="text" formControlName="region" />
        </app-field>
        <app-field label="Contact or phone" [wide]="true"><input type="text" formControlName="contact" /></app-field>
        <app-field label="Address" [wide]="true"><input type="text" formControlName="address" /></app-field>
        <app-field label="Tax number"><input type="text" formControlName="taxNo" /></app-field>
        <app-field label="Payment terms" hint="Days after dispatch that payment is due">
          <select formControlName="paymentDays">
            @for (d of paymentCycles(); track d) {
              <option [ngValue]="d">{{ d }} days</option>
            }
          </select>
        </app-field>
        <app-field label="Credit limit" hint="0 means no limit. Over the limit, dispatch is held for Finance.">
          <app-money-input formControlName="creditLimit" />
        </app-field>
        <app-field label="Advance guide (%)" hint="Share of an order the distributor is asked to pay up front">
          <input type="number" formControlName="advancePct" min="0" max="100" step="1" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ distributor() ? 'Save distributor' : 'Add distributor' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DistributorForm extends FormModal {
  readonly distributor = input<Distributor | null>(null);
  /** allowed payment terms, from Settings */
  readonly paymentCycles = input<number[]>([15, 30, 45, 60]);
  readonly formId = 'form-distributor';

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    region: ['', Validators.required],
    contact: [''],
    address: [''],
    taxNo: [''],
    paymentDays: [30],
    creditLimit: [0, Validators.min(0)],
    advancePct: [0, [Validators.min(0), Validators.max(100)]],
  });

  protected reset() {
    const d = this.distributor();
    this.form.reset(d
      ? { name: d.name, region: d.region, contact: d.contact ?? '', address: d.address ?? '', taxNo: d.taxNo ?? '', paymentDays: d.paymentDays, creditLimit: Number(d.creditLimit), advancePct: Number(d.advancePct) }
      : { name: '', region: '', contact: '', address: '', taxNo: '', paymentDays: 30, creditLimit: 0, advancePct: 0 });
  }

  protected request() {
    return this.api.saveDistributor(this.distributor()?.id ?? null, this.form.getRawValue());
  }

  protected successMessage() {
    return this.distributor() ? 'Distributor updated.' : 'Distributor added.';
  }
}
