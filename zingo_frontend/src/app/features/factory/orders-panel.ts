import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { errorText } from '../../shared/errors';
import { Tone, docDate, subLine, fmtDate, fmtMoney, fmtNumber, productLabel, qtyLabel } from '../../shared/format';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { Distributor, Manufacturer, Product } from '../ops/models';
import { AcceptOrderForm, OrderReasonForm, OrderStageForm, OrderTimeline } from './answer-forms';
import { FactoryApi, ORDER_TONE, OrderRow, PaymentRequest, Position, ProductionOrder, groupOrders, groupTotals, orderRef, orderState } from './factory.api';
import { PaymentRequestForm } from './request-forms';
import { Observable, concat, toArray } from 'rxjs';
import { ProductionOrderForm } from './order-form';
import { printVoucher } from '../../shared/print';
import { orderVoucher } from './vouchers';

/**
 * The production orders table with every action on it, used by both sides:
 * - `company` (Manufacturing page): place, edit, send, delete and cancel orders; staff may also answer for a
 *   manufacturer that does not use its portal.
 * - `factory` (manufacturer portal): accept or reject an order and report each production step.
 */
@Component({
  selector: 'app-orders-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ProductionOrderForm, AcceptOrderForm, OrderReasonForm, OrderStageForm, OrderTimeline, PaymentRequestForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>{{ mode() === 'company' ? 'Production orders' : 'Orders from Zen Foods' }}</h2>
          <p>{{ mode() === 'company'
            ? 'Containers ordered from manufacturers: sent, accepted and in production'
            : 'Accept or reject each order, then report every production step' }}</p>
        </div>
        @if (mode() === 'company' && canPlace()) {
          <button appBtn variant="primary" icon="plus" (click)="openNew()">New production order</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="rows()" [actions]="actions" [loading]="loading()" [error]="error()"
          searchPlaceholder="Search orders" [emptyTitle]="mode() === 'company' ? 'No production orders yet' : 'No orders yet'"
          [emptyText]="mode() === 'company' ? 'Place the first order with a manufacturer.' : 'Orders from Zen Foods appear here.'"
          (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>

    <app-production-order-form [(open)]="formOpen" [order]="editing()" [products]="products()" [manufacturers]="manufacturers()"
      [distributors]="distributors()" (saved)="changed.emit()" />
    <app-accept-order-form [(open)]="acceptOpen" [order]="current()" [group]="current()?.group ?? []" (saved)="changed.emit()" />
    <app-order-stage-form [(open)]="stageOpen" [order]="current()" [group]="current()?.group ?? []" [stages]="stages()" (saved)="changed.emit()" />
    <app-order-reason-form [(open)]="reasonOpen" [order]="current()" [heading]="reason().heading" [actionLabel]="reason().action"
      [hint]="reason().hint" [run]="reason().run" [done]="reason().done" (saved)="changed.emit()" />
    <app-order-timeline [(open)]="timelineOpen" [order]="current()" />
    @if (mode() === 'factory') {
      <app-payment-request-form [(open)]="invoiceOpen" [rows]="position()?.rows ?? []" [manufacturer]="manufacturer()" [orderId]="invoiceFor()" kind="Balance" (saved)="changed.emit()" />
    }
  `,
})
export class OrdersPanel {
  private api = inject(FactoryApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);

  readonly mode = input<'company' | 'factory'>('company');
  readonly orders = input<ProductionOrder[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly products = input<Product[]>([]);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly distributors = input<Distributor[]>([]);
  /** the production steps, in order (Settings list) */
  readonly stages = input<string[]>([]);
  /** may place, change and cancel orders (company staff) */
  readonly canPlace = input(false);
  /** may accept, reject and report progress (the manufacturer, or staff acting for it) */
  readonly canAnswer = input(false);
  /** manufacturer portal: its invoices and payment position, so an order row can raise a payment request */
  readonly requests = input<PaymentRequest[]>([]);
  readonly position = input<Position | null>(null);
  readonly manufacturer = input<Manufacturer | null>(null);
  /** something changed: reload */
  readonly changed = output<void>();
  protected invoiceOpen = signal(false);
  protected invoiceFor = signal<string | null>(null);
  /** the first line of the order that left the factory and still has something to ask for */
  private invoiceLine = (o: OrderRow) => o.group.find((x) => {
    const row = this.position()?.rows.find((r) => r.orderId === x.id);
    return (x.readyContainers != null || x.shippedContainers > 0) && !!row && row.value - row.requested > 0.01;
  }) ?? null;

  protected formOpen = signal(false);
  protected acceptOpen = signal(false);
  protected stageOpen = signal(false);
  protected reasonOpen = signal(false);
  protected timelineOpen = signal(false);
  protected editing = signal<ProductionOrder | null>(null);
  protected current = signal<OrderRow | null>(null);
  /** one row per combined order (a distributor order of several products is one order here) */
  protected rows = computed(() => groupOrders(this.orders()));
  protected reason = signal<{ heading: string; action: string; hint: string; done: string; run: ((r: string) => Observable<unknown>) | undefined }>({
    heading: '', action: '', hint: '', done: '', run: undefined,
  });

  protected columns = computed<TableColumn<OrderRow>[]>(() => [
    {
      id: 'order', label: 'Order / Deliver to', kind: 'title',
      value: (o) => (o.group.length > 1 ? `${o.group.length} products` : productLabel(o.product)),
      sub: (o) => subLine(o.group.length > 1 ? o.group.map((x) => x.product.name).join(', ') : null, destination(o)),
    },
    {
      id: 'ref', label: 'Order no. / quantity', kind: 'mono', value: (o) => orderRef(o), sortValue: (o) => o.date,
      sub: (o) => {
        const t = groupTotals(o);
        return subLine(docDate(o), o.group.length > 1 ? o.group.map((x) => x.refNo).join(', ') : null,
          o.group.length > 1 ? `${fmtNumber(t.containers)} containers · ${fmtNumber(t.bundles)} bundles`
            : qtyLabel(o.containers, o.bundles, o.containerUnit ?? o.product.containerUnit), `${fmtNumber(t.packets)} packets`);
      },
    },
    this.mode() === 'company'
      ? { id: 'who', label: 'Manufacturer', priority: 2, value: (o) => o.manufacturer.name, sub: (o) => (o.dueDate ? `due ${fmtDate(o.dueDate)}` : null) }
      : { id: 'who', label: 'Due date', priority: 2, value: (o) => (o.dueDate ? fmtDate(o.dueDate) : 'No date'), sortValue: (o) => o.dueDate ?? '' },
    { id: 'value', label: 'Order value', kind: 'money', value: (o) => groupTotals(o).value, sub: (o) => `Advance ${o.advancePct}% · ${fmtMoney(groupTotals(o).advance)}`, priority: 2 },
    ...(this.mode() === 'company' ? [{
      id: 'margin', label: 'Margin', kind: 'money' as const, priority: 2 as const,
      value: (o: OrderRow) => groupTotals(o).margin,
      valueTone: (o: OrderRow): Tone => ((groupTotals(o).margin ?? 0) < 0 ? 'danger' : 'success'),
      sub: (o: OrderRow) => {
        const t = groupTotals(o);
        return t.inflow === null ? null : `In ${fmtMoney(t.inflow)} · Out ${fmtMoney(t.value)}`;
      },
      tip: () => 'Inflow: what the distributor pays for these goods (its agreed rate, else the distributor price). Outflow: what the manufacturer is paid. Margin = inflow − outflow.',
    }] : []),
    {
      id: 'status', label: 'Status', kind: 'tag', value: (o) => orderState(o), tone: (o) => (o.overdue ? 'danger' : ORDER_TONE[o.status]),
      sub: (o) => (o.overdue ? `Late · due ${fmtDate(o.dueDate!)}` : o.readyDate ? `Ready by ${fmtDate(o.readyDate)}` : null),
    },
  ]);

  protected actions = (o: OrderRow): RowAction[] => {
    const list: RowAction[] = [];
    const company = this.mode() === 'company';
    if (company && this.canPlace() && o.status === 'Draft') {
      list.push({ id: 'send', label: 'Send to manufacturer', tone: 'success' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' });
    }
    if (this.canAnswer() && o.group.every((x) => x.status === 'Sent')) {
      list.push({ id: 'accept', label: company ? 'Accept for manufacturer' : 'Accept order', tone: 'success' }, { id: 'reject', label: company ? 'Reject for manufacturer' : 'Reject order', tone: 'danger' });
    }
    // until it is dispatched: the last step opens the Ready to Dispatch form
    // (an order whose goods already left the factory, e.g. shipped before Ready to dispatch existed, is done)
    if (this.canAnswer() && o.group.every((x) => x.status === 'Accepted') && o.group.some((x) => x.readyContainers == null && x.shippedContainers < x.containers)) {
      const last = this.stages()[this.stages().length - 1];
      list.push({ id: 'stage', label: o.stage === last ? 'Ready to dispatch' : 'Report progress', tone: o.stage === last ? 'success' : undefined });
    }
    if (company && this.canPlace() && (o.status === 'Sent' || (o.status === 'Accepted' && !o.shippedContainers))) list.push({ id: 'cancel', label: 'Cancel order', tone: 'danger' });
    // after Ready to dispatch: ask Zen Foods to pay (the invoice), straight from the order
    if (!company && this.canAnswer() && this.invoiceLine(o)) list.push({ id: 'invoice', label: 'Payment request', tone: 'success' });
    list.push({ id: 'view', label: 'View order and timeline' }, { id: 'print', label: 'Voucher' });
    return list;
  };

  /** open the form for a new order (also used by page buttons) */
  openNew() {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  protected async onAction(e: RowActionEvent<OrderRow>) {
    const o = e.row;
    this.current.set(o);
    switch (e.id) {
      case 'edit':
        this.editing.set(o);
        this.formOpen.set(true);
        return;
      case 'view':
        this.timelineOpen.set(true);
        return;
      case 'print':
        printVoucher(orderVoucher(o));
        return;
      case 'accept':
        this.acceptOpen.set(true);
        return;
      case 'stage':
        this.stageOpen.set(true);
        return;
      case 'invoice':
        this.invoiceFor.set(this.invoiceLine(o)?.id ?? null);
        this.invoiceOpen.set(true);
        return;
      case 'reject':
        this.reason.set({
          heading: `Reject ${orderRef(o)}`, action: 'Reject order', hint: this.mode() === 'company' ? 'Recorded as the manufacturer\'s answer' : 'Zen Foods sees this',
          done: 'Order rejected.', run: (r) => this.api.rejectGroup(o.group.map((x) => x.id), r),
        });
        this.reasonOpen.set(true);
        return;
      case 'cancel':
        this.reason.set({
          heading: `Cancel ${orderRef(o)}`, action: 'Cancel order', hint: 'The manufacturer sees this',
          done: 'Order cancelled.', run: (r) => concat(...o.group.map((x) => this.api.cancel(x.id, r))).pipe(toArray()),
        });
        this.reasonOpen.set(true);
        return;
      case 'send': {
        const ok = await this.confirm.ask({
          title: `Send ${o.refNo} to ${o.manufacturer.name}?`,
          message: `${fmtNumber(o.containers)} container${o.containers > 1 ? 's' : ''} of ${o.product.sku} for ${fmtMoney(o.value)}, ${o.advancePct}% advance. A sent order can no longer be edited.`,
          confirmLabel: 'Send order',
        });
        if (!ok) return;
        this.api.send(o.id).subscribe({
          next: () => { this.toast.success('Order sent. The manufacturer sees it in its portal.'); this.changed.emit(); },
          error: (err) => this.toast.error(errorText(err)),
        });
        return;
      }
      case 'delete': {
        const ok = await this.confirm.ask({
          title: `Delete draft ${o.refNo}?`, message: 'This draft order will be removed. This cannot be undone.', confirmLabel: 'Delete draft', tone: 'danger',
        });
        if (!ok) return;
        this.api.remove(o.id).subscribe({
          next: () => { this.toast.success('Draft deleted.'); this.changed.emit(); },
          error: (err) => this.toast.error(errorText(err)),
        });
      }
    }
  }
}

/** where the containers go */
const destination = (o: ProductionOrder) => (o.destination === 'Warehouse' ? 'Zen Foods warehouse' : o.distributor?.name ?? 'a distributor');
