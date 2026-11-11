import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountingDoc } from '../finance/models';
import { FormModal } from '../ops/form-modal';

const today = () => new Date().toISOString().slice(0, 10);

/** Collect an income invoice or pay an expense bill, in full or in part. */
@Component({
  selector: 'app-settle-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="doc()?.kind === 'Income' ? 'Collect income' : 'Pay expense bill'"
               [subtitle]="doc() ? doc()!.refNo + ' · ' + doc()!.party : ''" size="lg" [dirty]="form.dirty">
      @if (doc(); as d) {
        <div class="notice">
          <span>Document {{ money(d.amount) }} · Settled {{ money(d.paid) }} · <strong>Open {{ money(d.due) }}</strong></span>
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field [label]="doc()?.kind === 'Income' ? 'Receipt date' : 'Payment date'" [required]="true">
          <input type="date" formControlName="date" />
        </app-field>
        <app-field label="Amount to settle" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <app-money-input formControlName="amount" />
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
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">
          Post {{ doc()?.kind === 'Income' ? 'receipt' : 'payment' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class SettleForm extends FormModal {
  readonly doc = input<AccountingDoc | null>(null);
  readonly formId = 'form-settle';
  protected methods = inject(SettingsStore).paymentMethods;
  protected money = fmtMoney;
  private fin = inject(FinanceApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['Bank Transfer'],
    note: [''],
  });

  protected reset() {
    this.form.reset({ date: today(), amount: this.doc()?.due ?? 0, method: 'Bank Transfer', note: '' });
  }

  protected request() {
    return this.fin.settleDoc(this.doc()!.id, this.form.getRawValue());
  }

  protected successMessage() {
    return this.doc()?.kind === 'Income'
      ? 'Income collection posted to cash and receivables.'
      : 'Bill payment posted to cash and payables.';
  }
}
