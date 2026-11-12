import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { fmtMoney } from '../../shared/format';
import { Btn, DataTable, RowAction, RowActionEvent, TableColumn } from '../../ui';
import { DistributorForm } from '../distribution/distributor-form';
import { Distributor, Manufacturer } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { ManufacturerForm } from './manufacturer-form';

/** "Contract ZF-12 · 3 files" */
const contractText = (p: { contract?: string | null; files?: unknown[] }) =>
  [p.contract && `Contract ${p.contract}`, p.files?.length && `${p.files.length} file${p.files.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || null;

/** the bank account a manufacturer is paid at unless it picks another */
const defaultBank = (m: Manufacturer) => m.bankAccounts?.find((b) => b.isDefault) ?? m.bankAccounts?.[0];

/** "Hyderabad, Sindh · +2 areas" */
const areaText = (d: Distributor) =>
  [[d.region, d.province].filter(Boolean).join(', '), d.areas?.length ? `+${d.areas.length} area${d.areas.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');

/** The companies the business deals with: contract manufacturers and distributors. */
@Component({
  selector: 'app-settings-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ManufacturerForm, DistributorForm],
  template: `
    <div class="stack">
      @if (section() === 'manufacturers') {
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Manufacturers</h2><p>Who makes the goods and how long they allow to pay</p></div>
          @if (canManufacturers()) {
            <button appBtn size="sm" icon="plus" (click)="openManufacturer()">Add manufacturer</button>
          }
        </div>
        <div class="card__body">
          <app-data-table [columns]="manufacturerColumns" [rows]="manufacturers.value() ?? []" [actions]="manufacturerActions" [loading]="manufacturers.isLoading()"
            searchPlaceholder="Search manufacturers" emptyTitle="No manufacturers" emptyText="Add the first one." (action)="onManufacturerAction($event)" />
        </div>
      </div>
      }

      @if (section() === 'distributors') {
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Distributors</h2><p>Credit limits and payment terms; their prices are on Pricing & Margins</p></div>
          @if (canDistributors()) {
            <button appBtn size="sm" icon="plus" (click)="openDistributor()">Add distributor</button>
          }
        </div>
        <div class="card__body">
          <app-data-table [columns]="distributorColumns" [rows]="distributors.value() ?? []" [actions]="distributorActions" [loading]="distributors.isLoading()"
            searchPlaceholder="Search distributors" emptyTitle="No distributors" emptyText="Add the first one." (action)="onDistributorAction($event)" />
        </div>
      </div>
      }
    </div>

    <app-manufacturer-form [(open)]="manufacturerOpen" [manufacturer]="editingManufacturer()" (saved)="reload()" />
    <app-distributor-form [(open)]="distributorOpen" [distributor]="editingDistributor()" [paymentCycles]="store.settings()?.paymentCycles ?? [15, 30, 45, 60]" [defaultSelloutDays]="store.settings()?.defaultSelloutDays ?? 30" (saved)="reload()" />
  `,
})
export class SettingsPartners {
  /** the Manufacturers tab or the Distributors tab */
  readonly section = input<'manufacturers' | 'distributors'>('manufacturers');
  private ops = inject(OpsApi);
  protected store = inject(SettingsStore);
  protected auth = inject(AuthService);
  protected canManufacturers = computed(() => this.auth.can('admin'));
  protected canDistributors = computed(() => this.auth.can('distribution'));

  private tick = signal(0);
  protected manufacturers = rxResource({ params: () => this.tick(), stream: () => this.ops.manufacturers() });
  protected distributors = rxResource({ params: () => this.tick(), stream: () => this.ops.distributors() });

  protected manufacturerColumns: TableColumn<Manufacturer>[] = [
    { id: 'name', label: 'Manufacturer', value: (m) => m.name, sub: (m) => m.contact },
    { id: 'poc', label: 'Point of contact', priority: 2, value: (m) => m.poc || null, sub: (m) => contractText(m) },
    {
      id: 'terms', label: 'Payment terms', value: (m) => `${Number(m.advancePct ?? 0)}% advance`,
      sub: (m) => `Balance in ${m.paymentDays} days`,
    },
    {
      id: 'bank', label: 'Default bank', priority: 2, value: (m) => defaultBank(m)?.bank ?? 'No bank account',
      sub: (m) => { const b = defaultBank(m); return b ? `${b.account}${(m.bankAccounts?.length ?? 0) > 1 ? ` · ${m.bankAccounts!.length} accounts` : ''}` : null; },
    },
    { id: 'cur', label: 'Currency', value: (m) => m.currency, priority: 3 },
  ];
  protected manufacturerActions = (): RowAction[] => !this.canManufacturers() ? [] : [{ id: 'edit', label: 'Edit' }];

  protected distributorColumns: TableColumn<Distributor>[] = [
    { id: 'name', label: 'Distributor', value: (d) => d.name, sub: (d) => areaText(d) },
    { id: 'contact', label: 'Contact', value: (d) => d.poc || d.contact, sub: (d) => contractText(d) ?? d.address, priority: 3 },
    { id: 'days', label: 'Payment terms', kind: 'number', align: 'end', priority: 2, value: (d) => d.paymentDays, sub: (d) => `days · sell-out ${d.selloutDays ?? 30} days` },
    { id: 'limit', label: 'Credit limit (PKR)', kind: 'money', value: (d) => d.creditLimit, sub: (d) => (d.advancePct ? `${d.advancePct}% advance` : null) },
  ];
  protected distributorActions = (): RowAction[] => !this.canDistributors() ? [] : [{ id: 'edit', label: 'Edit' }];

  protected money = fmtMoney;

  protected manufacturerOpen = signal(false);
  protected editingManufacturer = signal<Manufacturer | null>(null);
  protected distributorOpen = signal(false);
  protected editingDistributor = signal<Distributor | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openManufacturer(m: Manufacturer | null = null) {
    this.editingManufacturer.set(m);
    this.manufacturerOpen.set(true);
  }

  protected openDistributor(d: Distributor | null = null) {
    this.editingDistributor.set(d);
    this.distributorOpen.set(true);
  }

  protected onManufacturerAction(e: RowActionEvent<Manufacturer>) {
    this.openManufacturer(e.row);
  }

  protected onDistributorAction(e: RowActionEvent<Distributor>) {
    this.openDistributor(e.row);
  }
}
