import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount, fmtDate, fmtMoney } from '../../shared/format';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { Manufacturer } from '../ops/models';
import { OrderReasonForm } from './answer-forms';
import { FactoryApi, PaymentRequest, Position, PositionRow } from './factory.api';
import { PayRequestForm, PaymentRequestForm } from './request-forms';
import { printVoucher } from '../../shared/print';
import { requestVoucher } from './vouchers';

/** tone of a request's state */
const stateTone = (r: PaymentRequest): Tone =>
  r.status === 'Rejected' ? 'danger' : r.status === 'Withdrawn' ? 'neutral' : !r.approved ? 'warning' : r.due > 0 ? 'info' : 'success';

/**
 * Manufacturer payment requests and what is owed, used by both sides:
 * - `company`: Finance signs (seat A / B), rejects or pays each request; everyone sees the position per order.
 * - `factory`: the manufacturer asks for the advance or the balance of an accepted order and can withdraw a
 *   request nobody has signed yet.
 */
@Component({
  selector: 'app-requests-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, PaymentRequestForm, PayRequestForm, OrderReasonForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>{{ mode() === 'company' ? 'Manufacturer payment requests' : 'Payment requests' }}</h2>
          <p>{{ mode() === 'company'
            ? 'Advance and balance invoices: approve with one or two signatures, then pay'
            : 'Ask Zen Foods for the advance or the balance of an accepted order' }}</p>
        </div>
        @if (mode() === 'factory' && canRequest()) {
          <button appBtn variant="primary" icon="plus" (click)="openRequest()" [disabled]="!openOrders()">Request payment</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="requests()" [actions]="actions" [loading]="loading()" [error]="error()"
          searchPlaceholder="Search requests" emptyTitle="No payment requests yet"
          [emptyText]="mode() === 'company' ? 'Requests from manufacturers appear here.' : 'Request the advance once an order is accepted.'"
          (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>

    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>{{ mode() === 'company' ? 'What we owe manufacturers' : 'Your account with Zen Foods' }}</h2>
          <p>Per order: value and advance, asked for, approved, paid and still to pay</p></div>
      </div>
      <div class="card__body">
        <app-data-table [columns]="positionColumns()" [rows]="position()?.rows ?? []" [totals]="positionTotals()" [loading]="loading()"
          [searchable]="false" emptyTitle="Nothing on order" emptyText="Accepted orders appear here." />
      </div>
    </div>

    <app-payment-request-form [(open)]="requestOpen" [rows]="position()?.rows ?? []" [manufacturer]="manufacturer()" (saved)="changed.emit()" />
    <app-pay-request-form [(open)]="payOpen" [req]="current()" (saved)="changed.emit()" />
    <app-order-reason-form [(open)]="rejectOpen" [order]="null" [heading]="'Reject ' + (current()?.refNo ?? '')" actionLabel="Reject request"
      hint="The manufacturer sees this" [run]="rejectRun" done="Request rejected." (saved)="changed.emit()" />
  `,
})
export class RequestsPanel {
  private api = inject(FactoryApi);
  private auth = inject(AuthService);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);

  readonly mode = input<'company' | 'factory'>('company');
  readonly requests = input<PaymentRequest[]>([]);
  readonly position = input<Position | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** factory mode: whose bank accounts the request can go to */
  readonly manufacturer = input<Manufacturer | null>(null);
  /** factory mode: may raise and withdraw requests (the manufacturer, or staff for it) */
  readonly canRequest = input(false);
  readonly changed = output<void>();

  protected requestOpen = signal(false);
  protected payOpen = signal(false);
  protected rejectOpen = signal(false);
  protected current = signal<PaymentRequest | null>(null);
  protected rejectRun = (reason: string) => this.api.rejectRequest(this.current()!.id, reason);

  /** company: Finance (and Admin) sign, reject and pay */
  private canDecide = computed(() => this.mode() === 'company' && this.auth.can('finance'));
  private seat = computed(() => this.auth.user()?.seat ?? 'None');
  protected openOrders = computed(() => (this.position()?.rows ?? []).some((r) => r.status === 'Accepted'));

  protected columns = computed<TableColumn<PaymentRequest>[]>(() => [
    { id: 'ref', label: 'Request', value: (r) => r.refNo, sub: (r) => `${fmtDate(r.date)}${r.invoiceNo ? ` · inv. ${r.invoiceNo}` : ''}` },
    {
      id: 'order', label: this.mode() === 'company' ? 'Manufacturer / order' : 'Order',
      value: (r) => (this.mode() === 'company' ? r.manufacturer.name : `${r.order.refNo} · ${r.order.product.sku}`),
      sub: (r) => (this.mode() === 'company' ? `${r.kind} · ${r.order.refNo}` : r.kind),
    },
    { id: 'amount', label: 'Amount', kind: 'money', value: (r) => r.amount, sub: (r) => (r.paid > 0 ? `Paid ${fmtAmount(r.paid)}` : null) },
    { id: 'bank', label: 'Pay into', priority: 2, value: (r) => r.bank.bank, sub: (r) => r.bank.account },
    { id: 'state', label: 'Status', kind: 'tag', value: (r) => r.state, tone: stateTone, sub: (r) => r.reason ?? (r.signatures.length ? `Signed ${r.signatures.join(' + ')}` : null) },
  ]);

  protected actions = (r: PaymentRequest): RowAction[] => {
    const list: RowAction[] = [];
    if (this.canDecide() && r.status === 'Submitted' && !r.approved) {
      for (const s of ['A', 'B'] as const) {
        if (!r.signatures.includes(s) && (this.seat() === s || this.seat() === 'Both')) list.push({ id: `sign-${s}`, label: `Sign as seat ${s}`, tone: 'success' });
      }
      list.push({ id: 'reject', label: 'Reject request', tone: 'danger' });
    }
    if (this.canDecide() && r.approved && r.due > 0) list.push({ id: 'pay', label: 'Pay', tone: 'success' });
    if (this.mode() === 'factory' && this.canRequest() && r.status === 'Submitted' && !r.signatures.length) list.push({ id: 'withdraw', label: 'Withdraw request', tone: 'danger' });
    list.push({ id: 'print', label: 'Print request' });
    return list;
  };

  protected positionColumns = computed<TableColumn<PositionRow>[]>(() => [
    {
      id: 'order', label: 'Order', value: (p) => `${p.refNo} · ${p.sku}`,
      sub: (p) => (this.mode() === 'company' ? p.manufacturer : null) ?? (p.status === 'Cancelled' ? 'Cancelled' : null),
    },
    { id: 'value', label: 'Order value', kind: 'money', value: (p) => p.value, sub: (p) => `Advance ${p.advancePct}% · ${fmtAmount(p.advance)}` },
    { id: 'requested', label: 'Asked for', kind: 'money', priority: 2, value: (p) => p.requested, sub: (p) => `Approved ${fmtAmount(p.approved)}` },
    { id: 'paid', label: 'Paid', kind: 'money', value: (p) => p.paid, sub: (p) => (p.advancePaid ? `Advance ${fmtAmount(p.advancePaid)}` : null) },
    { id: 'toPay', label: 'Still to pay', kind: 'money', value: (p) => p.toPay },
  ]);
  protected positionTotals = computed(() => {
    const t = this.position()?.totals;
    return t ? { order: 'Total', value: fmtAmount(t.value), requested: fmtAmount(t.requested), paid: fmtAmount(t.paid), toPay: fmtAmount(t.toPay) } : undefined;
  });

  /** open the request form (factory side) */
  openRequest() {
    this.requestOpen.set(true);
  }

  protected async onAction(e: RowActionEvent<PaymentRequest>) {
    const r = e.row;
    this.current.set(r);
    if (e.id === 'pay') return this.payOpen.set(true);
    if (e.id === 'reject') return this.rejectOpen.set(true);
    if (e.id === 'print') return printVoucher(requestVoucher(r));
    if (e.id === 'sign-A' || e.id === 'sign-B') {
      const seat = e.id === 'sign-A' ? 'A' : 'B';
      const ok = await this.confirm.ask({
        title: `Sign ${r.refNo} as seat ${seat}?`,
        message: `${r.kind} of ${fmtMoney(r.amount)} for ${r.manufacturer.name} (${r.order.refNo}). ${r.requiredSignatures === 2 ? 'Two signatures are needed.' : 'One signature approves it.'}`,
        confirmLabel: `Sign as seat ${seat}`,
      });
      if (!ok) return;
      this.api.signRequest(r.id, seat).subscribe({
        next: (x) => { this.toast.success(x.approved ? 'Approved. It can be paid now.' : 'Signed. One more signature is needed.'); this.changed.emit(); },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }
    if (e.id === 'withdraw') {
      const ok = await this.confirm.ask({ title: `Withdraw ${r.refNo}?`, message: 'Zen Foods will no longer see it as a request to pay.', confirmLabel: 'Withdraw request', tone: 'danger' });
      if (!ok) return;
      this.api.withdraw(r.id).subscribe({
        next: () => { this.toast.success('Request withdrawn.'); this.changed.emit(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }
}
