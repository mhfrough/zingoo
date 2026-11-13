import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { downloadCsv } from '../../shared/csv';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount2, fmtDate, fmtMoney, fmtNumber, fmtPct } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TabItem, TabPanel, Tabs, TableColumn, ToastService,
} from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { OpsApi } from '../ops/ops.api';
import { ExportCollectForm } from './export-collect-form';
import { ExportCostForm } from './export-cost-form';
import { ExportForm } from './export-form';
import { AccountPanel } from './account-panel';
import { ExportsApi } from './exports.api';
import { ContainerType, ExportCostPayment, ExportReceipt, ExportRow } from './models';

/** documents the buyer and the authorities ask for; a reminder, not customs advice */
const CHECKLIST = [
  'Commercial invoice and packing list', 'Export registration, HS code and tax compliance', 'Signed buyer purchase order and named Incoterm',
  'Product labelling, shelf life and specification', 'Country food certifications and sampling', 'Certificate of origin where required',
  'Shipping bill, bill of lading and insurance', 'Weight verification, VGM and container seals', 'Banking documents and currency risk',
];

/**
 * Export Containers: build a quote, see the seller's costs by Incoterm, ship it, collect foreign-currency
 * payments (with realised FX gain or loss) and pay the logistics costs.
 */
@Component({
  selector: 'app-exports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, Kpi, PageHeader, Tabs, TabPanel, ExportForm, ExportCollectForm, ExportCostForm, AccountPanel],
  templateUrl: './exports.html',
  styleUrl: './exports.css',
})
export class Exports {
  private api = inject(ExportsApi);
  private ops = inject(OpsApi);
  private fin = inject(FinanceApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  private tick = signal(0);
  protected shipments = rxResource({ params: () => this.tick(), stream: () => this.api.list() });
  protected receipts = rxResource({ params: () => this.tick(), stream: () => this.api.receipts() });
  protected costPayments = rxResource({ params: () => this.tick(), stream: () => this.api.costPayments() });
  protected containers = rxResource({ stream: () => this.api.containerTypes() });
  protected products = rxResource({ params: () => this.tick(), stream: () => this.ops.products() });
  protected currencies = rxResource({ stream: () => this.fin.currencies() });
  protected settings = rxResource({ params: () => this.tick(), stream: () => this.ops.settings() });
  private distributorsRes = rxResource({ params: () => this.tick(), stream: () => this.ops.distributors() });
  /** international distributors an order can be for */
  protected intlDistributors = computed(() => (this.distributorsRes.value() ?? []).filter((d) => d.market && d.market !== 'Local'));
  /** the distributor whose account panel is open */
  protected accountOpen = signal(false);
  protected accountOf = signal<string | null>(null);

  protected canWrite = computed(() => this.auth.can('exports'));
  protected tab = signal('shipments');
  private store = inject(SettingsStore);
  /** every Incoterm from Settings & Data, with the cost lines the seller carries */
  protected terms = computed(() => this.store.lookups().filter((l) => l.list === "INCOTERM"));
  protected carries = (flags: Record<string, boolean>) =>
    ["origin", "ocean", "insurance", "destination", "duty"].filter((k) => flags[k]).join(", ") || "nothing beyond bank charges";
  protected checklist = CHECKLIST;
  protected money = fmtMoney;
  protected number = fmtNumber;

  // ───────────── numbers ─────────────
  private all = computed(() => this.shipments.value() ?? []);
  private shipped = computed(() => this.all().filter((e) => e.status === 'Shipped'));
  protected booked = computed(() => this.shipped().reduce((n, e) => n + e.revenuePKR, 0));
  protected contribution = computed(() => this.shipped().reduce((n, e) => n + e.net, 0));
  /** what buyers still owe, in PKR at the invoice rates */
  protected receivable = computed(() => this.shipped().reduce((n, e) => n + e.due * Number(e.fxRate), 0));
  protected shippedCount = computed(() => this.shipped().length);
  protected costsOwed = computed(() => this.shipped().reduce((n, e) => n + e.costDue, 0));

  protected tabs = computed<TabItem[]>(() => [
    { id: 'shipments', label: 'Shipments & quotes', icon: 'container', count: this.all().length },
    { id: 'terms', label: 'Trade terms & costing', icon: 'scale' },
    { id: 'collections', label: 'Collections & costs', icon: 'banknote', count: this.receipts.value()?.length ?? 0 },
  ]);

  // ───────────── shipments table ─────────────
  private shipTone = (e: ExportRow): Tone => (e.status === 'Quote' ? 'info' : e.due > 0 ? 'warning' : 'success');

  protected columns: TableColumn<ExportRow>[] = [
    { id: 'ref', label: 'Container', value: (e) => e.refNo, sub: (e) => (e.shipDate ? `Shipped ${fmtDate(e.shipDate)}` : `Quoted ${fmtDate(e.date)}`) },
    {
      id: 'buyer', label: 'Buyer / destination', value: (e) => (e.distributor ? `${e.distributor.name}${e.distributor.code ? ' · ' + e.distributor.code : ''}` : e.buyer),
      sub: (e) => (e.port ? `${e.country} · ${e.port}` : e.country), priority: 2,
    },
    { id: 'term', label: 'Container / term', value: (e) => e.container, sub: (e) => e.incoterm, priority: 3 },
    { id: 'sku', label: 'SKU / bundles', value: (e) => e.product.sku, sub: (e) => `${fmtNumber(e.cartons)} bundles`, priority: 3 },
    {
      id: 'invoice', label: 'Invoice value', kind: 'mono', align: 'end', value: (e) => `${e.currency} ${fmtAmount2(e.revenueForeign)}`,
      sortValue: (e) => e.revenuePKR, sub: (e) => fmtMoney(e.revenuePKR),
    },
    {
      id: 'costs', label: 'Goods / seller costs', kind: 'mono', align: 'end', priority: 3, value: (e) => fmtMoney(e.cogs),
      sortValue: (e) => e.cogs, sub: (e) => `${fmtMoney(e.sellerCostPKR)} seller`,
    },
    { id: 'profit', label: 'Profit / %', kind: 'money', value: (e) => e.net, sub: (e) => fmtPct(e.margin) },
    {
      id: 'status', label: 'Status / due', kind: 'tag', value: (e) => (e.status === 'Quote' ? 'Quote' : e.due > 0 ? 'Receivable' : 'Collected'),
      tone: this.shipTone,
      sub: (e) => [
        e.status === 'Shipped' && e.due > 0 ? `${e.currency} ${fmtAmount2(e.due)} ${e.overdue ? 'overdue since' : 'due'}${e.dueDate ? ' ' + fmtDate(e.dueDate) : ''}` : null,
        e.status === 'Quote' && e.creditOverrideAt ? `credit override: ${e.creditOverrideBy}` : null,
        e.creditNote ? 'credit note on file' : null,
      ].filter(Boolean).join(' · ') || null,
    },
  ];

  protected actions = (e: ExportRow): RowAction[] => {
    const account: RowAction[] = e.distributorId ? [{ id: 'account', label: 'Distributor account' }] : [];
    if (!this.canWrite()) return account;
    if (e.status === 'Quote') {
      return [{ id: 'ship', label: 'Ship', tone: 'success' }, { id: 'edit', label: 'Edit' }, ...account, { id: 'delete', label: 'Delete', tone: 'danger' }];
    }
    const acts: RowAction[] = [...account];
    if (e.due > 0.004) acts.push({ id: 'collect', label: 'Collect', tone: 'success' });
    if (e.costDue > 0.004) acts.push({ id: 'costs', label: 'Pay costs' });
    return acts;
  };

  // ───────────── collections tab ─────────────
  protected receiptColumns: TableColumn<ExportReceipt>[] = [
    { id: 'ref', label: 'Receipt', value: (r) => r.refNo, sub: (r) => fmtDate(r.date) },
    { id: 'container', label: 'Container', value: (r) => r.shipment.refNo, sub: (r) => r.shipment.buyer, priority: 2 },
    {
      id: 'foreign', label: 'Received', kind: 'mono', align: 'end', value: (r) => `${r.shipment.currency} ${fmtAmount2(r.foreignAmount)}`,
      sortValue: (r) => Number(r.foreignAmount), sub: (r) => `at ${fmtAmount2(r.fxRate, 4)}`,
    },
    {
      id: 'pkr', label: 'PKR received', kind: 'money', value: (r) => Number(r.foreignAmount) * Number(r.fxRate),
      sub: (r) => {
        const diff = Number(r.foreignAmount) * (Number(r.fxRate) - Number(r.shipment.fxRate));
        return Math.abs(diff) < 0.5 ? 'No FX difference' : `${diff > 0 ? 'FX gain' : 'FX loss'} ${fmtMoney(Math.abs(diff))}`;
      },
    },
    { id: 'method', label: 'Method', value: (r) => r.method, sub: (r) => r.note, priority: 3 },
  ];

  protected costColumns: TableColumn<ExportCostPayment>[] = [
    { id: 'ref', label: 'Payment', value: (p) => p.refNo, sub: (p) => fmtDate(p.date) },
    { id: 'container', label: 'Container', value: (p) => p.shipment.refNo, sub: (p) => p.shipment.buyer, priority: 2 },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (p) => p.amount },
    { id: 'method', label: 'Method', value: (p) => p.method, sub: (p) => p.note, priority: 3 },
  ];

  protected containerColumns: TableColumn<ContainerType>[] = [
    { id: 'code', label: 'Container', value: (c) => c.code },
    { id: 'max', label: 'Planning bundles', kind: 'number', align: 'end', value: (c) => c.maxCartons },
  ];

  // ───────────── forms and actions ─────────────
  protected quoteOpen = signal(false);
  protected editing = signal<ExportRow | null>(null);
  protected collectOpen = signal(false);
  protected costOpen = signal(false);
  protected target = signal<ExportRow | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openQuote(e: ExportRow | null = null) {
    this.editing.set(e);
    this.quoteOpen.set(true);
  }

  protected async onAction(ev: RowActionEvent<ExportRow>) {
    const e = ev.row;
    if (ev.id === 'edit') return this.openQuote(e);
    if (ev.id === 'account') { this.accountOf.set(e.distributorId ?? null); this.accountOpen.set(true); return; }
    if (ev.id === 'collect') { this.target.set(e); this.collectOpen.set(true); return; }
    if (ev.id === 'costs') { this.target.set(e); this.costOpen.set(true); return; }

    if (ev.id === 'ship') {
      const ok = await this.confirm.ask({
        title: `Ship ${e.refNo} to ${e.buyer}?`,
        message: `${fmtNumber(e.cartons)} bundles of ${e.product.sku} leave the warehouse. The invoice (${e.currency} ${fmtAmount2(e.revenueForeign)}), the goods cost and the seller's costs are posted, and the container is locked.`,
        confirmLabel: 'Ship container',
      });
      if (!ok) return;
      this.api.ship(e.id).subscribe({
        next: () => { this.toast.success(`${e.refNo} shipped. Invoice, goods cost and logistics are posted.`); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }

    if (ev.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete quote ${e.refNo}?`,
        message: `The quote for ${e.buyer} will be removed. This cannot be undone.`,
        confirmLabel: 'Delete quote',
        tone: 'danger',
      });
      if (!ok) return;
      this.api.remove(e.id).subscribe({
        next: () => { this.toast.success('Quote deleted.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  protected exportCsv() {
    downloadCsv('zingoo-export-containers.csv', [
      {
        title: 'EXPORT CONTAINERS',
        rows: this.all().map((e) => ({
          reference: e.refNo, status: e.status, date: e.date, ship_date: e.shipDate, buyer: e.buyer, country: e.country,
          container: e.container, incoterm: e.incoterm, sku: e.product.sku, cartons: e.cartons, currency: e.currency,
          fx_rate: e.fxRate, invoice_value: e.revenueForeign, invoice_pkr: e.revenuePKR, goods_cost_pkr: e.cogs,
          seller_costs_pkr: e.sellerCostPKR, profit_pkr: e.net, margin_pct: e.margin, collected: e.collected, due: e.due,
        })),
      },
      {
        title: 'EXPORT COLLECTIONS',
        rows: (this.receipts.value() ?? []).map((r) => ({
          reference: r.refNo, date: r.date, container: r.shipment.refNo, currency: r.shipment.currency,
          amount: r.foreignAmount, fx_rate: r.fxRate, pkr_received: Number(r.foreignAmount) * Number(r.fxRate),
        })),
      },
    ]);
  }
}
