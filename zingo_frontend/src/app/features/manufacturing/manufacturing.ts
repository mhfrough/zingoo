import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TableColumn, ToastService,
} from '../../ui';
import { Batch, Product, StockRow } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { BatchForm } from './batch-form';
import { PayManufacturerForm } from './pay-manufacturer-form';
import { ProductForm } from './product-form';

const QC_TONE: Record<string, Tone> = { Passed: 'success', Pending: 'warning', Failed: 'danger' };
const STATUS_TONE: Record<string, Tone> = { Released: 'success', Planned: 'warning' };

@Component({
  selector: 'app-manufacturing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, Kpi, PageHeader, BatchForm, ProductForm, PayManufacturerForm],
  templateUrl: './manufacturing.html',
})
export class Manufacturing {
  private api = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  private router = inject(Router);
  protected auth = inject(AuthService);

  /** ?new=batch or ?new=product opens that form straight away (used by the Overview quick-add buttons) */
  readonly new = input<string>();

  private tick = signal(0);
  protected stock = rxResource({ params: () => this.tick(), stream: () => this.api.stock() });
  protected batches = rxResource({ params: () => this.tick(), stream: () => this.api.batches() });
  protected products = rxResource({ params: () => this.tick(), stream: () => this.api.products() });
  protected manufacturers = rxResource({ params: () => this.tick(), stream: () => this.api.manufacturers() });
  protected distributors = rxResource({ params: () => this.tick(), stream: () => this.api.distributors() });

  protected canWrite = computed(() => this.auth.can('manufacturing'));
  protected loading = computed(() => this.stock.isLoading() || this.batches.isLoading());
  protected loadError = computed(() => (this.stock.error() || this.batches.error() ? 'The server did not answer.' : null));

  // form state
  protected batchOpen = signal(false);
  protected editingBatch = signal<Batch | null>(null);
  protected productOpen = signal(false);
  protected editingProduct = signal<Product | null>(null);
  protected payOpen = signal(false);
  protected payingBatch = signal<Batch | null>(null);

  // ───────────── numbers ─────────────
  protected producedCartons = computed(() =>
    (this.batches.value() ?? []).filter((b) => b.status === 'Released').reduce((n, b) => n + b.producedCartons, 0));
  protected plannedCount = computed(() => (this.batches.value() ?? []).filter((b) => b.status === 'Planned').length);
  protected stockCartons = computed(() => (this.stock.value() ?? []).reduce((n, s) => n + s.cartons, 0));
  protected stockPacks = computed(() => (this.stock.value() ?? []).reduce((n, s) => n + s.packs, 0));
  protected released = computed(() => (this.batches.value() ?? []).filter((b) => b.status === 'Released'));

  protected fmtNumber = fmtNumber;
  protected fmtMoney = fmtMoney;

  constructor() {
    effect(() => {
      const what = this.new();
      if (!what || !this.canWrite()) return;
      untracked(() => {
        if (what === 'batch') this.openBatch();
        if (what === 'product') this.openProduct();
        this.router.navigate([], { queryParams: { new: null }, replaceUrl: true });
      });
    });
  }

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  // ───────────── tables ─────────────
  /** the catalogue: each SKU with its packaging chain and the partners it is assigned to */
  protected productColumns: TableColumn<Product>[] = [
    { id: 'sku', label: 'Product', value: (p) => p.sku, sub: (p) => [p.name, p.flavour !== p.name ? p.flavour : null, p.packetSize].filter(Boolean).join(' · ') },
    {
      id: 'packaging', label: 'Packets per container', kind: 'number', value: (p) => p.packetsPerContainer ?? p.packsPerCarton * (p.bundlesPerContainer || 1),
      sub: (p) => `${fmtNumber(p.packsPerCarton)} per bundle × ${fmtNumber(p.bundlesPerContainer)} bundles`, priority: 2,
    },
    { id: 'manufacturer', label: 'Manufacturer', value: (p) => p.manufacturer?.name ?? 'Not assigned', priority: 2 },
    {
      id: 'distributor', label: 'Distributor', value: (p) => p.distributor?.name ?? 'Not assigned',
      sub: (p) => (p.effectiveSelloutDays ? `Sell out in ${p.effectiveSelloutDays} days` : null),
    },
    { id: 'rate', label: 'Distributor price', kind: 'money', value: (p) => p.rate, sub: (p) => `MRP ${fmtAmount(p.mrp)}`, priority: 3 },
    { id: 'status', label: 'Status', kind: 'tag', value: (p) => (p.active ? 'Active' : 'Inactive'), tone: (p) => (p.active ? 'success' : 'neutral'), priority: 3 },
  ];
  protected productActions = (): RowAction[] => (this.canWrite() ? [{ id: 'edit', label: 'Edit product' }] : []);
  /** SKUs still missing a manufacturer or a distributor */
  protected unassigned = computed(() => (this.products.value() ?? []).filter((p) => p.active && (!p.manufacturerId || !p.distributorId)).length);

  protected onProductAction(e: RowActionEvent<Product>) {
    if (e.id === 'edit') this.openProduct(e.row);
  }

  protected stockColumns: TableColumn<StockRow>[] = [
    { id: 'sku', label: 'SKU', value: (s) => s.sku, sub: (s) => `${s.name} · Rs ${s.pack}` },
    { id: 'cartons', label: 'Available bundles', kind: 'number', value: (s) => s.cartons, sub: (s) => `${fmtNumber(s.packs)} packs` },
    {
      id: 'status', label: 'Stock status', kind: 'tag', value: (s) => (!s.active ? 'Inactive' : s.low ? 'Replenish' : 'Available'),
      tone: (s) => (!s.active ? 'neutral' : s.low ? 'warning' : 'success'),
    },
  ];
  protected stockActions = (): RowAction[] => (this.canWrite() ? [{ id: 'edit', label: 'Edit SKU' }] : []);

  protected batchColumns: TableColumn<Batch>[] = [
    { id: 'batch', label: 'Batch', value: (b) => b.refNo, sub: (b) => fmtDate(b.date) },
    { id: 'product', label: 'Product', value: (b) => `${b.product.name} · Rs ${b.product.pack}`, sub: (b) => b.product.sku },
    { id: 'cartons', label: 'Cartons made', kind: 'number', value: (b) => b.producedCartons, sub: (b) => `Target ${b.targetCartons}` },
    { id: 'qc', label: 'QC', kind: 'tag', value: (b) => b.qc, tone: (b) => QC_TONE[b.qc] ?? 'neutral', priority: 3 },
    { id: 'status', label: 'Status', kind: 'tag', value: (b) => b.status, tone: (b) => STATUS_TONE[b.status] ?? 'neutral', priority: 2 },
    { id: 'cost', label: 'Est. cost (PKR)', kind: 'money', value: (b) => b.cost, sub: (b) => b.manufacturer.name, priority: 2 },
  ];
  protected batchActions = (b: Batch): RowAction[] => {
    if (!this.canWrite()) return [];
    if (b.status === 'Planned') {
      return [{ id: 'release', label: 'Release batch', tone: 'success' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' }];
    }
    return b.due > 0 ? [{ id: 'pay', label: 'Pay manufacturer', tone: 'success' }] : [];
  };

  protected payableColumns: TableColumn<Batch>[] = [
    { id: 'batch', label: 'Batch', value: (b) => b.refNo, sub: (b) => fmtDate(b.date) },
    { id: 'manufacturer', label: 'Manufacturer', value: (b) => b.manufacturer.name, sub: (b) => `Terms ${b.manufacturer.paymentDays} days` },
    { id: 'cost', label: 'Accrued (PKR)', kind: 'money', value: (b) => b.cost, sub: (b) => `Paid ${fmtAmount(b.paid)}`, priority: 2 },
    { id: 'due', label: 'Remaining (PKR)', kind: 'money', value: (b) => b.due },
  ];
  protected payableTotals = computed(() => ({
    batch: 'Total',
    cost: fmtAmount(this.released().reduce((n, b) => n + b.cost, 0)),
    due: fmtAmount(this.released().reduce((n, b) => n + b.due, 0)),
  }));
  protected payableActions = (b: Batch): RowAction[] =>
    this.canWrite() && b.due > 0 ? [{ id: 'pay', label: 'Pay', tone: 'success' }] : [];

  // ───────────── actions ─────────────
  protected openBatch(b: Batch | null = null) {
    this.editingBatch.set(b);
    this.batchOpen.set(true);
  }

  protected openProduct(p: Product | null = null) {
    this.editingProduct.set(p);
    this.productOpen.set(true);
  }

  protected openPay(b: Batch) {
    this.payingBatch.set(b);
    this.payOpen.set(true);
  }

  protected onStockAction(e: RowActionEvent<StockRow>) {
    const product = (this.products.value() ?? []).find((p) => p.id === e.row.productId);
    if (e.id === 'edit' && product) this.openProduct(product);
  }

  protected async onBatchAction(e: RowActionEvent<Batch>) {
    const b = e.row;
    if (e.id === 'edit') return this.openBatch(b);
    if (e.id === 'pay') return this.openPay(b);

    if (e.id === 'release') {
      const ok = await this.confirm.ask({
        title: `Release batch ${b.refNo}?`,
        message: `${fmtNumber(b.producedCartons)} bundles of ${b.product.sku} go into warehouse stock, and ${b.manufacturer.name} is owed ${fmtMoney(b.cost)}. A released batch can no longer be edited.`,
        confirmLabel: 'Release batch',
      });
      if (!ok) return;
      this.api.releaseBatch(b.id).subscribe({
        next: () => { this.toast.success('Production released. Warehouse stock increased.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }

    if (e.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete batch ${b.refNo}?`,
        message: 'This planned batch will be removed. This cannot be undone.',
        confirmLabel: 'Delete batch',
        tone: 'danger',
      });
      if (!ok) return;
      this.api.deleteBatch(b.id).subscribe({
        next: () => { this.toast.success('Planned batch deleted.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }
}
