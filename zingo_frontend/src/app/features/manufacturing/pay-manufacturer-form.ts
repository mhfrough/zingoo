import { ChangeDetectionStrategy, Component, input, inject } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Batch } from '../ops/models';

const today = () => new Date().toISOString().slice(0, 10);

/** Pay the manufacturer for a released batch, in full or in part. */
@Component({
  selector: 'app-pay-manufacturer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Pay manufacturer" [subtitle]="batch() ? batch()!.refNo + ' · ' + batch()!.manufacturer.name : ''" size="lg" [dirty]="form.dirty">
      @if (batch(); as b) {
        <div class="notice">
          Accrued {{ money(b.cost) }} · Paid {{ money(b.paid) }} · <strong>Remaining {{ money(b.due) }}</strong>
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Payment date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Amount" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Method" [wide]="true">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Reference / notes" [wide]="true"><input type="text" formControlName="note" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">Post payment</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class PayManufacturerForm extends FormModal {
  readonly batch = input<Batch | null>(null);
  readonly formId = 'form-pay-manufacturer';
  protected methods = inject(SettingsStore).paymentMethods;
  protected money = fmtMoney;

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['Bank Transfer'],
    note: [''],
  });

  protected reset() {
    this.form.reset({ date: today(), amount: this.batch()?.due ?? 0, method: 'Bank Transfer', note: '' });
  }

  protected request() {
    return this.api.payManufacturer({ ...this.form.getRawValue(), batchId: this.batch()!.id });
  }

  protected successMessage() {
    return 'Payment posted. Cash and the manufacturer payable are updated.';
  }
}
