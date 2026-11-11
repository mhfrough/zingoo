import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';
import { FinanceEntry, FinanceType } from './models';

const today = () => new Date().toISOString().slice(0, 10);

const TYPES: FinanceType[] = ['Operating Expense', 'Asset Purchase', 'Other Receipt'];

/**
 * Add or edit a finance entry: spend, an asset purchase or another receipt (capital has its own form).
 * Spend and assets wait for signatures; receipts post at once. A posted entry is locked.
 */
@Component({
  selector: 'app-finance-entry-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="entry() ? 'Edit pending request ' + entry()!.refNo : 'New finance transaction'"
               subtitle="Amounts are in PKR." size="lg" [dirty]="form.dirty">
      @if (needsApproval()) {
        <div class="notice">
          <span>Spending needs one signature, or two (seat A and seat B) from {{ money(threshold()) }}. It does not reduce cash until it is approved.</span>
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Transaction type" [required]="true">
          <select formControlName="type">
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </app-field>
        <app-field label="Investment stream" [required]="true">
          <select formControlName="category">
            @for (s of streams(); track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </app-field>
        <app-field label="Amount" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Vendor / party" [wide]="true">
          <input type="text" formControlName="party" placeholder="Name" />
        </app-field>
        <app-field label="Description" [wide]="true"><textarea formControlName="note" placeholder="Optional"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ entry() ? 'Update request' : 'Create entry' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class FinanceEntryForm extends FormModal {
  readonly entry = input<FinanceEntry | null>(null);
  /** cost center names offered as "investment stream" */
  readonly streams = input<string[]>([]);
  /** amount from which two signatures are needed (shown in the hint) */
  readonly threshold = input(50000);
  readonly formId = 'form-finance-entry';
  protected types = TYPES;
  protected money = fmtMoney;
  private fin = inject(FinanceApi);

  readonly form = this.fb.nonNullable.group({
    type: ['Operating Expense' as string],
    category: ['Marketing'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [today(), Validators.required],
    party: [''],
    funding: ['Equity'],
    note: [''],
  });

  private type = toSignal(this.form.controls.type.valueChanges, { initialValue: this.form.controls.type.value });
  protected needsApproval = computed(() => this.type() === 'Operating Expense' || this.type() === 'Asset Purchase');

  protected reset() {
    const e = this.entry();
    this.form.reset(e
      ? { type: e.type, category: e.category, amount: Number(e.amount), date: e.date, party: e.party, funding: e.funding || 'Equity', note: e.note ?? '' }
      : { type: 'Operating Expense', category: this.streams()[0] ?? 'Marketing', amount: 0, date: today(), party: '', funding: 'Equity', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.fin.saveEntry(this.entry()?.id ?? null, { ...v, funding: '' });
  }

  protected successMessage() {
    return this.needsApproval() ? 'Spending request created. Approval required.' : 'Finance entry posted.';
  }
}
