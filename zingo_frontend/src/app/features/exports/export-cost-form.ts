import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PAY_METHODS } from '../ops/models';
import { ExportsApi } from './exports.api';
import { ExportRow } from './models';

const today = () => new Date().toISOString().slice(0, 10);

/** Pay the seller-side logistics costs of a shipped container (PKR). The cost was booked at shipping, so this moves cash only. */
@Component({
  selector: 'app-export-cost-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="sm" title="Pay export costs"
               [subtitle]="shipment() ? shipment()!.refNo + ' · ' + shipment()!.buyer : ''">
      @if (shipment(); as s) {
        <div class="notice"><span>Export costs payable <strong>{{ money(s.costDue) }}</strong>. Paying them lowers cash, not profit again.</span></div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Payment date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Amount to pay" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="amount" min="0.01" step="0.01" /></span>
        </app-field>
        <app-field label="Payment method" [wide]="true">
          <select formControlName="method">
            @for (m of methods; track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Reference" [wide]="true"><input type="text" formControlName="note" /></app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">Pay costs</button>
      </ng-container>
    </app-modal>
  `,
})
export class ExportCostForm extends FormModal {
  readonly shipment = input<ExportRow | null>(null);
  readonly formId = 'form-export-cost';
  protected methods = PAY_METHODS;
  protected money = fmtMoney;
  private exportsApi = inject(ExportsApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['Bank Transfer'],
    note: [''],
  });

  protected reset() {
    this.form.reset({ date: today(), amount: Number(this.shipment()?.costDue ?? 0), method: 'Bank Transfer', note: '' });
  }

  protected request() {
    return this.exportsApi.payCosts(this.shipment()!.id, this.form.getRawValue());
  }

  protected successMessage() {
    return 'Export costs paid; the payable is reduced.';
  }
}
