import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { errorText } from '../../shared/errors';
import { fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { Distributor, Manufacturer, Product } from '../ops/models';
import { AcceptOrderForm, OrderReasonForm, OrderStageForm, OrderTimeline } from './answer-forms';
import { FactoryApi, ORDER_TONE, ProductionOrder, orderState } from './factory.api';
import { ProductionOrderForm } from './order-form';

/**
 * The production orders table with every action on it, used by both sides:
 * - `company` (Manufacturing page): place, edit, send, delete and cancel orders; staff may also answer for a
 *   manufacturer that does not use its portal.
 * - `factory` (manufacturer portal): accept or reject an order and report each production step.
 */
@Component({
  selector: 'app-orders-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ProductionOrderForm, AcceptOrderForm, OrderReasonForm, OrderStageForm, OrderTimeline],
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
        <app-data-table [columns]="columns()" [rows]="orders()" [actions]="actions" [loading]="loading()" [error]="error()"
          searchPlaceholder="Search orders" [emptyTitle]="mode() === 'company' ? 'No production orders yet' : 'No orders yet'"
          [emptyText]="mode() === 'company' ? 'Place the first order with a manufacturer.' : 'Orders from Zen Foods appear here.'"
          (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>

    <app-production-order-form [(open)]="formOpen" [order]="editing()" [products]="products()" [manufacturers]="manufacturers()"
      [distributors]="distributors()" (saved)="changed.emit()" />
    <app-accept-order-form [(open)]="acceptOpen" [order]="current()" (saved)="changed.emit()" />
    <app-order-stage-form [(open)]="stageOpen" [order]="current()" [stages]="stages()" (saved)="changed.emit()" />
    <app-order-reason-form [(open)]="reasonOpen" [order]="current()" [heading]="reason().heading" [actionLabel]="reason().action"
      [hint]="reason().hint" [run]="reason().run" [done]="reason().done" (saved)="changed.emit()" />
    <app-order-timeline [(open)]="timelineOpen" [order]="current()" />
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
  /** something changed: reload */
  readonly changed = output<void>();

  protected formOpen = signal(false);
  protected acceptOpen = signal(false);
  protected stageOpen = signal(false);
  protected reasonOpen = signal(false);
  protected timelineOpen = signal(false);
  protected editing = signal<ProductionOrder | null>(null);
  protected current = signal<ProductionOrder | null>(null);
  protected reason = signal<{ heading: string; action: string; hint: string; done: string; run: ((r: string) => ReturnType<FactoryApi['reject']>) | undefined }>({
    heading: '', action: '', hint: '', done: '', run: undefined,
  });

  protected columns = computed<TableColumn<ProductionOrder>[]>(() => [
    { id: 'ref', label: 'Order', value: (o) => o.refNo, sub: (o) => fmtDate(o.date) },
    {
      id: 'product', label: 'Product', value: (o) => `${fmtNumber(o.containers)} × ${o.product.sku}`,
      sub: (o) => `${fmtNumber(o.bundles)} bundles · ${fmtNumber(o.packets)} packets`,
    },
    this.mode() === 'company'
      ? { id: 'who', label: 'Manufacturer', priority: 2, value: (o) => o.manufacturer.name, sub: (o) => `to ${destination(o)}` }
      : { id: 'who', label: 'Deliver to', priority: 2, value: (o) => destination(o), sub: (o) => (o.dueDate ? `by ${fmtDate(o.dueDate)}` : null) },
    { id: 'value', label: 'Order value', kind: 'money', value: (o) => o.value, sub: (o) => `Advance ${o.advancePct}% · ${fmtMoney(o.advanceAmount)}`, priority: 2 },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (o) => orderState(o), tone: (o) => (o.overdue ? 'danger' : ORDER_TONE[o.status]),
      sub: (o) => (o.overdue ? `Late · due ${fmtDate(o.dueDate!)}` : o.readyDate ? `Ready by ${fmtDate(o.readyDate)}` : null),
    },
  ]);

  protected actions = (o: ProductionOrder): RowAction[] => {
    const list: RowAction[] = [];
    const company = this.mode() === 'company';
    if (company && this.canPlace() && o.status === 'Draft') {
      list.push({ id: 'send', label: 'Send to manufacturer', tone: 'success' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' });
    }
    if (this.canAnswer() && o.status === 'Sent') {
      list.push({ id: 'accept', label: company ? 'Accept for manufacturer' : 'Accept order', tone: 'success' }, { id: 'reject', label: company ? 'Reject for manufacturer' : 'Reject order', tone: 'danger' });
    }
    if (this.canAnswer() && o.status === 'Accepted') list.push({ id: 'stage', label: 'Report progress' });
    if (company && this.canPlace() && (o.status === 'Sent' || (o.status === 'Accepted' && !o.shippedContainers))) list.push({ id: 'cancel', label: 'Cancel order', tone: 'danger' });
    list.push({ id: 'view', label: 'View order and timeline' });
    return list;
  };

  /** open the form for a new order (also used by page buttons) */
  openNew() {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  protected async onAction(e: RowActionEvent<ProductionOrder>) {
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
      case 'accept':
        this.acceptOpen.set(true);
        return;
      case 'stage':
        this.stageOpen.set(true);
        return;
      case 'reject':
        this.reason.set({
          heading: `Reject ${o.refNo}`, action: 'Reject order', hint: this.mode() === 'company' ? 'Recorded as the manufacturer\'s answer' : 'Zen Foods sees this',
          done: 'Order rejected.', run: (r) => this.api.reject(o.id, r),
        });
        this.reasonOpen.set(true);
        return;
      case 'cancel':
        this.reason.set({
          heading: `Cancel ${o.refNo}`, action: 'Cancel order', hint: 'The manufacturer sees this',
          done: 'Order cancelled.', run: (r) => this.api.cancel(o.id, r),
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
