import { concat, toArray } from 'rxjs';
import { OrderTimeline } from '../factory/answer-forms';
import { recall, remember } from '../../shared/remember';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FactoryApi } from '../factory/factory.api';
import { ShipmentsPanel } from '../factory/shipments-panel';
import { DeliveryClaimsPanel } from '../factory/delivery-claims-panel';
import { InvoicesPanel } from '../factory/invoices-panel';
import { TrailPanel } from '../factory/trail-panel';
import { IncomingPanel } from '../factory/incoming-panel';
import { DispatchesPanel } from '../factory/dispatches-panel';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { downloadCsv } from '../../shared/csv';
import { errorText } from '../../shared/errors';
import { downloadBase64, downloadText } from '../../shared/files';
import { docDate, dueCountdown, dueTone, qtyLabel, subLine, Tone, fmtAmount2, fmtDate, fmtMoney, fmtNumber, fmtPct, productLabel, setNumberLocale } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Help, Kpi, PageHeader, RowAction, SelectOption, ViewAs, RowActionEvent, TabItem, TabPanel, Tabs, Tag, TableColumn, ToastService,
} from '../../ui';
import { OpsApi } from '../ops/ops.api';
import { AcceptForm } from './accept-form';
import { AdviceForm, payableOf } from './advice-form';
import { PortalApi } from './portal.api';
import {
  AuditRow, DeskOrder, DeskRequest, OrderMoney, PortalAdvice, PortalOrder, PortalRate, PortalReceipt, PortalRequest, StatementEntry, StatementInvoice,
} from './portal.models';
import { ReasonForm } from './reason-form';
import { ReceiptForm } from './receipt-form';
import { RequestForm } from './request-form';
import { IntlPortal } from './intl-portal';
import { OrderLedger, OrderPay, daysTone } from './order-money';

const STATUS_TONE: Record<string, Tone> = {
  Paid: 'success', Confirmed: 'success', Accepted: 'success', Approved: 'success', Open: 'info', 'Part paid': 'info',
  Overdue: 'danger', Rejected: 'danger', Disputed: 'danger', Submitted: 'warning', Requested: 'warning', 'Awaiting dispatch': 'warning',
};
const tone = (s: string): Tone => STATUS_TONE[s] ?? 'neutral';

/** what a finished order is called: "Ready to ship" for a distributor abroad, "Ready to deliver" at home (set by the portal) */
let readyWord = 'Ready to deliver';
export const setReadyWord = (international: boolean) => (readyWord = international ? 'Ready to ship' : 'Ready to deliver');

/** where a distributor order stands: the manufacturer's answer and progress once it became a production order */
const orderState = (r: PortalRequest): { label: string; tone: Tone } => {
  const o = r.productionOrder;
  if (!o) return { label: r.status === 'Requested' ? 'Waiting' : r.status, tone: tone(r.status) };
  switch (o.status) {
    case 'Draft': return { label: 'Accepted by Zingo', tone: 'info' };
    case 'Sent': return { label: 'Acceptance pending', tone: 'warning' };
    case 'Accepted': {
      const all = o.containers ?? 0;
      if (all && (o.received ?? 0) >= all) return { label: 'Received', tone: 'success' };
      if (o.received) return { label: `Part received ${o.received}/${all}`, tone: 'info' };
      if (o.shipped) return { label: 'On the way', tone: 'warning' };
      if (o.stage && /ready/i.test(o.stage)) return { label: readyWord, tone: 'success' };
      return { label: o.stage ?? 'In production', tone: 'info' };
    }
    case 'Rejected': return { label: 'Manufacturer declined', tone: 'danger' };
    case 'Cancelled': return { label: 'Cancelled', tone: 'danger' };
    default: return { label: o.status, tone: 'neutral' };
  }
};
/** "MO-017 · Al-Noor Foods · ready 21 Nov 2026" */
const orderLine = (r: PortalRequest) => {
  const o = r.productionOrder;
  if (!o) return r.order ? `Order ${r.order.refNo}` : r.reviewNote;
  return [o.readyDate ? `ready ${fmtDate(o.readyDate)}` : null,
    o.expectedDate && o.status === 'Accepted' && (o.received ?? 0) < (o.containers ?? 1) ? `expected ${fmtDate(o.expectedDate)}` : null, o.reason].filter(Boolean).join(' · ');
};
/** "Masala Masti · Z10-MAS" */

/**
 * Distributor partner portal. A distributor sees its own account: orders and requests, deliveries and claims,
 * payments and credit, agreed prices and the statement. Staff see the same for any distributor, and the approval desk:
 * requests to accept, payment advices to verify and damage claims to review. Only verified payments reach cash.
 */
/**
 * One row per distributor order: the product lines of one DO- number together (`byMaker` also splits them per
 * manufacturer, as the manufacturer sees them). A request without a DO- number is its own row.
 */
type Grouped<T> = T & { group: T[] };
function groupRequests<T extends PortalRequest>(list: T[], byMaker = false): Grouped<T>[] {
  const key = (r: T) => (r.groupRef ? `${r.groupRef}${byMaker ? `|${r.productionOrder?.manufacturer?.name ?? ''}` : ''}` : r.id);
  const map = new Map<string, T[]>();
  for (const r of list) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
  return [...map.values()].map((g) => {
    const sorted = [...g].sort((a, b) => a.refNo.localeCompare(b.refNo));
    return { ...sorted[0], group: sorted };
  });
}

/** "2 products: Masala Masti, Ketchup Tango" or the product */
const groupTitle = <T extends PortalRequest>(r: Grouped<T>) => (r.group.length > 1 ? `${r.group.length} products` : productLabel(r.product));
/** each line's quantity, or the one line's */
const groupQty = <T extends PortalRequest>(r: Grouped<T>) =>
  (r.group.length > 1 ? r.group.map((x) => `${x.product.sku}: ${reqQty(x)}`).join(' · ') : reqQty(r));
/** the status of each manufacturer's part when they differ */
const groupLine = <T extends PortalRequest>(r: Grouped<T>) => {
  const parts = [...new Set(r.group.map((x) => orderState(x).label))];
  return parts.length > 1 ? parts.join(' · ') : orderLine(r);
};

/** "2 containers (Bora) · 10 bundles" for a request that asked for containers, else "10 bundles" (older requests) */
function reqQty(r: PortalRequest): string {
  return r.containers ? qtyLabel(r.containers, r.cartons, r.containerUnit ?? r.product.containerUnit) : `${fmtNumber(r.cartons)} bundles`;
}

/** green = fully paid, amber = part paid, red = overdue with money still open; no colour while nothing is due */
function paidTone(o: PortalOrder): Tone | null {
  if (o.billed > 0 && o.collected + o.credited >= o.billed - 0.01) return 'success';
  if (o.portalStatus === 'Overdue') return 'danger';
  return o.collected > 0 ? 'warning' : null;
}

/** "Fully paid", "95% settled · 1 payment · 2,700.00 credited", "Nothing paid" (+ money reported and not yet checked) */
function paidLine(o: PortalOrder): string {
  const n = o.payments?.length ?? 0;
  const pending = o.pendingAdvice > 0 ? ` · ${fmtAmount2(o.pendingAdvice)} being checked` : '';
  if (o.billed > 0 && o.collected + o.credited >= o.billed - 0.01) return `Fully paid${n > 1 ? ` · ${n} payments` : ''}`;
  if (o.collected <= 0) return `Nothing paid${pending}`;
  // same share as the bar: payments plus credit notes against the bill
  const pct = o.billed > 0 ? Math.floor(((o.collected + o.credited) / o.billed) * 100) : 0;
  const credit = o.credited > 0 ? ` · ${fmtAmount2(o.credited)} credited` : '';
  return `${pct}% settled · ${n} payment${n === 1 ? '' : 's'}${credit}${pending}`;
}

@Component({
  selector: 'app-portal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Btn, DataTable, Help, Kpi, PageHeader, ViewAs, Tag, OrderTimeline, Tabs, TabPanel, RequestForm, ReceiptForm, AdviceForm, AcceptForm, ReasonForm, ShipmentsPanel, DeliveryClaimsPanel, InvoicesPanel, TrailPanel, IntlPortal, IncomingPanel, DispatchesPanel,
    OrderPay, OrderLedger,
  ],
  templateUrl: './portal.html',
  styleUrl: './portal.css',
})
export class Portal {
  private api = inject(PortalApi);
  private ops = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  protected isDistributor = computed(() => this.auth.user()?.role === 'Distributor');
  protected isAdmin = computed(() => this.auth.user()?.role === 'Admin');
  protected canManage = computed(() => ['Admin', 'Finance', 'Distribution'].includes(this.auth.user()?.role ?? ''));
  protected canFinance = computed(() => ['Admin', 'Finance'].includes(this.auth.user()?.role ?? ''));

  protected tick = signal(0);
  /** staff: which distributor to look at (kept in this browser, so a reload stays on it) */
  protected selected = signal<string | undefined>(recall('portal-distributor') ?? undefined);
  protected distributors = rxResource({ params: () => (this.isDistributor() ? undefined : true), stream: () => this.ops.distributors() });
  /** the distributor id sent to the API: nothing for a distributor login (the server knows), the chosen one for staff */
  protected distributorOptions = computed<SelectOption<string>[]>(() =>
    (this.distributors.value() ?? []).map((d) => ({
      value: d.id, label: d.name, sub: [d.region, d.status && d.status !== 'Active' ? d.status : ''].filter(Boolean).join(' · '),
    })));
  /** the one picked if it still exists, else the first */
  protected dist = computed(() => {
    if (this.isDistributor()) return undefined;
    const list = this.distributors.value() ?? [];
    const want = this.selected();
    return want && (!list.length || list.some((d) => d.id === want)) ? want : list[0]?.id;
  });

  protected pickDistributor(id: string | null | undefined) {
    this.selected.set(id ?? undefined);
    remember('portal-distributor', id);
  }
  private params = computed(() => (this.isDistributor() || this.dist() ? { tick: this.tick(), d: this.dist() } : undefined));

  protected profile = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.profile(params.d) });
  protected orders = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.orders(params.d) });
  protected requests = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.requests(params.d) });
  protected receipts = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.receipts(params.d) });
  protected advices = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.advices(params.d) });
  protected rates = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.rates(params.d) });
  protected statement = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.statement(params.d) });
  private factory = inject(FactoryApi);
  /** manufacturer deliveries to this distributor and the Zen Foods stock it holds */
  protected deliveries = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.shipments({ distributorId: params.d }) });
  protected consignment = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.stock(params.d) });
  protected trail = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.trail(params.d) });
  /** production orders on their way to this distributor (waiting, in production, ready to collect) */
  protected incoming = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.incoming(params.d) });
  /** what the distributor sent on to its own customers */
  protected dispatches = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.dispatches(params.d) });
  protected salesInvoices = rxResource({ params: () => this.params(), stream: ({ params }) => this.factory.invoices(params.d) });
  /** Admin, Finance and Distribution verify invoices and record payments */
  protected canManageInvoices = computed(() => ['Admin', 'Finance', 'Distribution'].includes(this.auth.user()?.role ?? ''));
  /** the earlier stock-request flow (requests become warehouse sales orders) */
  protected legacy = computed(() => !!this.profile.value()?.salesOrdersEnabled);
  /** Settings: a distributor order goes straight to the manufacturer (no Zingo approval step) */
  protected direct = computed(() => !(this.profile.value()?.requestsNeedApproval ?? this.desk.value()?.needsApproval ?? false));
  protected toConfirm = computed(() => (this.deliveries.value() ?? []).filter((s) => s.status === 'In transit').length
    + (this.incoming.value() ?? []).filter((o) => o.ready).length);
  /** the distributor itself, or Admin / Distribution for it */
  protected canReceiveDelivery = computed(() => this.isDistributor() || ['Admin', 'Distribution'].includes(this.auth.user()?.role ?? ''));
  /** faulty goods claims: Owner, Sales or Warehouse logins of the distributor, or Admin / Distribution for it */
  protected canRaiseClaim = computed(() => {
    const u = this.auth.user() as { role?: string; portalRole?: string } | null;
    if (u?.role === 'Distributor') return ['Owner', 'Sales', 'Warehouse'].includes(u.portalRole ?? 'Owner');
    return ['Admin', 'Distribution'].includes(u?.role ?? '');
  });
  protected desk = rxResource({ params: () => (this.canManage() ? this.tick() : undefined), stream: () => this.api.desk() });
  /** every order with its amount, paid, balance and days since the goods arrived */
  protected orderMoney = rxResource({ params: () => this.params(), stream: ({ params }) => this.api.orderMoney(params.d) });

  // ───────────── order money: upcoming and overdue, Pay, Details ─────────────
  /** received orders with money still open: overdue first, then the oldest arrival */
  /** what the distributor owes on received orders, what is overdue, and what it paid on its orders */
  protected orderBalance = computed(() => (this.orderMoney.value() ?? []).filter((o) => o.receivedContainers > 0).reduce((n, o) => n + o.balance, 0));
  protected orderOverdue = computed(() => (this.orderMoney.value() ?? []).filter((o) => o.overdue).reduce((n, o) => n + o.balance, 0));
  protected orderPaid = computed(() => (this.orderMoney.value() ?? []).reduce((n, o) => n + o.paid, 0));
  /** deliveries from Zen Foods on the way (not received yet) */
  protected inTransit = computed(() => (this.deliveries.value() ?? []).filter((s) => s.status === 'In transit').length);
  protected upcomingMoney = computed(() => (this.orderMoney.value() ?? [])
    .filter((o) => o.receivedContainers > 0 && o.balance > 0.01)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.daysSince ?? 0) - (a.daysSince ?? 0)));
  protected moneyColumns: TableColumn<OrderMoney>[] = [
    { id: 'order', label: 'Order', kind: 'title', value: (o) => o.orderRef, sub: (o) => o.products.join(', ') },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (o) => o.state, tone: (o): Tone => (o.state === 'Received' ? 'success' : 'info'),
      sub: (o) => (o.receivedDate ? `Received ${fmtDate(o.receivedDate)}` : null),
    },
    { id: 'amount', label: 'Amount', kind: 'money', value: (o) => o.amount },
    {
      id: 'paid', label: 'Paid', kind: 'money', value: (o) => o.paid, priority: 2,
      valueTone: (o) => (o.balance <= 0.01 ? 'success' : o.paid > 0 ? 'warning' : null),
      meter: (o) => (o.amount > 0 ? Math.min(1, o.paid / o.amount) : null),
    },
    { id: 'balance', label: 'Balance', kind: 'money', value: (o) => o.balance, valueTone: (o) => (o.overdue ? 'danger' : null) },
    {
      id: 'days', label: 'Days', kind: 'mono', align: 'end', value: (o) => (o.daysSince === null ? '—' : `${o.daysSince}/${o.creditDays}`),
      sortValue: (o) => o.daysSince ?? -1, valueTone: (o) => daysTone(o),
      sub: (o) => (o.dueDate ? (o.overdue ? `Overdue since ${fmtDate(o.dueDate)}` : `Due ${fmtDate(o.dueDate)}`) : null),
      tip: () => 'Days since the goods arrived / days you have to pay (credit terms)',
    },
  ];
  protected moneyActions = (o: OrderMoney): RowAction[] => [
    ...(o.balance > 0.01 ? [{ id: 'pay', label: 'Pay', tone: 'success' as const }] : []),
    { id: 'details', label: 'Details' },
  ];
  protected payingMoney = signal<OrderMoney | null>(null);
  protected payMoneyOpen = signal(false);
  protected ledgerRef = signal<string | null>(null);
  protected ledgerOpen = signal(false);
  protected onMoneyAction(e: RowActionEvent<OrderMoney>) {
    if (e.id === 'pay') {
      this.payingMoney.set(e.row);
      this.payMoneyOpen.set(true);
    } else {
      this.ledgerRef.set(e.row.orderRef);
      this.ledgerOpen.set(true);
    }
  }
  /** Finance / Admin take back a payment that did not arrive */
  protected reverseOrderPayment(id: string) {
    this.askReason('Reverse payment', `${this.ledgerRef() ?? ''}: the money did not arrive`, 'Reverse payment', (note) => this.api.reverseOrderPayment(id, note));
  }

  /** View on an order row: the order panel (products, progress, deliveries) */
  protected requestActions = (r: Grouped<PortalRequest>): RowAction[] => (r.productionOrder?.id ? [{ id: 'view', label: 'View' }] : []);
  protected onRequestRowAction(e: RowActionEvent<Grouped<PortalRequest>>) {
    const o = e.row.productionOrder;
    if (e.id === 'view' && o?.id) {
      this.viewingOrder.set({ id: o.id, refNo: e.row.groupRef ?? o.refNo });
      this.orderViewOpen.set(true);
    }
  }

  protected tab = signal('dashboard');
  protected money = fmtMoney;
  protected amount = fmtAmount2;
  protected pct = fmtPct;
  protected number = fmtNumber;
  protected payableOf = payableOf;

  constructor() {
    // a distributor login cannot read the company settings, so its number format comes with the profile
    effect(() => {
      const p = this.profile.value();
      if (p && this.isDistributor()) setNumberLocale(p.numberFormat);
      setReadyWord(((p?.distributor as { market?: string } | undefined)?.market ?? 'Local') === 'International');
    });
  }

  /** an international distributor's own login: its export account in the portal */
  protected international = computed(() => this.isDistributor() && !!this.profile.value() && (this.profile.value()?.distributor as { market?: string } | undefined)?.market !== 'Local');
  protected tabs = computed<TabItem[]>(() => [
    ...(this.international() ? [{ id: 'intl', label: 'Export account', icon: 'container' as const }] : []),
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'orders', label: 'My orders', icon: 'package', count: this.orders.value()?.length ?? 0 },
    { id: 'stock', label: 'Deliveries & stock', icon: 'boxes', count: this.toConfirm() || null },
    { id: 'cargo', label: 'Cargo & damage', icon: 'truck', count: this.toReceive().length || null },
    { id: 'payments', label: 'Payments & credit', icon: 'banknote' },
    { id: 'rates', label: 'Agreed SKU rates', icon: 'scale' },
    { id: 'statement', label: 'Statement & vouchers', icon: 'file' },
    ...(this.canManage() ? [{ id: 'desk', label: 'Zingo approval desk', icon: 'shield-check' as const, count: this.deskCount() || null }] : []),
  ]);

  // ───────────── derived rows ─────────────
  private all = computed(() => this.orders.value() ?? []);
  protected shipped = computed(() => this.all().filter((o) => o.status === 'Dispatched'));
  protected toReceive = computed(() => this.shipped().filter((o) => !o.receipt));
  protected upcoming = computed(() => this.shipped().filter((o) => o.outstanding > 0.004).sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
  protected payOrders = computed(() => this.all().filter((o) => payableOf(o) > 0));
  protected claims = computed(() => (this.receipts.value() ?? []).filter((r) => r.damagedCartons > 0 || r.missingCartons > 0));
  protected deskCount = computed(() => {
    const d = this.desk.value();
    return d ? d.requests.length + d.advices.length + d.claims.length : 0;
  });

  // ───────────── tables ─────────────
  private statusCol = (id: string, label: string, pick: (o: PortalOrder) => string, sub?: (o: PortalOrder) => string | null): TableColumn<PortalOrder> => ({
    id, label, kind: 'tag', value: pick, tone: (o): Tone => tone(pick(o)), sub,
  });

  protected invoiceColumns: TableColumn<PortalOrder>[] = [
    { id: 'ref', label: 'Invoice', kind: 'title', value: (o) => productLabel(o.product), sub: (o) => o.refNo },
    {
      id: 'due', label: 'Due', kind: 'date', value: (o) => o.dueDate, sortValue: (o) => o.dueDate, priority: 2,
      valueTone: (o) => (o.outstanding > 0.01 ? dueTone(o.dueDate) : null),
      sub: (o) => (o.outstanding > 0.01 ? dueCountdown(o.dispatchDate ?? o.date, o.dueDate) : 'Settled') ?? `${o.paymentTermsDays} day terms`,
    },
    {
      id: 'out', label: 'Balance (PKR)', kind: 'money', value: (o) => o.outstanding,
      sub: (o) => (o.credited > 0 ? `after ${fmtAmount2(o.credited)} credit notes` : null),
    },
    this.statusCol('status', 'Status', (o) => o.portalStatus),
  ];
  protected payAction = (o: PortalOrder): RowAction[] => (payableOf(o) > 0 ? [{ id: 'pay', label: 'Pay', tone: 'success' }] : []);

  protected orderColumns: TableColumn<PortalOrder>[] = [
    { id: 'sku', label: 'Product', kind: 'title', value: (o) => productLabel(o.product), sub: (o) => `${fmtNumber(o.cartons)} bundles` },
    { id: 'ref', label: 'Order no.', kind: 'mono', value: (o) => o.refNo, sortValue: (o) => o.date, sub: (o) => subLine(docDate(o), o.poRef ?? 'No PO ref'), priority: 2 },
    { id: 'rate', label: 'Rate / pack', kind: 'mono', align: 'end', value: (o) => fmtAmount2(o.rate), sortValue: (o) => Number(o.rate), priority: 3 },
    { id: 'total', label: 'Total (PKR)', kind: 'money', value: (o) => o.billed, sub: (o) => o.voucher },
    this.statusCol('status', 'Status', (o) => o.portalStatus, (o) => (o.status === 'Dispatched' ? `Due ${fmtDate(o.dueDate)}` : 'Due at dispatch')),
  ];
  protected orderActions = (o: PortalOrder): RowAction[] => [
    { id: 'voucher', label: 'Voucher' },
    ...(o.status === 'Dispatched' && !o.receipt ? [{ id: 'receive', label: 'Receive', tone: 'success' as const }] : []),
    ...(payableOf(o) > 0 ? [{ id: 'pay', label: o.status === 'Dispatched' ? 'Pay' : 'Advance' }] : []),
  ];

  /** the distributor's orders: one row per order (its products together) */
  protected requestRows = computed(() => groupRequests(this.requests.value() ?? []));
  protected requestColumns: TableColumn<Grouped<PortalRequest>>[] = [
    {
      id: 'product', label: 'Product', kind: 'title', value: (r) => groupTitle(r),
      sub: (r) => groupQty(r),
    },
    {
      id: 'ref', label: 'Order no.', kind: 'mono', value: (r) => r.groupRef ?? r.productionOrder?.refNo ?? r.refNo,
      sub: (r) => docDate(r),
      sortValue: (r) => `${r.date}|${r.createdAt ?? ''}`,
    },
    { id: 'wanted', label: 'Wanted by', kind: 'date', value: (r) => r.requestedDate, priority: 3 },
    { id: 'status', label: 'Status', kind: 'tag', value: (r) => orderState(r).label, tone: (r) => orderState(r).tone, sub: (r) => groupLine(r) },
  ];

  protected cargoColumns: TableColumn<PortalOrder>[] = [
    { id: 'sku', label: 'Product', kind: 'title', value: (o) => productLabel(o.product), sub: (o) => `${fmtNumber(o.cartons)} bundles` },
    { id: 'ref', label: 'Shipment no.', kind: 'mono', value: (o) => o.refNo, sub: (o) => `Dispatched ${fmtDate(o.dispatchDate)}`, priority: 2 },
    { id: 'value', label: 'Value (PKR)', kind: 'money', value: (o) => o.billed, priority: 3 },
    {
      id: 'receipt', label: 'Delivery receipt', kind: 'tag', value: (o) => o.receipt?.status ?? 'Awaiting receipt',
      tone: (o): Tone => (o.receipt ? tone(o.receipt.status) : 'warning'), sub: (o) => o.receipt?.refNo ?? null,
    },
  ];
  protected cargoActions = (o: PortalOrder): RowAction[] => (o.receipt ? [] : [{ id: 'receive', label: 'Confirm cargo', tone: 'success' }]);

  protected claimColumns: TableColumn<PortalReceipt>[] = [
    { id: 'ref', label: 'Claim', value: (r) => r.order.refNo, sub: (r) => subLine(r.refNo, docDate(r)) },
    { id: 'qty', label: 'Damaged / missing', value: (r) => `${r.damagedCartons} / ${r.missingCartons}`, sub: (r) => r.condition, priority: 2 },
    { id: 'value', label: 'Claim value (PKR)', kind: 'money', value: (r) => r.claimValue },
    { id: 'status', label: 'Status', kind: 'tag', value: (r) => r.status, tone: (r): Tone => tone(r.status), sub: (r) => r.reviewNote },
    { id: 'reason', label: 'What happened', value: (r) => r.reason, priority: 3 },
  ];
  protected claimActions = (r: PortalReceipt): RowAction[] => (r.hasEvidence ? [{ id: 'evidence', label: 'Evidence' }] : []);

  protected adviceColumns: TableColumn<PortalAdvice>[] = [
    { id: 'ref', label: 'Advice', value: (a) => a.refNo, sub: (a) => docDate(a) },
    { id: 'order', label: 'Order', value: (a) => a.order.refNo, sub: (a) => (a.isAdvance ? 'Advance' : 'Instalment'), priority: 3 },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (a) => a.amount },
    { id: 'method', label: 'Mode / reference', value: (a) => a.method, sub: (a) => a.bankRef, priority: 2 },
    { id: 'status', label: 'Status', kind: 'tag', value: (a) => a.status, tone: (a): Tone => tone(a.status), sub: (a) => a.reviewNote },
  ];
  protected adviceActions = (a: PortalAdvice): RowAction[] => (a.hasProof ? [{ id: 'proof', label: 'Proof' }] : []);

  protected billColumns: TableColumn<PortalOrder>[] = [
    { id: 'ref', label: 'Order', kind: 'title', value: (o) => productLabel(o.product), sub: (o) => o.refNo },
    this.statusCol('status', 'Status', (o) => o.portalStatus, (o) => (o.status === 'Dispatched' ? `Due ${fmtDate(o.dueDate)}` : 'At dispatch')),
    { id: 'billed', label: 'Billed (PKR)', kind: 'money', value: (o) => o.billed, priority: 2 },
    {
      id: 'paid', label: 'Paid', kind: 'money', value: (o) => o.collected, priority: 2,
      valueTone: (o) => paidTone(o),
      meter: (o) => (o.billed > 0 ? (o.collected + o.credited) / o.billed : null),
      sub: (o) => paidLine(o),
      tip: (o) => (o.payments ?? []).map((p) => `${fmtDate(p.date)} · ${p.refNo} · PKR ${fmtAmount2(p.amount)}${p.advance ? ' (advance)' : ''} · ${p.method}`).join('\n') || 'No payments yet',
    },
    { id: 'credit', label: 'Credit notes', kind: 'money', value: (o) => o.credited, priority: 3 },
    {
      id: 'open', label: 'Open (PKR)', kind: 'money', value: (o) => (o.status === 'Dispatched' ? o.outstanding : Math.max(0, o.billed - o.collected)),
      valueTone: (o) => (o.portalStatus === 'Overdue' ? 'danger' : o.portalStatus === 'Paid' ? 'success' : null),
    },
  ];

  protected rateColumns: TableColumn<PortalRate>[] = [
    { id: 'sku', label: 'SKU', value: (r) => r.sku, sub: (r) => r.name },
    { id: 'mrp', label: 'MRP / pack', kind: 'mono', align: 'end', value: (r) => fmtAmount2(r.mrp), sortValue: (r) => r.mrp, priority: 3 },
    {
      id: 'rate', label: 'Your rate / pack', kind: 'mono', align: 'end', value: (r) => fmtAmount2(r.rate), sortValue: (r) => r.rate,
      sub: (r) => (r.agreed ? `Agreed (standard ${fmtAmount2(r.standardRate)})` : 'Standard price'),
    },
    { id: 'carton', label: 'Per bundle', kind: 'money', value: (r) => r.perCarton, sub: (r) => `${r.packsPerCarton} packs`, priority: 2 },
    { id: 'spread', label: 'Retail spread / pack', kind: 'mono', align: 'end', value: (r) => fmtAmount2(r.spread), sortValue: (r) => r.spread, sub: (r) => fmtPct(r.spreadPct), priority: 2 },
  ];

  protected entryColumns: TableColumn<StatementEntry>[] = [
    { id: 'date', label: 'Date', value: (e) => fmtDate(e.date), sortValue: (e) => e.date, sub: (e) => e.kind },
    { id: 'ref', label: 'Reference', value: (e) => e.ref, sub: (e) => e.description, priority: 2 },
    { id: 'debit', label: 'Debit', kind: 'money', value: (e) => (e.debit ? e.debit : '') },
    { id: 'credit', label: 'Credit', kind: 'money', value: (e) => (e.credit ? e.credit : '') },
    { id: 'balance', label: 'Balance', kind: 'money', value: (e) => e.balance },
  ];

  protected invoiceSummaryColumns: TableColumn<StatementInvoice>[] = [
    { id: 'ref', label: 'Document', value: (i) => i.refNo, sub: (i) => `${i.voucher} · ${i.sku}` },
    { id: 'billed', label: 'Billed', kind: 'money', value: (i) => i.billed, priority: 2 },
    { id: 'paid', label: 'Paid', kind: 'money', value: (i) => i.collected, priority: 3 },
    { id: 'credit', label: 'Credited', kind: 'money', value: (i) => i.credited, priority: 3 },
    { id: 'open', label: 'Open', kind: 'money', value: (i) => i.outstanding },
  ];
  protected voucherAction = (): RowAction[] => [{ id: 'voucher', label: 'Voucher' }];

  // desk
  /** requests waiting on the desk: one row per distributor order */
  protected deskRequestRows = computed(() => groupRequests(this.desk.value()?.requests ?? []));
  protected deskRequestColumns: TableColumn<Grouped<DeskRequest>>[] = [
    { id: 'order', label: 'Order / Distributor', kind: 'title', value: (r) => groupTitle(r), sub: (r) => r.distributor.name },
    {
      id: 'ref', label: 'Order no. / quantity', kind: 'mono', value: (r) => r.groupRef ?? r.refNo,
      sub: (r) => subLine(r.groupRef ? r.group.map((x) => x.refNo).join(', ') : null, docDate(r), groupQty(r)), priority: 2,
    },
    {
      id: 'value', label: 'Value (PKR)', kind: 'money', value: (r) => r.group.reduce((n, x) => n + x.value, 0),
      sub: (r) => (r.group.length > 1 ? null : `${fmtAmount2(r.rate)} / pack`),
    },
    { id: 'wanted', label: 'Wanted by', kind: 'date', value: (r) => r.requestedDate, priority: 3 },
  ];

  /** the desk watches distributor orders with the manufacturers (no action: the manufacturer answers them) */
  /** the production order open in the order panel (from the desk) */
  protected orderViewOpen = signal(false);
  protected viewingOrder = signal<{ id: string; refNo: string } | null>(null);
  protected deskOrderActions = (r: Grouped<DeskOrder>): RowAction[] => (r.productionOrder?.id ? [{ id: 'view', label: 'View order' }] : []);
  protected onDeskOrderAction(e: RowActionEvent<Grouped<DeskOrder>>) {
    const o = e.row.productionOrder;
    if (e.id === 'view' && o?.id) {
      this.viewingOrder.set({ id: o.id, refNo: o.refNo });
      this.orderViewOpen.set(true);
    }
  }

  /** distributor orders with the manufacturers: one row per order and manufacturer */
  protected deskOrderRows = computed(() => groupRequests(this.desk.value()?.recent ?? [], true));
  protected deskOrderColumns: TableColumn<Grouped<DeskOrder>>[] = [
    { id: 'order', label: 'Order / Distributor', kind: 'title', value: (r) => groupTitle(r), sub: (r) => r.distributor.name },
    {
      id: 'ref', label: 'Order no. / quantity', kind: 'mono', value: (r) => r.groupRef ?? r.refNo,
      sub: (r) => subLine(r.groupRef ? r.group.map((x) => x.refNo).join(', ') : null, docDate(r), groupQty(r)), priority: 2,
    },
    {
      id: 'mfr', label: 'Manufacturer', value: (r) => r.productionOrder?.manufacturer?.name ?? '-',
      sub: (r) => r.group.map((x) => x.productionOrder?.refNo).filter(Boolean).join(', ') || null,
    },
    { id: 'status', label: 'Status', kind: 'tag', value: (r) => orderState(r).label, tone: (r) => orderState(r).tone,
      sub: (r) => (r.productionOrder?.readyDate ? `Ready ${fmtDate(r.productionOrder.readyDate)}` : r.productionOrder?.reason ?? r.reviewNote) },
  ];
  protected deskRequestActions = (): RowAction[] => [{ id: 'accept', label: 'Accept', tone: 'success' }, { id: 'reject', label: 'Reject', tone: 'danger' }];

  protected deskAdviceColumns: TableColumn<PortalAdvice>[] = [
    { id: 'ref', label: 'Advice', value: (a) => a.refNo, sub: (a) => docDate(a) },
    { id: 'who', label: 'Distributor', value: (a) => a.distributorName ?? '', sub: (a) => a.order.refNo, priority: 2 },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (a) => a.amount, sub: (a) => (a.isAdvance ? 'Advance' : 'Instalment') },
    { id: 'ref2', label: 'Mode / reference', value: (a) => a.method, sub: (a) => a.bankRef, priority: 3 },
  ];
  protected deskAdviceActions = (a: PortalAdvice): RowAction[] => [
    ...(this.canFinance() ? [{ id: 'confirm', label: 'Confirm', tone: 'success' as const }] : []),
    ...(this.canFinance() ? [{ id: 'reject', label: 'Reject', tone: 'danger' as const }] : []),
    ...(a.hasProof ? [{ id: 'proof', label: 'Proof' }] : []),
  ];

  protected deskClaimColumns: TableColumn<PortalReceipt>[] = [
    { id: 'ref', label: 'Claim', value: (r) => r.order.refNo, sub: (r) => subLine(r.refNo, docDate(r)) },
    { id: 'who', label: 'Distributor', value: (r) => r.distributorName ?? '', sub: (r) => r.reason, priority: 2 },
    { id: 'qty', label: 'Damaged / missing', value: (r) => `${r.damagedCartons} / ${r.missingCartons}`, sub: (r) => r.condition, priority: 3 },
    { id: 'value', label: 'Claim value (PKR)', kind: 'money', value: (r) => r.claimValue },
  ];
  protected deskClaimActions = (r: PortalReceipt): RowAction[] => [
    { id: 'credit', label: 'Credit note', tone: 'success' }, { id: 'reject', label: 'Reject', tone: 'danger' },
    ...(r.hasEvidence ? [{ id: 'evidence', label: 'Evidence' }] : []),
  ];

  protected auditColumns: TableColumn<AuditRow>[] = [
    { id: 'when', label: 'When', value: (a) => fmtDate(a.createdAt.slice(0, 10)), sortValue: (a) => a.createdAt, sub: (a) => a.by },
    { id: 'event', label: 'Event', value: (a) => a.event, sub: (a) => a.reference, priority: 2 },
    { id: 'notes', label: 'Notes', value: (a) => a.notes, priority: 3 },
  ];

  // ───────────── forms ─────────────
  protected requestOpen = signal(false);
  protected receiptOpen = signal(false);
  protected receiving = signal<PortalOrder | null>(null);
  protected adviceOpen = signal(false);
  protected payingOrder = signal<string | undefined>(undefined);
  protected acceptOpen = signal(false);
  protected accepting = signal<DeskRequest | null>(null);
  protected reasonOpen = signal(false);
  protected reasonHeading = signal('Reject');
  protected reasonSubject = signal('');
  protected reasonLabel = signal('Reject');
  protected reasonRun = signal<((note: string) => Observable<unknown>) | undefined>(undefined);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openReceive(o: PortalOrder) {
    this.receiving.set(o);
    this.receiptOpen.set(true);
  }

  protected openPay(orderId?: string) {
    this.payingOrder.set(orderId);
    this.adviceOpen.set(true);
  }

  private askReason(heading: string, subject: string, label: string, run: (note: string) => Observable<unknown>) {
    this.reasonHeading.set(heading);
    this.reasonSubject.set(subject);
    this.reasonLabel.set(label);
    this.reasonRun.set(run);
    this.reasonOpen.set(true);
  }

  // ───────────── actions ─────────────
  protected onOrderAction(e: RowActionEvent<PortalOrder>) {
    if (e.id === 'voucher') return this.downloadVoucher(e.row);
    if (e.id === 'receive') return this.openReceive(e.row);
    if (e.id === 'pay') return this.openPay(e.row.id);
  }

  /** a voucher from the statement list: find the order behind the row */
  protected onStatementVoucher(e: RowActionEvent<StatementInvoice>) {
    const o = this.all().find((x) => x.id === e.row.orderId);
    if (o) this.downloadVoucher(o);
  }

  protected onClaimAction(e: RowActionEvent<PortalReceipt>) {
    if (e.id === 'evidence') this.download(this.api.evidence(e.row.id));
  }

  protected onAdviceAction(e: RowActionEvent<PortalAdvice>) {
    if (e.id === 'proof') this.download(this.api.proof(e.row.id));
  }

  protected async onRequestAction(e: RowActionEvent<Grouped<DeskRequest>>) {
    const r = e.row;
    const many = r.group.length > 1;
    if (e.id === 'accept' && !many) { this.accepting.set(r); this.acceptOpen.set(true); return; }
    if (e.id === 'accept') {
      const ok = await this.confirm.ask({
        title: `Accept order ${r.groupRef}?`,
        message: `${r.group.length} products for ${r.distributor.name}: ${groupQty(r)}. Each goes to its manufacturer with the packing the distributor asked for.`,
        confirmLabel: 'Accept and send to the manufacturers',
      });
      if (!ok) return;
      this.api.acceptRequestGroup(r.group.map((x) => x.id)).subscribe({
        next: () => { this.toast.success(`Order ${r.groupRef} accepted and sent to the manufacturers.`); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }
    this.askReason(many ? `Reject order ${r.groupRef}` : 'Reject request', `${r.groupRef ?? r.refNo} · ${r.distributor.name} · ${r.group.map((x) => x.product.sku).join(', ')}`,
      many ? 'Reject order' : 'Reject request',
      (note) => concat(...r.group.map((x) => this.api.rejectRequest(x.id, note))).pipe(toArray()));
  }

  protected async onDeskAdvice(e: RowActionEvent<PortalAdvice>) {
    const a = e.row;
    if (e.id === 'proof') return this.download(this.api.proof(a.id));
    if (e.id === 'reject') return this.askReason('Reject payment', `${a.refNo} · ${a.distributorName} · PKR ${fmtAmount2(a.amount)}`, 'Reject payment', (note) => this.api.rejectAdvice(a.id, note));
    const ok = await this.confirm.ask({
      title: `Confirm ${a.refNo}?`,
      message: `Check PKR ${fmtAmount2(a.amount)} against the bank or cash record first. Confirming records the payment in the cashbook${a.isAdvance ? ' as an advance held until dispatch' : ' and reduces the invoice'}.`,
      confirmLabel: 'Confirm payment',
    });
    if (!ok) return;
    this.api.confirmAdvice(a.id).subscribe({
      next: () => { this.toast.success(a.isAdvance ? 'Confirmed as a customer advance.' : 'Confirmed. Cash and receivables are updated.'); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected async onDeskClaim(e: RowActionEvent<PortalReceipt>) {
    const r = e.row;
    if (e.id === 'evidence') return this.download(this.api.evidence(r.id));
    if (e.id === 'reject') return this.askReason('Reject claim', `${r.order.refNo} · ${r.distributorName}`, 'Reject claim', (note) => this.api.rejectClaim(r.id, note));
    const ok = await this.confirm.ask({
      title: `Post a credit note for ${r.order.refNo}?`,
      message: `PKR ${fmtAmount2(r.claimValue)} for ${r.damagedCartons} damaged and ${r.missingCartons} missing carton(s). It reduces what the distributor owes; anything beyond the open invoice becomes credit owed back.`,
      confirmLabel: 'Post credit note',
    });
    if (!ok) return;
    this.api.approveClaim(r.id).subscribe({
      next: () => { this.toast.success('Credit note posted.'); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  private download(call: Observable<{ name: string; mime: string; data: string }>) {
    call.subscribe({
      next: (f) => downloadBase64(f.name, f.mime, f.data),
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  // ───────────── downloads ─────────────
  protected downloadStatement() {
    const d = this.profile.value()?.distributor.name ?? 'distributor';
    downloadCsv(`statement-${d.replace(/\W+/g, '-').toLowerCase()}.csv`, [
      { title: `STATEMENT · ${d}`, rows: (this.statement.value()?.entries ?? []).map((e) => ({ date: e.date, kind: e.kind, reference: e.ref, description: e.description, debit: e.debit, credit: e.credit, balance: e.balance })) },
      { title: 'INVOICES AND VOUCHERS', rows: (this.statement.value()?.invoices ?? []).map((i) => ({ document: i.refNo, type: i.voucher, sku: i.sku, billed: i.billed, paid: i.collected, credited: i.credited, open: i.outstanding })) },
    ]);
  }

  /** a printable pro-forma or invoice voucher for one order */
  protected downloadVoucher(o: PortalOrder) {
    const p = this.profile.value();
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const packs = o.product.packsPerCarton;
    const rows: [string, string][] = [
      ['Order', o.refNo], ['Customer', p?.distributor.name ?? ''], ['Date', fmtDate(o.status === 'Dispatched' ? o.dispatchDate : o.date)],
      ['Your PO', o.poRef ?? '-'], ['SKU', `${o.product.sku} · ${o.product.name}`], ['Bundles', `${o.cartons} × ${packs} packs`],
      ['Price per pack', `PKR ${fmtAmount2(o.rate)}`], ['Total', fmtMoney(o.billed)], ['Paid', fmtMoney(o.collected)],
      ['Credit notes', fmtMoney(o.credited)], ['Open', fmtMoney(o.status === 'Dispatched' ? o.outstanding : Math.max(0, o.billed - o.collected))],
      ['Due', o.status === 'Dispatched' ? fmtDate(o.dueDate) : 'At dispatch'],
    ];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.voucher)} ${esc(o.refNo)}</title>
<style>body{font:14px system-ui,sans-serif;max-width:560px;margin:2rem auto;color:#0c1727}h1{font-size:1.25rem}table{width:100%;border-collapse:collapse}td{padding:.4rem 0;border-bottom:1px solid #dde3ec}td:last-child{text-align:right;font-weight:600}.note{color:#556;font-size:.8rem;margin-top:1.5rem}</style></head>
<body><h1>${esc(o.voucher)} · ${esc(o.refNo)}</h1><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p class="note">${o.status === 'Dispatched' ? 'Invoice for goods dispatched.' : 'Pro-forma: the invoice is issued when the goods are dispatched.'} Issued by Zen Foods.</p></body></html>`;
    downloadText(`${o.voucher.toLowerCase()}-${o.refNo}.html`, 'text/html', html);
  }
}
