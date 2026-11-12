import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount, fmtAmount2, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, ConfirmService, DataTable, Field, MoneyInput, Offcanvas, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { OrderReasonForm } from './answer-forms';
import { DistInvoice, FactoryApi, Shipment } from './factory.api';
import { printVoucher } from '../../shared/print';
import { salesInvoiceVoucher } from './vouchers';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The distributor reports what it distributed: how many containers of each delivery it holds were sold.
 * Income is the distributor's price per packet; the containers stop counting as its stock at once.
 */
@Component({
  selector: 'app-sales-invoice-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  styles: `
    .lots {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .lot {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(6rem, 1fr) minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
      padding-block: var(--space-2);
      border-block-end: 1px solid var(--border);

      & small {
        display: block;
        color: var(--text-3);
      }

      & .num {
        text-align: end;
        font-variant-numeric: tabular-nums;
      }
    }

    .total {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      font-weight: var(--weight-semibold);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report sales" subtitle="Containers you distributed, from the deliveries you hold." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Invoice date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Your invoice no."><input type="text" formControlName="invoiceNo" maxlength="60" /></app-field>
        <div class="lots" formArrayName="lines">
          @for (g of lines.controls; track g; let i = $index) {
            <div class="lot" [formGroupName]="i">
              <div>
                <strong>{{ lots()[i].product.sku }} · {{ lots()[i].refNo }}</strong>
                <small>{{ lots()[i].onHandContainers }} in stock · sell by {{ date(lots()[i].sellBy) }} · PKR {{ rate(lots()[i].saleRate ?? 0) }} per packet</small>
              </div>
              <app-field [label]="'Containers sold'">
                <input type="number" formControlName="containers" min="0" [max]="lots()[i].onHandContainers" step="1" />
              </app-field>
              <span class="num">{{ money(lineAmount(i)) }}</span>
            </div>
          } @empty {
            <p class="notice">Nothing in stock to report. Confirm a delivery first.</p>
          }
        </div>
        <div class="total"><span>{{ num(containers()) }} container{{ containers() === 1 ? '' : 's' }}</span><span>{{ money(total()) }}</span></div>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()" [disabled]="!containers()">Send invoice</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class SalesInvoiceForm extends FormModal {
  private factory = inject(FactoryApi);
  /** deliveries held by the distributor */
  readonly shipments = input<Shipment[]>([]);
  /** staff entering it for a distributor */
  readonly distributorId = input<string | null>(null);
  readonly formId = 'form-sales-invoice';
  protected maxDate = today();

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    invoiceNo: [''],
    note: [''],
    lines: this.fb.array<FormGroup>([]),
  });
  protected get lines() {
    return this.form.controls.lines as FormArray<FormGroup>;
  }
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** received deliveries with containers still in stock */
  protected lots = computed(() => this.shipments().filter((s) => s.status === 'Received' && s.destination === 'Distributor' && s.onHandContainers > 0));
  private qty = (i: number) => Number((this.value().lines?.[i] as { containers?: number } | undefined)?.containers ?? 0);
  protected lineAmount = (i: number) => {
    const l = this.lots()[i];
    return l ? Math.round(this.qty(i) * l.bundlesPerContainer * l.packetsPerBundle * Number(l.saleRate ?? 0) * 100) / 100 : 0;
  };
  protected containers = computed(() => this.lots().reduce((n, _, i) => n + this.qty(i), 0));
  protected total = computed(() => this.lots().reduce((n, _, i) => n + this.lineAmount(i), 0));

  protected money = fmtMoney;
  protected num = fmtNumber;
  /** a price per packet keeps its paisa */
  protected rate = fmtAmount2;
  protected date = (d: string | null) => (d ? fmtDate(d) : '-');

  protected reset() {
    this.lines.clear();
    for (const l of this.lots()) this.lines.push(this.fb.nonNullable.group({ containers: [0, [Validators.min(0), Validators.max(l.onHandContainers)]] }));
    this.form.reset({ date: today(), invoiceNo: '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    const lines = this.lots().map((l, i) => ({ shipmentId: l.id, containers: Number((v.lines[i] as { containers: number }).containers) })).filter((l) => l.containers > 0);
    return this.factory.createInvoice({
      date: v.date, lines, ...(this.distributorId() ? { distributorId: this.distributorId() } : {}),
      ...(v.invoiceNo.trim() ? { invoiceNo: v.invoiceNo.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Invoice sent to Zen Foods for verification.';
  }
}

/** Money received from the distributor against a verified invoice. */
@Component({
  selector: 'app-invoice-payment-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, MoneyInput],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="inv() ? 'Payment for ' + inv()!.refNo : 'Record payment'" [subtitle]="inv()?.distributor?.name ?? ''" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Amount (PKR)" [required]="true" [hint]="'Due ' + money(inv()?.due ?? 0)"><app-money-input formControlName="amount" /></app-field>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Method" [required]="true">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Received into">
          <select formControlName="toAccount">
            <option value="">Not recorded</option>
            @for (a of accounts(); track a) {
              <option [value]="a">{{ a }}</option>
            }
          </select>
        </app-field>
        <app-field label="Reference" [wide]="true"><input type="text" formControlName="reference" maxlength="80" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Record payment</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class InvoicePaymentForm extends FormModal {
  private factory = inject(FactoryApi);
  private store = inject(SettingsStore);
  readonly inv = input<DistInvoice | null>(null);
  readonly formId = 'form-invoice-payment';
  protected maxDate = today();
  protected methods = computed(() => this.store.options('PAY_METHOD'));
  protected accounts = computed(() => this.store.options('BANK_ACCOUNT'));
  protected money = fmtMoney;
  readonly form = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]], date: [today(), Validators.required], method: ['Bank Transfer', Validators.required],
    toAccount: [''], reference: [''],
  });

  protected reset() {
    this.form.reset({ amount: this.inv()?.due ?? 0, date: today(), method: this.methods()[0] ?? 'Bank Transfer', toAccount: this.accounts()[0] ?? '', reference: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.payInvoice(this.inv()!.id, {
      amount: Number(v.amount), date: v.date, method: v.method, ...(v.toAccount ? { toAccount: v.toAccount } : {}), ...(v.reference.trim() ? { reference: v.reference.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Payment recorded. The distributor owes less.';
  }
}

const tone = (i: DistInvoice): Tone =>
  i.status === 'Rejected' ? 'danger' : i.status === 'Submitted' ? 'warning' : i.state === 'Paid' ? 'success' : i.overdue ? 'danger' : 'info';

/**
 * Distributor sales invoices, for both sides:
 * - `distributor`: report sales from the deliveries held and follow each invoice and what is still owed;
 * - `company`: verify or reject each invoice (income posts on verification) and record the payments.
 */
@Component({
  selector: 'app-invoices-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, SalesInvoiceForm, InvoicePaymentForm, OrderReasonForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>{{ mode() === 'distributor' ? 'Your sales invoices' : 'Distributor sales invoices' }}</h2>
          <p>{{ mode() === 'distributor'
            ? 'Report the containers you distributed. Zen Foods verifies each invoice, then it is due'
            : 'Containers distributors sold: verify to book the income, then collect' }}</p>
        </div>
        @if (canReport()) {
          <button appBtn variant="primary" icon="receipt" (click)="reportOpen.set(true)" [disabled]="!inStock()">Report sales</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="invoices()" [actions]="actions" [loading]="loading()" [error]="error()" [totals]="totals()"
          searchPlaceholder="Search invoices" emptyTitle="No sales invoices yet"
          emptyText="Invoices appear here once containers are reported as distributed." (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>

    <app-sales-invoice-form [(open)]="reportOpen" [shipments]="shipments()" [distributorId]="distributorId()" (saved)="changed.emit()" />
    <app-invoice-payment-form [(open)]="payOpen" [inv]="current()" (saved)="changed.emit()" />
    <app-order-reason-form [(open)]="rejectOpen" [order]="null" [heading]="'Reject ' + (current()?.refNo ?? '')" actionLabel="Reject invoice"
      hint="The distributor sees this. Its containers count as its stock again" [run]="rejectRun" done="Invoice rejected." (saved)="changed.emit()" />
  `,
})
export class InvoicesPanel {
  private api = inject(FactoryApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);

  readonly mode = input<'company' | 'distributor'>('company');
  readonly invoices = input<DistInvoice[]>([]);
  /** deliveries the distributor holds (for reporting sales) */
  readonly shipments = input<Shipment[]>([]);
  /** staff reporting for a distributor */
  readonly distributorId = input<string | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly canReport = input(false);
  readonly canManage = input(false);
  readonly changed = output<void>();

  protected reportOpen = signal(false);
  protected payOpen = signal(false);
  protected rejectOpen = signal(false);
  protected current = signal<DistInvoice | null>(null);
  protected rejectRun = (reason: string) => this.api.rejectInvoice(this.current()!.id, reason);
  protected inStock = computed(() => this.shipments().some((s) => s.status === 'Received' && s.onHandContainers > 0));

  protected columns = computed<TableColumn<DistInvoice>[]>(() => [
    { id: 'ref', label: 'Invoice', value: (i) => i.refNo, sub: (i) => `${fmtDate(i.date)}${i.invoiceNo ? ` · ${i.invoiceNo}` : ''}` },
    ...(this.mode() === 'company' ? [{ id: 'who', label: 'Distributor', value: (i: DistInvoice) => i.distributor.name, priority: 2 } as TableColumn<DistInvoice>] : []),
    {
      id: 'goods', label: 'Sold', value: (i) => `${fmtNumber(i.containers)} container${i.containers === 1 ? '' : 's'}`,
      sub: (i) => `${[...new Set(i.lines.map((l) => l.product.sku))].join(', ')} · ${fmtNumber(i.packets)} packets`,
    },
    { id: 'amount', label: 'Amount', kind: 'money', value: (i) => i.amount, sub: (i) => (i.paid > 0 ? `Paid ${fmtAmount(i.paid)}` : null) },
    { id: 'due', label: 'Still due', kind: 'money', priority: 2, value: (i) => i.due, sub: (i) => (i.status === 'Verified' ? `Due ${fmtDate(i.dueDate)}` : null) },
    { id: 'state', label: 'Status', kind: 'tag', value: (i) => i.state, tone, sub: (i) => i.reason },
  ]);
  protected totals = computed(() => {
    const rows = this.invoices().filter((i) => i.status === 'Verified');
    return rows.length ? { ref: 'Verified', amount: fmtAmount(rows.reduce((n, i) => n + i.amount, 0)), due: fmtAmount(rows.reduce((n, i) => n + i.due, 0)) } : undefined;
  });

  protected actions = (i: DistInvoice): RowAction[] => {
    const list: RowAction[] = [];
    if (this.canManage() && i.status === 'Submitted') list.push({ id: 'verify', label: 'Verify invoice', tone: 'success' }, { id: 'reject', label: 'Reject invoice', tone: 'danger' });
    if (this.canManage() && i.status === 'Verified' && i.due > 0) list.push({ id: 'pay', label: 'Record payment', tone: 'success' });
    list.push({ id: 'print', label: 'Print invoice' });
    return list;
  };

  protected async onAction(e: RowActionEvent<DistInvoice>) {
    const i = e.row;
    this.current.set(i);
    if (e.id === 'pay') return this.payOpen.set(true);
    if (e.id === 'reject') return this.rejectOpen.set(true);
    if (e.id === 'print') return printVoucher(salesInvoiceVoucher(i));
    if (e.id === 'verify') {
      const ok = await this.confirm.ask({
        title: `Verify ${i.refNo}?`,
        message: `${i.distributor.name} sold ${fmtNumber(i.containers)} container${i.containers === 1 ? '' : 's'} for ${fmtMoney(i.amount)}. The income and the receivable post, due ${fmtDate(i.dueDate)}.`,
        confirmLabel: 'Verify invoice',
      });
      if (!ok) return;
      this.api.verifyInvoice(i.id).subscribe({
        next: () => { this.toast.success('Invoice verified. Income booked.'); this.changed.emit(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }
}
