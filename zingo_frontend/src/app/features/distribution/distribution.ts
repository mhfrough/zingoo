import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FactoryApi } from '../factory/factory.api';
import { ShipmentsPanel } from '../factory/shipments-panel';
import { InvoicesPanel } from '../factory/invoices-panel';
import { TrailPanel } from '../factory/trail-panel';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TabItem, TabPanel, Tabs, TableColumn, ToastService,
} from '../../ui';
import { CollectionRow, Distributor, Order } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { CollectionForm } from './collection-form';
import { CreditOverrideForm } from './credit-override-form';
import { DistributorForm } from './distributor-form';
import { OrderForm } from './order-form';

interface DistributorRow {
  d: Distributor;
  orders: number;
  sales: number;
  due: number;
}

@Component({
  selector: 'app-distribution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Btn, DataTable, Kpi, PageHeader, Tabs, TabPanel, OrderForm, CollectionForm, DistributorForm, CreditOverrideForm, ShipmentsPanel, InvoicesPanel, TrailPanel],
  templateUrl: './distribution.html',
})
export class Distribution {
  private api = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  private router = inject(Router);
  protected auth = inject(AuthService);

  /** ?new=order opens the order form straight away (used by the Overview quick-add button) */
  readonly new = input<string>();

  private tick = signal(0);
  protected orders = rxResource({ params: () => this.tick(), stream: () => this.api.orders() });
  protected distributors = rxResource({ params: () => this.tick(), stream: () => this.api.distributors() });
  protected collections = rxResource({ params: () => this.tick(), stream: () => this.api.collections() });
  protected products = rxResource({ params: () => this.tick(), stream: () => this.api.products() });
  protected settings = rxResource({ stream: () => this.api.settings() });
  private factory = inject(FactoryApi);
  /** manufacturer deliveries to distributors and the stock they hold (consignment) */
  protected shipments = rxResource({ params: () => this.tick(), stream: () => this.factory.shipments() });
  protected distStock = rxResource({ params: () => this.tick(), stream: () => this.factory.stock() });
  protected distInvoices = rxResource({ params: () => this.tick(), stream: () => this.factory.invoices() });
  protected trail = rxResource({ params: () => this.tick(), stream: () => this.factory.trail() });
  /** Admin, Finance and Distribution verify invoices and record payments */
  protected canManageInvoices = computed(() => ['Admin', 'Finance', 'Distribution'].includes(this.auth.user()?.role ?? ''));
  /** the earlier warehouse sales-order flow, shown only when switched on in Settings */
  protected legacy = computed(() => !!this.settings.value()?.salesOrdersEnabled);

  // ───────────── the consignment flow at a glance ─────────────
  private verified = computed(() => (this.distInvoices.value() ?? []).filter((i) => i.status === 'Verified'));
  protected salesInvoiced = computed(() => this.verified().reduce((n, i) => n + i.amount, 0));
  protected salesCollected = computed(() => this.verified().reduce((n, i) => n + i.paid, 0));
  protected salesDue = computed(() => this.verified().reduce((n, i) => n + i.due, 0));
  protected containersSold = computed(() => this.verified().reduce((n, i) => n + i.containers, 0));
  protected overdueInvoices = computed(() => this.verified().filter((i) => i.overdue).length);
  protected toVerify = computed(() => (this.distInvoices.value() ?? []).filter((i) => i.status === 'Submitted').length);
  protected containersHeld = computed(() => (this.distStock.value()?.byProduct ?? []).reduce((n, r) => n + r.containers, 0));
  /** the earlier sales orders are read-only while the flow is switched off */
  protected noActions = (): RowAction[] => [];

  protected tab = signal('sales');
  protected tabs = computed<TabItem[]>(() => {
    const toReceive = (this.shipments.value() ?? []).filter((s) => s.status === 'In transit').length;
    return [
      { id: 'sales', label: 'Sales invoices', icon: 'receipt', count: this.toVerify() || null },
      { id: 'stock', label: 'Deliveries & stock', icon: 'truck', count: toReceive || null },
      { id: 'distributors', label: 'Distributors', icon: 'users' },
      { id: 'orders', label: this.legacy() ? 'Sales orders' : 'Earlier sales orders', icon: 'package' },
    ];
  });

  protected canWrite = computed(() => this.auth.can('distribution'));
  protected canOverride = computed(() => this.auth.can('finance'));

  // form state
  protected orderOpen = signal(false);
  protected editingOrder = signal<Order | null>(null);
  protected collectOpen = signal(false);
  protected collectingOrder = signal<Order | null>(null);
  protected distributorOpen = signal(false);
  protected editingDistributor = signal<Distributor | null>(null);
  protected overrideOpen = signal(false);
  protected overrideOrder = signal<Order | null>(null);

  // ───────────── numbers ─────────────
  private dispatched = computed(() => (this.orders.value() ?? []).filter((o) => o.status === 'Dispatched'));
  protected invoiced = computed(() => this.dispatched().reduce((n, o) => n + o.billed, 0));
  protected received = computed(() => this.dispatched().reduce((n, o) => n + o.collected, 0));
  protected receivable = computed(() => this.dispatched().reduce((n, o) => n + o.outstanding, 0));
  protected waiting = computed(() => (this.orders.value() ?? []).filter((o) => o.status === 'Draft').length);

  protected fmtMoney = fmtMoney;
  protected fmtNumber = fmtNumber;

  constructor() {
    effect(() => {
      if (this.new() !== 'order' || !this.canWrite()) return;
      untracked(() => {
        this.openOrder();
        this.router.navigate([], { queryParams: { new: null }, replaceUrl: true });
      });
    });
  }

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  // ───────────── sales orders ─────────────
  protected orderColumns: TableColumn<Order>[] = [
    { id: 'order', label: 'Order', value: (o) => o.refNo, sub: (o) => fmtDate(o.date) },
    { id: 'distributor', label: 'Distributor', value: (o) => o.distributor.name, sub: (o) => o.distributor.region },
    { id: 'product', label: 'Product', value: (o) => `${o.product.name} · Rs ${o.product.pack}`, sub: (o) => o.product.sku, priority: 2 },
    { id: 'cartons', label: 'Bundles', kind: 'number', value: (o) => o.cartons, priority: 3 },
    {
      id: 'invoice', label: 'Invoice (PKR)', kind: 'money', value: (o) => o.billed,
      sub: (o) => (o.status === 'Dispatched' ? `Due ${fmtAmount(o.outstanding)} · ${fmtDate(o.dueDate)}` : o.creditHold ? 'Over credit limit' : null),
    },
    {
      id: 'status', label: 'Status', kind: 'tag', priority: 2,
      value: (o) => (o.creditHold ? 'Credit hold' : o.status === 'Dispatched' && o.outstanding <= 0 ? 'Settled' : o.status),
      tone: (o): Tone => (o.creditHold ? 'danger' : o.status === 'Draft' ? 'warning' : o.outstanding <= 0 ? 'success' : 'info'),
    },
  ];

  protected orderActions = (o: Order): RowAction[] => {
    const acts: RowAction[] = [];
    if (o.status === 'Draft') {
      if (this.canWrite()) {
        if (o.creditHold) {
          if (this.canOverride()) acts.push({ id: 'override', label: 'Override hold', tone: 'success' });
        } else {
          acts.push({ id: 'dispatch', label: 'Dispatch', tone: 'success' });
        }
        acts.push({ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' });
      }
    } else if (o.outstanding > 0 && this.canWrite()) {
      acts.push({ id: 'collect', label: 'Collect payment', tone: 'success' });
    }
    return acts;
  };

  protected async onOrderAction(e: RowActionEvent<Order>) {
    const o = e.row;
    if (e.id === 'edit') return this.openOrder(o);
    if (e.id === 'collect') { this.collectingOrder.set(o); this.collectOpen.set(true); return; }
    if (e.id === 'override') { this.overrideOrder.set(o); this.overrideOpen.set(true); return; }

    if (e.id === 'dispatch') {
      const ok = await this.confirm.ask({
        title: `Dispatch order ${o.refNo}?`,
        message: `${fmtNumber(o.cartons)} bundles of ${o.product.sku} go to ${o.distributor.name}. Stock goes down and an invoice for ${fmtMoney(o.billed)} is created.`,
        confirmLabel: 'Dispatch order',
      });
      if (!ok) return;
      this.api.dispatchOrder(o.id).subscribe({
        next: () => { this.toast.success('Order dispatched. Stock reduced and receivable created.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }

    if (e.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete draft order ${o.refNo}?`,
        message: 'This draft order will be removed. This cannot be undone.',
        confirmLabel: 'Delete order',
        tone: 'danger',
      });
      if (!ok) return;
      this.api.deleteOrder(o.id).subscribe({
        next: () => { this.toast.success('Draft order deleted.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  protected openOrder(o: Order | null = null) {
    this.editingOrder.set(o);
    this.orderOpen.set(true);
  }

  // ───────────── distributors ─────────────
  protected distributorRows = computed<DistributorRow[]>(() => {
    const dispatched = this.dispatched();
    return (this.distributors.value() ?? []).map((d) => {
      const mine = dispatched.filter((o) => o.distributorId === d.id);
      return { d, orders: mine.length, sales: mine.reduce((n, o) => n + o.billed, 0), due: mine.reduce((n, o) => n + o.outstanding, 0) };
    });
  });

  protected distributorColumns: TableColumn<DistributorRow>[] = [
    { id: 'name', label: 'Distributor', value: (r) => r.d.name, sub: (r) => r.d.contact },
    {
      id: 'region', label: 'Territory', value: (r) => `${r.d.region}${r.d.exclusive ? ' · exclusive' : ''}`, priority: 2,
      sub: (r) => `${r.d.status && r.d.status !== 'Active' ? r.d.status + ' · ' : ''}Terms ${r.d.paymentDays ? r.d.paymentDays + ' days' : 'no limit'}`,
    },
    { id: 'orders', label: 'Orders', kind: 'number', value: (r) => r.orders, priority: 3 },
    { id: 'sales', label: 'Sales (PKR)', kind: 'money', value: (r) => r.sales, sub: (r) => (r.d.creditLimit > 0 ? `Limit ${fmtAmount(r.d.creditLimit)}` : 'No credit limit') },
    { id: 'due', label: 'Due (PKR)', kind: 'money', value: (r) => r.due },
  ];
  protected distributorActions = (): RowAction[] => (this.canWrite() ? [{ id: 'edit', label: 'Edit' }] : []);

  protected openDistributor(d: Distributor | null = null) {
    this.editingDistributor.set(d);
    this.distributorOpen.set(true);
  }

  // ───────────── collections ─────────────
  protected collectionColumns: TableColumn<CollectionRow>[] = [
    { id: 'receipt', label: 'Receipt', value: (c) => c.refNo, sub: (c) => fmtDate(c.date) },
    { id: 'order', label: 'Sales order', value: (c) => c.order.refNo, sub: (c) => c.order.distributor.name },
    { id: 'amount', label: 'Received (PKR)', kind: 'money', value: (c) => c.amount },
    { id: 'method', label: 'Method', value: (c) => c.method, sub: (c) => c.note, priority: 2 },
  ];
}
