import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, of, switchMap } from 'rxjs';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../../core/attachments.api';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, MoneyInput, MultiSelect, Offcanvas, RefInput, RichText, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Manufacturer } from '../ops/models';
import { FactoryApi, OrderDetailData, OrderDoc } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The manufacturer (or staff for it) raises its invoice on one order: the advance, or the balance once the goods
 * are ready. The amount starts at what is still open; the due date follows the manufacturer's credit days; one or
 * more of its bank accounts are printed on it; its own invoice copy can be attached. Zen Foods then signs and pays.
 */
@Component({
  selector: 'app-order-invoice-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, MoneyInput, MultiSelect, RichText, RefInput, Select],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="'Invoice ' + (detail()?.order?.refNo ?? '')" size="lg" [dirty]="form.dirty"
      [subtitle]="detail() ? detail()!.order.manufacturer.name + ' to Zen Foods' : ''"
      help="Your invoice to Zen Foods for this order. Finance approves it with one or two signatures, then pays it into the account you pick. The due date tells Finance when it should be paid.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      @if (!banks().length) {
        <div class="notice" data-tone="warning" role="status">No bank account on file for this manufacturer. Ask Zen Foods to add one first.</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="send()" class="form-grid" novalidate>
        <app-field label="Invoice for" [required]="true"
          help="Advance: the share paid before production (the order's advance %). Balance: the rest of the order value, usually once the goods are ready.">
          <app-select formControlName="kind">
            <option value="Advance">Advance</option>
            <option value="Balance">Balance</option>
          </app-select>
        </app-field>
        <app-field label="Amount (PKR)" [required]="true" [hint]="'Still open: ' + money(openAmount())" [error]="invalid('amount') ? 'Enter an amount' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Invoice no." [required]="true" help="Filled in with the next invoice number. Type your own if you have one; it must not be used already.">
          <app-ref-input formControlName="invoiceNo" kind="mfrInvoice" />
        </app-field>
        <app-field label="Invoice date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Due date" [required]="true" [hint]="dueHint()"
          help="When Zen Foods should pay. An advance is due at once; a balance after your credit days with Zen Foods.">
          <input type="date" formControlName="dueDate" [min]="form.controls.date.value" />
        </app-field>
        <app-field label="Your invoice copy" hint="PDF or photo, 5 MB at most (optional)">
          <input type="file" [accept]="accept" (change)="pick($event)" />
        </app-field>
        <app-field label="Bank accounts on the invoice" [wide]="true" [required]="true" hint="The first is where Zen Foods pays; the others are printed as alternatives"
          [error]="invalid('banks') ? 'Pick at least one account' : null">
          <app-multi-select formControlName="banks" [options]="bankOptions()" placeholder="Add an account" />
        </app-field>
        <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()" [disabled]="!banks().length">Send invoice to Zen Foods</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderInvoiceForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly detail = input<OrderDetailData | null>(null);
  readonly formId = 'form-order-invoice';
  protected maxDate = today();
  protected accept = ATTACHMENT_ACCEPT;
  private file = signal<File | null>(null);

  readonly form = this.fb.nonNullable.group({
    kind: ['Balance' as 'Advance' | 'Balance'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    invoiceNo: [''],
    date: [today(), Validators.required],
    dueDate: [today(), Validators.required],
    banks: [[] as string[], Validators.required],
    note: [''],
  });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  private manufacturer = computed(() => this.detail()?.order.manufacturer as Manufacturer | undefined);
  protected banks = computed(() => this.manufacturer()?.bankAccounts ?? []);
  protected bankOptions = computed<SelectOption<string>[]>(() =>
    this.banks().map((b) => ({ value: b.account, label: `${b.bank} · ${b.account}`, sub: `${b.title}${b.isDefault ? ' · default' : ''}` })));

  /** what is still open for the kind picked: the advance left, or the order value left (open invoices count) */
  protected openAmount = computed(() => {
    const d = this.detail();
    if (!d) return 0;
    const live = d.invoices.filter((i) => i.status === 'Submitted');
    const asked = live.reduce((n, i) => n + i.amount, 0);
    const valueLeft = Math.max(0, (d.order.value ?? 0) - asked);
    if (this.value().kind === 'Balance') return valueLeft;
    const advAsked = live.filter((i) => i.kind === 'Advance').reduce((n, i) => n + i.amount, 0);
    return Math.max(0, Math.min((d.order.advanceAmount ?? 0) - advAsked, valueLeft));
  });

  protected dueHint = computed(() => {
    const days = this.manufacturer()?.paymentDays ?? 0;
    return this.value().kind === 'Balance' && days ? `${days} credit days from the invoice date` : 'Due at once';
  });

  protected money = fmtMoney;

  constructor() {
    super();
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.refill());
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.refillDue());
  }

  private refill() {
    queueMicrotask(() => {
      this.form.controls.amount.setValue(Math.round(this.openAmount() * 100) / 100);
      this.refillDue();
    });
  }

  private refillDue() {
    const v = this.form.getRawValue();
    const days = this.manufacturer()?.paymentDays ?? 0;
    this.form.controls.dueDate.setValue(v.kind === 'Balance' && days ? addDays(v.date, days) : v.date, { emitEvent: false });
  }

  protected pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    if (f && f.size > ATTACHMENT_MAX_BYTES) {
      this.error.set('The invoice copy is larger than 5 MB.');
      (e.target as HTMLInputElement).value = '';
      return;
    }
    this.file.set(f);
    this.form.markAsDirty();
  }

  protected send() {
    this.submit();
  }

  protected reset() {
    const d = this.detail();
    const def = this.banks().find((b) => b.isDefault) ?? this.banks()[0];
    // a ready order (or one with its advance asked already) invoices the balance; a fresh one the advance
    const advanceOpen = (d?.order.advanceAmount ?? 0) > 0 && !d?.invoices.some((i) => i.kind === 'Advance' && i.status === 'Submitted');
    const kind: 'Advance' | 'Balance' = !d?.ready && advanceOpen ? 'Advance' : 'Balance';
    this.file.set(null);
    this.form.reset({ kind, amount: 0, invoiceNo: '', date: today(), dueDate: today(), banks: def ? [def.account] : [], note: '' });
    this.refill();
  }

  protected request() {
    const d = this.detail()!;
    const v = this.form.getRawValue();
    const file = this.file();
    const upload: Observable<OrderDoc | null> = file ? this.factory.addOrderDoc(d.order.id, file, 'INVOICE') : of(null);
    return upload.pipe(switchMap((doc) => this.factory.request({
      orderId: d.order.id, kind: v.kind, amount: Number(v.amount), date: v.date, dueDate: v.dueDate, bankAccounts: v.banks,
      ...(v.invoiceNo.trim() ? { invoiceNo: v.invoiceNo.trim(), refNo: v.invoiceNo.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
      ...(doc ? { invoiceFileId: doc.id } : {}),
    })));
  }

  protected successMessage() {
    return 'Invoice sent to Zen Foods.';
  }
}
