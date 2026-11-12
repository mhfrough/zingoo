import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Manufacturer } from '../ops/models';
import { FactoryApi, PaymentRequest, PositionRow } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The manufacturer (or staff for it) asks to be paid: the advance or the balance of one accepted order, into one of
 * its bank accounts. The amount starts at what is still open for that kind.
 */
@Component({
  selector: 'app-payment-request-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select, MoneyInput],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Request payment" subtitle="Advance or balance of an accepted order." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Order" [wide]="true" [required]="true" [error]="invalid('orderId') ? 'Choose an order' : null">
          <app-select formControlName="orderId" [options]="orderOptions()" placeholder="Choose an accepted order" [clearable]="false" />
        </app-field>
        <app-field label="Payment for" [required]="true">
          <select formControlName="kind">
            <option value="Advance">Advance</option>
            <option value="Balance">Balance</option>
          </select>
        </app-field>
        <app-field label="Amount (PKR)" [required]="true" [hint]="'Still open: ' + money(openAmount())" [error]="invalid('amount') ? 'Enter an amount' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Date" [required]="true">
          <input type="date" formControlName="date" [max]="maxDate" />
        </app-field>
        <app-field label="Pay into" [wide]="true" [required]="true" [error]="invalid('bankAccount') ? 'Choose a bank account' : null">
          <app-select formControlName="bankAccount" [options]="bankOptions()" placeholder="Choose a bank account" [clearable]="false" />
        </app-field>
        <app-field label="Your invoice no."><input type="text" formControlName="invoiceNo" maxlength="60" /></app-field>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()">Send request</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class PaymentRequestForm extends FormModal {
  private factory = inject(FactoryApi);
  /** the manufacturer's open orders with what was already asked for */
  readonly rows = input<PositionRow[]>([]);
  readonly manufacturer = input<Manufacturer | null>(null);
  /** start with this order picked */
  readonly orderId = input<string | null>(null);
  readonly formId = 'form-payment-request';
  protected maxDate = today();

  readonly form = this.fb.nonNullable.group({
    orderId: ['', Validators.required],
    kind: ['Advance' as 'Advance' | 'Balance'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [today(), Validators.required],
    bankAccount: ['', Validators.required],
    invoiceNo: [''],
    note: [''],
  });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected orderOptions = computed<SelectOption<string>[]>(() =>
    this.rows().filter((r) => r.status === 'Accepted').map((r) => ({
      value: r.orderId, label: `${r.refNo} · ${r.sku}`, sub: `Value ${fmtMoney(r.value)} · asked ${fmtMoney(r.requested)}`,
    })));
  protected bankOptions = computed<SelectOption<string>[]>(() =>
    (this.manufacturer()?.bankAccounts ?? []).map((b) => ({ value: b.account, label: `${b.bank} · ${b.account}`, sub: b.isDefault ? `${b.title} · default` : b.title })));

  /** what is still open for the chosen kind (advance left, or value left) */
  protected openAmount = computed(() => {
    const r = this.rows().find((x) => x.orderId === this.value().orderId);
    if (!r) return 0;
    const valueLeft = r.value - r.requested;
    if (this.value().kind === 'Balance') return Math.max(0, valueLeft);
    return Math.max(0, Math.min(r.advance - r.advanceRequested, valueLeft));
  });

  protected money = fmtMoney;

  constructor() {
    super();
    this.form.controls.orderId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.fillAmount());
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.fillAmount());
  }

  private fillAmount() {
    queueMicrotask(() => this.form.controls.amount.setValue(Math.round(this.openAmount() * 100) / 100));
  }

  protected reset() {
    const def = this.manufacturer()?.bankAccounts?.find((b) => b.isDefault) ?? this.manufacturer()?.bankAccounts?.[0];
    const first = this.orderId() ?? this.orderOptions()[0]?.value ?? '';
    this.form.reset({ orderId: first, kind: 'Advance', amount: 0, date: today(), bankAccount: def?.account ?? '', invoiceNo: '', note: '' });
    this.fillAmount();
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.request({
      orderId: v.orderId, kind: v.kind, amount: Number(v.amount), date: v.date, bankAccount: v.bankAccount,
      ...(v.invoiceNo.trim() ? { invoiceNo: v.invoiceNo.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Payment request sent to Zen Foods.';
  }
}

/** The company pays an approved request (all of it or a part) from one of its accounts. */
@Component({
  selector: 'app-pay-request-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, MoneyInput],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="req() ? 'Pay ' + req()!.refNo : 'Pay request'" [subtitle]="subject()" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      @if (req(); as r) {
        <div class="notice">
          <span>Pay to <strong>{{ r.bank.bank }} · {{ r.bank.account }}</strong> ({{ r.bank.title }}{{ r.bank.branch ? ', ' + r.bank.branch : '' }}).
            Until the goods are delivered this is an advance to the manufacturer, not a cost.</span>
        </div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Amount (PKR)" [required]="true" [hint]="'Due ' + money(req()?.due ?? 0)" [error]="invalid('amount') ? 'Enter an amount' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Method" [required]="true">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Paid from">
          <select formControlName="fromAccount">
            <option value="">Not recorded</option>
            @for (a of accounts(); track a) {
              <option [value]="a">{{ a }}</option>
            }
          </select>
        </app-field>
        <app-field label="Transfer / cheque ref."><input type="text" formControlName="reference" maxlength="80" /></app-field>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Record payment</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class PayRequestForm extends FormModal {
  private factory = inject(FactoryApi);
  private store = inject(SettingsStore);
  readonly req = input<PaymentRequest | null>(null);
  readonly formId = 'form-pay-request';
  protected maxDate = today();
  protected methods = computed(() => this.store.options('PAY_METHOD'));
  protected accounts = computed(() => this.store.options('BANK_ACCOUNT'));
  protected subject = computed(() => {
    const r = this.req();
    return r ? `${r.kind} · ${r.order.refNo} · ${r.manufacturer.name}` : '';
  });
  protected money = fmtMoney;

  readonly form = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [today(), Validators.required],
    method: ['Bank Transfer', Validators.required],
    fromAccount: [''],
    reference: [''],
    note: [''],
  });

  protected reset() {
    this.form.reset({
      amount: this.req()?.due ?? 0, date: today(), method: this.methods()[0] ?? 'Bank Transfer',
      fromAccount: this.accounts()[0] ?? '', reference: '', note: '',
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.payRequest(this.req()!.id, {
      amount: Number(v.amount), date: v.date, method: v.method, ...(v.fromAccount ? { fromAccount: v.fromAccount } : {}),
      ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Payment recorded and posted.';
  }
}
