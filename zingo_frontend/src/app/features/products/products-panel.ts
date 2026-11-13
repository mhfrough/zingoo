import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { fmtAmount, fmtAmount2, fmtNumber } from '../../shared/format';
import { Btn, DataTable, RowAction, RowActionEvent, TableColumn } from '../../ui';
import { ProductForm } from '../manufacturing/product-form';
import { Product } from '../ops/models';
import { OpsApi } from '../ops/ops.api';

/** packets in one container of a product */
const perContainer = (p: Product) => p.packetsPerContainer ?? p.packsPerCarton * (p.bundlesPerContainer || 1);

/**
 * The product list with its own data and the add / edit form: each SKU with its packaging (packet -> bundle ->
 * container), the price of a whole container, and the manufacturer and distributor it is assigned to.
 * Used on the Products page and the Manufacturing page's Products tab.
 */
@Component({
  selector: 'app-products-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ProductForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>Products</h2>
          <p>Packet → bundle → container, the price of each, and the manufacturer and distributor each SKU is assigned to
            @if (unassigned()) { · <strong>{{ unassigned() }} not fully assigned</strong> }
          </p>
        </div>
        @if (canWrite()) {
          <button appBtn variant="primary" icon="plus" (click)="open(null)">Add product / SKU</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns" [rows]="products.value() ?? []" [actions]="actions"
          [loading]="products.isLoading()" [error]="products.error() ? 'The server did not answer.' : null"
          searchPlaceholder="Search products" emptyTitle="No products yet" emptyText="Add the first SKU to start."
          (retry)="reload()" (action)="onAction($event)" />
      </div>
    </div>

    <app-product-form [(open)]="formOpen" [product]="editing()" [manufacturers]="manufacturers.value() ?? []"
      [distributors]="distributors.value() ?? []" (saved)="saved()" />
  `,
})
export class ProductsPanel {
  private api = inject(OpsApi);
  private auth = inject(AuthService);

  /** bump to read the lists again (the page reloads after other changes) */
  readonly version = input(0);
  /** a product was added or changed */
  readonly changed = output<void>();

  private tick = signal(0);
  protected products = rxResource({ params: () => ({ t: this.tick(), v: this.version() }), stream: () => this.api.products() });
  protected manufacturers = rxResource({ params: () => this.tick(), stream: () => this.api.manufacturers() });
  protected distributors = rxResource({ params: () => this.tick(), stream: () => this.api.distributors() });

  protected canWrite = computed(() => this.auth.can('manufacturing'));
  protected formOpen = signal(false);
  protected editing = signal<Product | null>(null);
  /** SKUs still missing a manufacturer or a distributor */
  protected unassigned = computed(() => (this.products.value() ?? []).filter((p) => p.active && (!p.manufacturerId || !p.distributorId)).length);

  protected columns: TableColumn<Product>[] = [
    { id: 'sku', label: 'SKU', value: (p) => p.sku, sub: (p) => (p.gramsPerPacket ? `${p.gramsPerPacket} g` : null) },
    { id: 'name', label: 'Product name', value: (p) => p.name, sub: (p) => [p.flavour !== p.name ? p.flavour : null, p.packetSize].filter(Boolean).join(' · ') || null },
    {
      id: 'packaging', label: 'Packets per container', kind: 'number', value: (p) => perContainer(p),
      sub: (p) => `${fmtNumber(p.packsPerCarton)} per bundle × ${fmtNumber(p.bundlesPerContainer)} bundles${(p.packagings?.length ?? 0) > 1 ? ` · ${p.packagings!.length} templates` : ''}`, priority: 2,
    },
    { id: 'manufacturer', label: 'Manufacturer', value: (p) => p.manufacturer?.name ?? 'Not assigned', priority: 2 },
    {
      id: 'distributor', label: 'Distributors', value: (p) => p.distributor?.name ?? 'Not assigned',
      sub: (p) => [
        (p.distributorIds?.length ?? 0) > 1 ? `+${p.distributorIds!.length - 1} more` : null,
        p.effectiveSelloutDays ? `Sell out in ${p.effectiveSelloutDays} days` : null,
      ].filter(Boolean).join(' · ') || null,
    },
    {
      id: 'container', label: 'Container price', kind: 'money', priority: 2, value: (p) => p.rate * perContainer(p),
      sub: (p) => `Cost ${fmtAmount(p.manufacturerRate * perContainer(p))}`,
    },
    { id: 'rate', label: 'Packet price', align: 'end', value: (p) => fmtAmount2(p.rate), sub: (p) => `MRP ${fmtAmount2(p.mrp)}`, priority: 3 },
    { id: 'status', label: 'Status', kind: 'tag', value: (p) => (p.active ? 'Active' : 'Inactive'), tone: (p) => (p.active ? 'success' : 'neutral'), priority: 3 },
  ];
  protected actions = (): RowAction[] => (this.canWrite() ? [{ id: 'edit', label: 'Edit product' }] : []);

  /** open the form: a new SKU, or the one to change */
  open(p: Product | null) {
    this.editing.set(p);
    this.formOpen.set(true);
  }

  protected onAction(e: RowActionEvent<Product>) {
    if (e.id === 'edit') this.open(e.row);
  }

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected saved() {
    this.reload();
    this.changed.emit();
  }
}
