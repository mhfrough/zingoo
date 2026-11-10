import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount2, fmtMoney, fmtNumber, fmtPct } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TableColumn, ToastService,
} from '../../ui';
import { ProductForm } from '../manufacturing/product-form';
import { Order, Product } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { AgreedRateForm } from './agreed-rate-form';
import { UnitEconomics, unitEconomics } from './economics';
import { OverheadForm } from './overhead-form';
import { AgreedRate, PricingApi } from './pricing.api';
import { PriceForm } from './price-form';

/** one SKU with its price bridge */
interface PriceRow {
  product: Product;
  eco: UnitEconomics;
}

/** a margin tone: healthy, thin or negative */
const marginTone = (pct: number): Tone => (pct >= 25 ? 'success' : pct >= 10 ? 'warning' : 'danger');

/**
 * Pricing & Margins: from the factory rate to the distributor price, per pack, with the margin at each step,
 * the rate cards, what dispatched orders earned and the prices agreed with each distributor.
 * It is a planning view: dispatched orders freeze their own cost and company profit is on the income statement.
 */
@Component({
  selector: 'app-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, Kpi, PageHeader, ProductForm, PriceForm, OverheadForm, AgreedRateForm],
  templateUrl: './pricing.html',
  styleUrl: './pricing.css',
})
export class Pricing {
  private ops = inject(OpsApi);
  private pricing = inject(PricingApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  private tick = signal(0);
  protected products = rxResource({ params: () => this.tick(), stream: () => this.ops.products() });
  protected settings = rxResource({ params: () => this.tick(), stream: () => this.ops.settings() });
  protected orders = rxResource({ params: () => this.tick(), stream: () => this.ops.orders() });
  protected distributors = rxResource({ params: () => this.tick(), stream: () => this.ops.distributors() });
  protected rates = rxResource({ params: () => this.tick(), stream: () => this.pricing.agreedRates() });

  protected canRates = computed(() => this.auth.can('manufacturing'));
  protected canOverhead = computed(() => this.auth.can('admin'));
  protected canAgree = computed(() => this.auth.can('distribution'));

  protected money = fmtMoney;
  protected amount = fmtAmount2;
  protected pct = fmtPct;
  protected number = fmtNumber;

  protected overhead = computed(() => Number(this.settings.value()?.profitAllocationPerPack ?? 0));
  protected rows = computed<PriceRow[]>(() =>
    (this.products.value() ?? []).map((product) => ({ product, eco: unitEconomics(product, this.overhead()) })));

  // ───────────── numbers ─────────────
  protected activeCount = computed(() => (this.products.value() ?? []).filter((p) => p.active).length);
  protected avgNet = computed(() => {
    const r = this.rows();
    return r.length ? r.reduce((n, x) => n + x.eco.net, 0) / r.length : 0;
  });
  protected dispatched = computed(() => (this.orders.value() ?? []).filter((o) => o.status === 'Dispatched'));
  protected turnover = computed(() => this.dispatched().reduce((n, o) => n + o.billed, 0));

  // ───────────── tables ─────────────
  /** a PKR-per-pack column: shown with two decimals, sorted by the number */
  private perPack = (id: string, label: string, pick: (r: PriceRow) => number, sub?: (r: PriceRow) => string | null, priority?: 1 | 2 | 3): TableColumn<PriceRow> => ({
    id, label, kind: 'mono', align: 'end', priority, value: (r) => fmtAmount2(pick(r)), sortValue: pick, sub,
  });

  protected bridgeColumns: TableColumn<PriceRow>[] = [
    { id: 'sku', label: 'SKU', value: (r) => r.product.sku, sub: (r) => r.product.name },
    this.perPack('factory', 'From factory', (r) => r.eco.factory, (r) => (r.eco.addOns ? `+ ${fmtAmount2(r.eco.addOns)} add-ons` : 'No add-ons')),
    this.perPack('landed', 'Landed cost', (r) => r.eco.variable, (r) => `${fmtAmount2(r.eco.total)} with overhead`, 2),
    this.perPack('price', 'To distributor', (r) => r.eco.distributor, (r) => `MRP ${fmtAmount2(r.product.mrp)}`),
    {
      id: 'gross', label: 'Gross margin', kind: 'mono', align: 'end', value: (r) => fmtAmount2(r.eco.gross),
      sortValue: (r) => r.eco.gross, sub: (r) => fmtPct(r.eco.grossPct),
    },
    {
      id: 'net', label: 'After overhead', kind: 'mono', align: 'end', priority: 2, value: (r) => fmtAmount2(r.eco.net),
      sortValue: (r) => r.eco.net, sub: (r) => fmtPct(r.eco.netPct),
    },
    this.perPack('spread', 'Retail spread', (r) => r.eco.retailSpread, undefined, 3),
    { id: 'stock', label: 'Stock (cartons)', kind: 'number', align: 'end', priority: 3, value: (r) => r.product.stockCartons ?? 0 },
  ];

  protected bridgeActions = (r: PriceRow): RowAction[] =>
    this.canRates() ? [{ id: 'rates', label: 'Edit rates' }] : [];

  protected onBridgeAction(e: RowActionEvent<PriceRow>) {
    if (e.id === 'rates') this.openRates(e.row.product);
  }

  /** margins earned by dispatched orders, at today's cost assumptions */
  protected marginColumns: TableColumn<Order>[] = [
    { id: 'ref', label: 'Order', value: (o) => o.refNo, sub: (o) => o.distributor.name },
    { id: 'sku', label: 'SKU', value: (o) => o.product.sku, priority: 2 },
    { id: 'packs', label: 'Packs', kind: 'number', align: 'end', priority: 3, value: (o) => o.cartons * o.product.packsPerCarton },
    { id: 'sell', label: 'Selling / pack', kind: 'mono', align: 'end', value: (o) => fmtAmount2(o.rate), sortValue: (o) => Number(o.rate) },
    {
      id: 'cost', label: 'Cost / pack', kind: 'mono', align: 'end', priority: 2,
      value: (o) => fmtAmount2(unitEconomics(o.product, this.overhead()).variable),
      sortValue: (o) => unitEconomics(o.product, this.overhead()).variable,
    },
    {
      id: 'contribution', label: 'Contribution (PKR)', kind: 'money',
      value: (o) => o.cartons * o.product.packsPerCarton * (Number(o.rate) - unitEconomics(o.product, this.overhead()).variable),
    },
  ];

  protected agreedColumns: TableColumn<AgreedRate>[] = [
    { id: 'distributor', label: 'Distributor', value: (a) => a.distributor.name, sub: (a) => a.distributor.region },
    { id: 'sku', label: 'SKU', value: (a) => a.product.sku, sub: (a) => a.product.name, priority: 2 },
    {
      id: 'rate', label: 'Agreed / pack', kind: 'mono', align: 'end', value: (a) => fmtAmount2(a.rate), sortValue: (a) => Number(a.rate),
      sub: (a) => {
        const diff = Number(a.rate) - Number(a.product.rate);
        return diff === 0 ? 'Same as standard' : `${diff > 0 ? '+' : '−'}${fmtAmount2(Math.abs(diff))} vs standard ${fmtAmount2(a.product.rate)}`;
      },
    },
  ];

  protected agreedActions = (): RowAction[] =>
    this.canAgree() ? [{ id: 'edit', label: 'Change' }, { id: 'delete', label: 'Remove', tone: 'danger' }] : [];

  protected async onAgreedAction(e: RowActionEvent<AgreedRate>) {
    if (e.id === 'edit') return this.openAgreed(e.row);
    if (e.id !== 'delete') return;
    const a = e.row;
    const ok = await this.confirm.ask({
      title: 'Remove this agreed rate?',
      message: `${a.distributor.name} will go back to the standard price for ${a.product.sku}. Orders already booked are not changed.`,
      confirmLabel: 'Remove rate',
      tone: 'danger',
    });
    if (!ok) return;
    this.pricing.deleteRate(a.id).subscribe({
      next: () => { this.toast.success('Agreed rate removed.'); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  /** rate cards: the distributor price with how much of it is margin */
  protected cards = computed(() => this.rows().map((r) => ({
    ...r,
    tone: marginTone(r.eco.grossPct),
    /** the bar fill, kept between 0 and 100 */
    fill: Math.max(0, Math.min(100, Math.round(r.eco.grossPct))),
  })));

  // ───────────── forms ─────────────
  protected productOpen = signal(false);
  protected ratesOpen = signal(false);
  protected editing = signal<Product | null>(null);
  protected overheadOpen = signal(false);
  protected agreedOpen = signal(false);
  protected editingRate = signal<AgreedRate | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openRates(p: Product) {
    this.editing.set(p);
    this.ratesOpen.set(true);
  }

  protected openAgreed(r: AgreedRate | null = null) {
    this.editingRate.set(r);
    this.agreedOpen.set(true);
  }
}
