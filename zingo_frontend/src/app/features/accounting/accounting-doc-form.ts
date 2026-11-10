import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Modal } from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountingDoc, Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record an income invoice or an expense bill, in any set-up currency.
 * The exchange rate is frozen on the document; the PKR amount is what posts to the ledger.
 * An approved or part-paid document is locked.
 */
@Component({
  selector: 'app-accounting-doc-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" [title]="(doc() ? 'Edit ' : 'Record new ') + kind().toLowerCase()"
               [subtitle]="kind() === 'Income' ? 'An invoice we issue to a customer.' : 'A bill from a supplier. It needs approval before it can be paid.'">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Invoice / bill date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field [label]="kind() === 'Income' ? 'Income category' : 'Expense / investment stream'" [required]="true">
          <select formControlName="category">
            @for (c of categories(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </app-field>
        <app-field label="Invoice currency">
          <select formControlName="currency">
            @for (c of currencies(); track c.code) {
              <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Amount in invoice currency" [required]="true" [error]="invalid('foreignAmount') ? 'Enter an amount above zero' : null">
          <input type="number" formControlName="foreignAmount" min="0.01" step="0.01" />
        </app-field>
        <app-field label="Exchange rate" hint="PKR per currency unit, frozen on this document">
          <input type="number" formControlName="fxRate" min="0" step="any" />
        </app-field>
        <app-field [label]="kind() === 'Income' ? 'Customer / income source' : 'Supplier / payee'" [required]="true"
                   [error]="invalid('party') ? 'Enter a name' : null">
          <input type="text" formControlName="party" />
        </app-field>
        <app-field label="Due date"><input type="date" formControlName="dueDate" /></app-field>
        <app-field label="Reference / description" [wide]="true"><textarea formControlName="note" placeholder="Optional"></textarea></app-field>
      </form>
      @if (pkr() > 0) {
        <div class="notice"><span>Posts to the ledger as <strong>{{ money(pkr()) }}</strong>.</span></div>
      }
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ doc() ? 'Update document' : 'Create ' + kind().toLowerCase() }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class AccountingDocForm extends FormModal {
  readonly doc = input<AccountingDoc | null>(null);
  /** Income or Expense (an existing document keeps its own kind) */
  readonly kind = input<'Income' | 'Expense'>('Income');
  readonly categories = input<string[]>([]);
  readonly currencies = input<Currency[]>([]);
  readonly formId = 'form-accounting-doc';
  protected money = fmtMoney;
  private fin = inject(FinanceApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    category: [''],
    currency: ['PKR'],
    foreignAmount: [0, [Validators.required, Validators.min(0.01)]],
    fxRate: [1, [Validators.required, Validators.min(0.000001)]],
    party: ['', Validators.required],
    dueDate: [today()],
    note: [''],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** the PKR amount that will post */
  protected pkr = computed(() => Math.round((Number(this.value().foreignAmount) || 0) * (Number(this.value().fxRate) || 0) * 100) / 100);

  constructor() {
    super();
    // picking a currency fills its rate; PKR is always 1 and cannot be changed
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      const rate = this.currencies().find((c) => c.code === code)?.rate;
      this.form.controls.fxRate.setValue(code === 'PKR' ? 1 : Number(rate ?? 1));
      if (code === 'PKR') this.form.controls.fxRate.disable({ emitEvent: false });
      else this.form.controls.fxRate.enable({ emitEvent: false });
    });
  }

  protected reset() {
    const d = this.doc();
    this.form.reset(d
      ? {
          date: d.date, category: d.category, currency: d.currency, foreignAmount: Number(d.foreignAmount ?? d.amount),
          fxRate: Number(d.fxRate), party: d.party, dueDate: d.dueDate ?? d.date, note: d.note ?? '',
        }
      : { date: today(), category: this.categories()[0] ?? '', currency: 'PKR', foreignAmount: 0, fxRate: 1, party: '', dueDate: today(), note: '' });
    if (this.form.controls.currency.value === 'PKR') this.form.controls.fxRate.disable({ emitEvent: false });
    else this.form.controls.fxRate.enable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.fin.saveDoc(this.doc()?.id ?? null, { ...v, kind: this.doc()?.kind ?? this.kind() });
  }

  protected successMessage() {
    return this.kind() === 'Income'
      ? 'Income invoice saved. Collect it from the documents list.'
      : 'Expense bill saved. Approve it before paying.';
  }
}
