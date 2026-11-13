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
import { RegistrationPanel } from '../distribution/registration-panel';
import { CommercialPanel } from '../distribution/commercial-panel';
import { AccountPanel } from '../exports/account-panel';

/** "Contract ZF-12 · 3 files" */
const contractText = (p: { contract?: string | null; files?: unknown[] }) =>
  [p.contract && `Contract ${p.contract}`, p.files?.length && `${p.files.length} file${p.files.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || null;

/** the bank account a manufacturer is paid at unless it picks another */
const defaultBank = (m: Manufacturer) => m.bankAccounts?.find((b) => b.isDefault) ?? m.bankAccounts?.[0];

/** "Sindh · 2 districts · 5 cities · exclusive" */
const areaText = (d: Distributor) => {
  const n = (count: number | undefined, one: string, many: string) => (count ? `${count} ${count > 1 ? many : one}` : null);
  return [
    (d.provinces ?? []).join(', ') || null,
    n(d.districts?.length, 'district', 'districts'), n(d.cities?.length, 'city', 'cities'),
    (d.countries ?? []).length ? (d.countries!.length > 2 ? `${d.countries!.length} countries` : d.countries!.join(', ')) : null,
    d.exclusive ? 'exclusive' : null,
  ].filter(Boolean).join(' · ') || d.region;
};

/** the tone of a distributor's status */
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  Active: 'success', Hold: 'warning', 'Temporary suspend': 'danger', 'Permanent suspend': 'neutral',
};

/** The companies the business deals with: contract manufacturers and distributors. */
@Component({
  selector: 'app-settings-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ManufacturerForm, DistributorForm, RegistrationPanel, CommercialPanel, AccountPanel],
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
    <app-distributor-form [(open)]="distributorOpen" [distributor]="editingDistributor()" [paymentCycles]="store.settings()?.paymentCycles ?? [15, 30, 45, 60]" [defaultSelloutDays]="store.settings()?.defaultSelloutDays ?? 30" [others]="distributors.value() ?? []" [products]="products.value() ?? []" (saved)="reload()" />
    <app-registration-panel [(open)]="registrationOpen" [distributorId]="registering()" (changed)="reload()" />
    <app-commercial-panel [(open)]="commercialOpen" [distributor]="commercial()" [products]="products.value() ?? []" (changed)="reload()" />
    <app-account-panel [(open)]="accountOpen" [distributorId]="accountOf()" (changed)="reload()" />
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
  protected products = rxResource({ stream: () => this.ops.products() });
  /** an international distributor's registration panel */
  protected registrationOpen = signal(false);
  protected registering = signal<string | null>(null);
  /** an international distributor's credit, bank accounts and price list */
  protected commercialOpen = signal(false);
  protected commercial = signal<Distributor | null>(null);
  /** an international distributor's account: orders, money received, aging, statement */
  protected accountOpen = signal(false);
  protected accountOf = signal<string | null>(null);

  protected manufacturerColumns: TableColumn<Manufacturer>[] = [
    { id: 'name', label: 'Manufacturer', value: (m) => m.name, sub: (m) => m.contact },
    { id: 'poc', label: 'Point of contact', priority: 2, value: (m) => m.poc || null, sub: (m) => contractText(m) },
    {
      id: 'terms', label: 'Payment terms',
      value: (m) => (m.paymentTerms ?? ['Advance']).map((t) => (t === 'Advance' ? `${Number(m.advancePct ?? 0)}% advance` : 'Credit line')).join(' + '),
      sub: (m) => ((m.paymentTerms ?? []).includes('Credit line')
        ? `Limit ${Number(m.creditLimit) ? fmtMoney(m.creditLimit!) : 'none'} · clear in ${m.paymentDays ? m.paymentDays + ' days' : 'no limit'}`
        : 'Pay on delivery'),
    },
    {
      id: 'bank', label: 'Default bank', priority: 2, value: (m) => defaultBank(m)?.bank ?? 'No bank account',
      sub: (m) => { const b = defaultBank(m); return b ? `${b.account}${(m.bankAccounts?.length ?? 0) > 1 ? ` · ${m.bankAccounts!.length} accounts` : ''}` : null; },
    },
    { id: 'cur', label: 'Currency', value: (m) => m.currency, priority: 3 },
  ];
  protected manufacturerActions = (): RowAction[] => !this.canManufacturers() ? [] : [{ id: 'edit', label: 'Edit' }];

  protected distributorColumns: TableColumn<Distributor>[] = [
    { id: 'name', label: 'Distributor', value: (d) => (d.code ? `${d.name} · ${d.code}` : d.name), sub: (d) => `${d.market ?? 'Local'} · ${areaText(d)}` },
    { id: 'contact', label: 'Contact', value: (d) => d.poc || d.contact || primaryContact(d), sub: (d) => contractText(d) ?? (d.address || defaultAddress(d)), priority: 3 },
    {
      id: 'days', label: 'Payment terms', align: 'end', priority: 2, value: (d) => (d.paymentDays ? `${d.paymentDays} days` : 'No limit'),
      sub: (d) => `sell-out ${d.selloutDays ? d.selloutDays + ' days' : 'no limit'}`,
    },
    {
      id: 'limit', label: 'Credit limit', align: 'end',
      value: (d) => d.market && d.market !== 'Local'
        ? (Number(d.creditLimit) ? fmtMoney(d.creditLimit, d.creditCurrency ?? 'PKR') : 'Advance only')
        : (Number(d.creditLimit) ? fmtMoney(d.creditLimit) : 'No limit'),
      sub: (d) => (d.advancePct ? `${d.advancePct}% advance` : null),
    },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (d) => d.status ?? 'Active', tone: (d) => STATUS_TONE[d.status ?? 'Active'],
      sub: (d) => [
        d.market && d.market !== 'Local' ? `Registration: ${d.registrationStatus ?? 'Draft'}` : null,
        d.status === 'Temporary suspend' && d.statusUntil ? `until ${d.statusUntil}` : d.statusNote ?? null,
      ].filter(Boolean).join(' · ') || null, priority: 2,
    },
  ];
  protected distributorActions = (d: Distributor): RowAction[] => [
    ...(this.canDistributors() ? [{ id: 'edit', label: 'Edit' }] : []),
    ...(d.market && d.market !== 'Local' ? [{ id: 'registration', label: 'Registration' }, { id: 'commercial', label: 'Credit & prices' }, { id: 'account', label: 'Account' }] : []),
  ];

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
    if (e.id === 'account') {
      this.accountOf.set(e.row.id);
      this.accountOpen.set(true);
      return;
    }
    if (e.id === 'commercial') {
      this.commercial.set(e.row);
      this.commercialOpen.set(true);
      return;
    }
    if (e.id === 'registration') {
      this.registering.set(e.row.id);
      this.registrationOpen.set(true);
      return;
    }
    this.openDistributor(e.row);
  }
}

/** an international distributor's primary contact: name and email */
function primaryContact(d: Distributor) {
  const c = (d.contacts ?? []).find((x) => x.isPrimary);
  return c ? [c.name, c.email].filter(Boolean).join(' · ') : null;
}

/** an international distributor's default registered address */
function defaultAddress(d: Distributor) {
  const a = (d.addresses ?? []).find((x) => x.type === 'Registered' && x.isDefault) ?? d.addresses?.[0];
  return a ? [a.city, a.country].filter(Boolean).join(', ') : null;
}
