import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { AttachmentMeta } from '../../core/attachments.api';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, FileInput, MoneyInput, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';
import { FinanceEntry } from './models';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record a repayment of a loan or an advance, or the markup paid on it. Principal cannot go over what is still
 * outstanding. It posts cash out against the investor's own account (cash in for an advance the company paid out).
 */
@Component({
  selector: 'app-repayment-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, MoneyInput, FileInput],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="title()" [subtitle]="subtitle()" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Payment applied against" [required]="true">
          <select formControlName="kind">
            <option value="principal">{{ paidOut() ? 'Advance returned (principal)' : 'Loan or advance (principal)' }}</option>
            <option value="markup">Markup / interest</option>
          </select>
        </app-field>
        <app-field label="Amount" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null"
                   [hint]="kind() === 'principal' ? 'Up to ' + money(open2()) + ' outstanding' : 'Does not reduce the principal'">
          <app-money-input formControlName="amount" [max]="kind() === 'principal' ? open2() : null" />
        </app-field>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" [attr.min]="since()" [attr.max]="today" /></app-field>
        <app-field label="Payment method">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Reference" [wide]="true"><input type="text" formControlName="reference" placeholder="Transaction id, slip or voucher no." /></app-field>
        <app-field label="Notes" [wide]="true"><textarea formControlName="note" placeholder="Optional"></textarea></app-field>
        <app-field label="Proof" [wide]="true"><app-file-input formControlName="proof" label="Attach proof" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Record payment</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class RepaymentForm extends FormModal {
  /** the loan or advance being paid back */
  readonly entry = input<FinanceEntry | null>(null);
  readonly formId = 'form-repayment';
  protected money = fmtMoney;
  protected today = today();
  private fin = inject(FinanceApi);
  private store = inject(SettingsStore);
  protected methods = this.store.paymentMethods;

  readonly form = this.fb.nonNullable.group({
    kind: ['principal' as 'principal' | 'markup'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [today(), Validators.required],
    method: ['Bank Transfer'],
    reference: [''],
    note: [''],
    proof: [null as AttachmentMeta | null],
  });

  protected kind = toSignal(this.form.controls.kind.valueChanges, { initialValue: 'principal' as 'principal' | 'markup' });
  protected paidOut = computed(() => this.entry()?.direction === 'out');
  /** principal still open */
  protected open2 = computed(() => Number(this.entry()?.outstanding ?? 0));
  /** the day the money arrived: nothing can be repaid before it */
  protected since = computed(() => {
    const e = this.entry();
    return e ? (e.chequeStatus === 'Cleared' ? e.clearanceDate ?? e.date : e.date) : null;
  });
  protected title = computed(() => `Record a payment · ${this.entry()?.refNo ?? ''}`);
  protected subtitle = computed(() => {
    const e = this.entry();
    return e ? `${e.party} · ${e.funding} · ${fmtMoney(e.outstanding)} outstanding of ${fmtMoney(e.amount)}` : '';
  });

  protected reset() {
    const methods = this.methods();
    this.form.reset({
      kind: 'principal', amount: 0, date: today(), method: methods.includes('Bank Transfer') ? 'Bank Transfer' : methods[0] ?? '',
      reference: '', note: '', proof: null,
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.fin.repay(this.entry()!.id, {
      date: v.date, amount: v.amount, kind: v.kind, method: v.method || undefined, reference: v.reference.trim() || undefined,
      note: v.note.trim() || undefined, proofId: v.proof?.id,
    });
  }

  protected successMessage() {
    return this.kind() === 'markup' ? 'Markup recorded.' : this.paidOut() ? 'Repayment recorded. Cash is updated.' : 'Repayment recorded. Cash and the loan balance are updated.';
  }
}
