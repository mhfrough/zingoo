import { ChangeDetectionStrategy, Component, input, inject } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Order } from '../ops/models';

const today = () => new Date().toISOString().slice(0, 10);

/** Record money received from a distributor against a dispatched order. */
@Component({
  selector: 'app-collection-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="sm" title="Record payment collection"
               [subtitle]="order() ? order()!.refNo + ' · ' + order()!.distributor.name : ''">
      @if (order(); as o) {
        <div class="notice">
          Invoice {{ money(o.billed) }} · Paid {{ money(o.collected) }} · <strong>Outstanding {{ money(o.outstanding) }}</strong>
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Receipt date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Amount received" [required]="true"
                   [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="amount" min="0.01" step="0.01" /></span>
        </app-field>
        <app-field label="Payment method" [wide]="true">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Reference / notes" [wide]="true"><input type="text" formControlName="note" /></app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">Post payment</button>
      </ng-container>
    </app-modal>
  `,
})
export class CollectionForm extends FormModal {
  readonly order = input<Order | null>(null);
  readonly formId = 'form-collection';
  protected methods = inject(SettingsStore).paymentMethods;
  protected money = fmtMoney;

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['Bank Transfer'],
    note: [''],
  });

  protected reset() {
    this.form.reset({ date: today(), amount: this.order()?.outstanding ?? 0, method: 'Bank Transfer', note: '' });
  }

  protected request() {
    return this.api.collect({ ...this.form.getRawValue(), orderId: this.order()!.id });
  }

  protected successMessage() {
    return 'Payment posted. Cash and receivables are updated.';
  }
}
