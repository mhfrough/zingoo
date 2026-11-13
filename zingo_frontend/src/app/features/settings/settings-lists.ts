import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { Lookup, LookupList, SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount2, fmtNumber } from '../../shared/format';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { ContainerType } from '../exports/models';
import { Currency } from '../finance/models';
import { ContainerForm } from './container-form';
import { CurrencyForm } from './currency-form';
import { LookupForm } from './lookup-form';
import { SettingsApi } from './settings.api';

const LINES = ['origin', 'ocean', 'insurance', 'destination', 'duty'];

/**
 * The pick-lists the client edits: payment methods, Incoterms (with the cost lines the seller carries),
 * container types and currencies with their exchange rates. Forms read these lists, so a change shows up everywhere.
 */
@Component({
  selector: 'app-settings-lists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, LookupForm, ContainerForm, CurrencyForm],
  template: `
    <div class="stack">
      @if (section() === 'lists') {
      <div class="two-col">
        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Payment methods</h2><p>Offered when money is collected or paid</p></div>
            @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openLookup('PAY_METHOD')">Add method</button>
            }
          </div>
          <div class="card__body">
            <app-data-table [columns]="methodColumns" [rows]="methods()" [actions]="lookupActions" [searchable]="false"
              [loading]="store.lookupsRes.isLoading()" emptyTitle="No payment methods" emptyText="Add the first one."
              (action)="onLookupAction($event)" />
          </div>
        </div>

        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Container types</h2><p>Planning bundles per container</p></div>
            @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openContainer()">Add type</button>
            }
          </div>
          <div class="card__body">
            <app-data-table [columns]="containerColumns" [rows]="store.containers()" [actions]="containerActions" [searchable]="false"
              [loading]="store.containersRes.isLoading()" emptyTitle="No container types" emptyText="Add the first one."
              (action)="onContainerAction($event)" />
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Capital sources</h2><p>Where investor money comes from. A loan or advance is booked as money to pay back</p></div>
            @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openLookup('CAPITAL_SOURCE')">Add source</button>
            }
          </div>
          <div class="card__body">
            <app-data-table [columns]="sourceColumns" [rows]="sources()" [actions]="lookupActions" [searchable]="false"
              [loading]="store.lookupsRes.isLoading()" emptyTitle="No capital sources" emptyText="Add the first one."
              (action)="onLookupAction($event)" />
          </div>
        </div>

        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Investment stream types</h2><p>Each investment stream has a type, such as a fixed asset with its depreciation</p></div>
            @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openLookup('STREAM_TYPE')">Add type</button>
            }
          </div>
          <div class="card__body">
            <app-data-table [columns]="typeColumns" [rows]="streamTypes()" [actions]="lookupActions" [searchable]="false"
              [loading]="store.lookupsRes.isLoading()" emptyTitle="No stream types" emptyText="Add the first one."
              (action)="onLookupAction($event)" />
          </div>
        </div>
      </div>

      <div class="two-col">
        @for (s of simpleLists; track s.list) {
          <div class="card" data-flush>
            <div class="card__head">
              <div><h2>{{ s.title }}</h2><p>{{ s.sub }}</p></div>
              @if (canEdit()) {
                <button appBtn size="sm" icon="plus" (click)="openLookup(s.list)">{{ s.add }}</button>
              }
            </div>
            <div class="card__body">
              <app-data-table [columns]="simpleColumns" [rows]="simpleRows()[s.list] ?? []" [actions]="lookupActions" [searchable]="false"
                [loading]="store.lookupsRes.isLoading()" emptyTitle="Nothing here yet" emptyText="Add the first one." (action)="onLookupAction($event)" />
            </div>
          </div>
        }
      </div>

      }
      @if (section() === 'investors') {
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Investor accounts</h2><p>Investors and business owners (or both), with company and point of contact. Each one gets a separate account in the books</p></div>
          @if (canEdit()) {
            <button appBtn size="sm" icon="plus" (click)="openLookup('PERSON')">Add investor account</button>
          }
        </div>
        <div class="card__body">
          <app-data-table [columns]="personColumns" [rows]="people()" [actions]="lookupActions" [searchable]="false"
            [loading]="store.lookupsRes.isLoading()" emptyTitle="No investor accounts yet" emptyText="Add the investors and business owners."
            (action)="onLookupAction($event)" />
        </div>
      </div>
      }

      @if (section() === 'lists') {
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Incoterms</h2><p>Which cost lines the seller carries decides the export costing and the posted logistics</p></div>
          @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openLookup('INCOTERM')">Add Incoterm</button>
            }
        </div>
        <div class="card__body">
          <app-data-table [columns]="incotermColumns" [rows]="incoterms()" [actions]="lookupActions" [searchable]="false"
            [loading]="store.lookupsRes.isLoading()" emptyTitle="No Incoterms" emptyText="Add the first one." (action)="onLookupAction($event)" />
        </div>
      </div>

      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Currencies and exchange rates</h2><p>PKR per 1 unit. A new document starts from the current rate and freezes it.</p></div>
          @if (canEdit()) {
              <button appBtn size="sm" icon="plus" (click)="openCurrency()">Add currency</button>
            }
        </div>
        <div class="card__body">
          <app-data-table [columns]="currencyColumns" [rows]="store.currencies()" [actions]="currencyActions" [searchable]="false"
            [loading]="store.currenciesRes.isLoading()" emptyTitle="No currencies" emptyText="Add the first one." (action)="onCurrencyAction($event)" />
        </div>
      </div>
      }
    </div>

    <app-lookup-form [(open)]="lookupOpen" [list]="lookupList()" [entry]="editingLookup()" (saved)="store.reload()" />
    <app-container-form [(open)]="containerOpen" [container]="editingContainer()" (saved)="store.reload()" />
    <app-currency-form [(open)]="currencyOpen" [currency]="editingCurrency()" (saved)="store.reload()" />
  `,
  styles: `
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-4);

      @media (max-width: 1100px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class SettingsLists {
  /** which part to show: the pick-lists and currencies, or the investor accounts (their own tab) */
  readonly section = input<'lists' | 'investors'>('lists');
  protected store = inject(SettingsStore);
  protected auth = inject(AuthService);
  protected canEdit = computed(() => this.auth.can('admin'));
  private api = inject(SettingsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);

  protected methods = computed(() => this.store.lookups().filter((l) => l.list === 'PAY_METHOD'));
  protected incoterms = computed(() => this.store.lookups().filter((l) => l.list === 'INCOTERM'));
  protected sources = computed(() => this.store.lookups().filter((l) => l.list === 'CAPITAL_SOURCE'));
  protected streamTypes = computed(() => this.store.lookups().filter((l) => l.list === 'STREAM_TYPE'));
  protected people = computed(() => this.store.lookups().filter((l) => l.list === 'PERSON'));

  /** the small lists behind the loan and advance forms and the bank accounts: a name and a status each */
  protected simpleLists: { list: LookupList; title: string; sub: string; add: string }[] = [
    { list: 'LOAN_TENURE', title: 'Loan tenure', sub: 'How long a loan runs', add: 'Add tenure' },
    { list: 'REPAY_PLAN', title: 'Repayment plan', sub: 'How a loan is paid back', add: 'Add plan' },
    { list: 'REPAY_FREQUENCY', title: 'Repayment frequency', sub: 'For a loan paid in installments', add: 'Add frequency' },
    { list: 'ADVANCE_PURPOSE', title: 'Advance purpose', sub: 'Why a partner advances money', add: 'Add purpose' },
    { list: 'SETTLEMENT_METHOD', title: 'Settlement method', sub: 'How an advance is expected to be settled', add: 'Add method' },
    { list: 'DIST_CLASSIFICATION', title: 'Distributor classifications', sub: 'What kind of business an international distributor is', add: 'Add classification' },
    { list: 'CERT_TYPE', title: 'Certificate types', sub: 'Certificates a market can ask for on a product', add: 'Add certificate type' },
    { list: 'EXPORT_DOC_TYPE', title: 'Export document types', sub: 'Documents kept on an export shipment', add: 'Add document type' },
    { list: 'REMITTANCE_METHOD', title: 'Remittance methods', sub: 'How international distributors may pay', add: 'Add method' },
    { list: 'KYC_DOC_TYPE', title: 'KYC document types', sub: 'Documents an international distributor gives; required ones are checked on submission', add: 'Add document type' },
    { list: 'ORDER_STAGE', title: 'Production stages', sub: 'Steps a manufacturer reports on an order, in order', add: 'Add stage' },
    { list: 'BANK', title: 'Banks', sub: 'Banks a manufacturer can be paid at', add: 'Add bank' },
    { list: 'BANK_ACCOUNT', title: 'Bank and cash accounts', sub: 'Which account took or paid the money. A label on each entry', add: 'Add account' },
    { list: 'DELIVERY_STATUS', title: 'Delivery statuses', sub: 'Dispatch and acceptance of an income invoice', add: 'Add status' },
    { list: 'BILL_TYPE', title: 'Bill types', sub: 'The first choice on every bill / expense', add: 'Add bill type' },
    { list: 'BILL_TREATMENT', title: 'Accounting treatments', sub: 'How a bill is treated. A label for now: bills post as expenses', add: 'Add treatment' },
    { list: 'APPROVER', title: 'Approvers', sub: 'Who approves a bill. The two signatures still decide', add: 'Add approver' },
    { list: 'FLAVOUR', title: 'Flavours', sub: 'Offered on every product / SKU', add: 'Add flavour' },
    { list: 'PACKET_SIZE', title: 'Packet sizes', sub: 'Weight or price tier of a packet, offered on every product', add: 'Add size' },
  ];
  protected simpleRows = computed(() => {
    const out: Partial<Record<LookupList, Lookup[]>> = {};
    for (const s of this.simpleLists) out[s.list] = this.store.lookups().filter((l) => l.list === s.list);
    return out;
  });
  protected simpleColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Name', value: (l) => l.code, sub: (l) => [l.flags?.['required'] ? 'Required' : null, l.description || null].filter(Boolean).join(' · ') || null },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: (l): Tone => (l.active ? 'success' : 'neutral') },
  ];

  private statusTone = (l: Lookup): Tone => (l.active ? 'success' : 'neutral');

  protected methodColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Method', value: (l) => l.code },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: this.statusTone },
  ];

  protected sourceColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Source', value: (l) => l.code, sub: (l) => l.description },
    { id: 'kind', label: 'Booked as', priority: 2, value: (l) => (l.flags['liability'] ? (l.flags['advance'] ? 'Advance (to pay back)' : 'Loan (to pay back)') : 'Owner equity') },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: this.statusTone },
  ];

  protected typeColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Type', value: (l) => l.code, sub: (l) => l.description },
    { id: 'dep', label: 'Depreciation', priority: 2, value: (l) => (l.flags['depreciable'] ? 'Has a depreciation rate' : 'None') },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: this.statusTone },
  ];

  protected personColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Name', value: (l) => l.code, sub: (l) => l.meta?.['company'] || null },
    { id: 'role', label: 'Role', priority: 2, value: (l) => [l.flags['investor'] && 'Investor', l.flags['owner'] && 'Business owner'].filter(Boolean).join(' · ') || '—' },
    { id: 'poc', label: 'Point of contact', priority: 3, value: (l) => l.meta?.['poc'] || null, sub: (l) => l.description || null },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: this.statusTone },
  ];

  protected incotermColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Incoterm', value: (l) => l.code, sub: (l) => l.description },
    {
      id: 'carries', label: 'Seller carries', priority: 2,
      value: (l) => LINES.filter((k) => l.flags[k]).join(', ') || 'Bank charges only',
    },
    { id: 'status', label: 'Status', kind: 'tag', value: (l) => (l.active ? 'Active' : 'Switched off'), tone: this.statusTone },
  ];

  protected lookupActions = (l: Lookup): RowAction[] => !this.canEdit() ? [] : [{ id: 'edit', label: 'Edit' }, { id: 'toggle', label: l.active ? 'Switch off' : 'Switch on', tone: l.active ? 'danger' : 'success' }];

  protected containerColumns: TableColumn<ContainerType>[] = [
    { id: 'code', label: 'Container', value: (c) => c.code },
    { id: 'max', label: 'Planning bundles', kind: 'number', align: 'end', value: (c) => c.maxCartons },
  ];
  protected containerActions = (): RowAction[] => !this.canEdit() ? [] : [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' }];

  protected currencyColumns: TableColumn<Currency>[] = [
    { id: 'code', label: 'Currency', value: (c) => c.code, sub: (c) => c.name },
    { id: 'symbol', label: 'Symbol', value: (c) => c.symbol, priority: 3 },
    {
      id: 'rate', label: 'PKR per unit', kind: 'mono', align: 'end', value: (c) => fmtAmount2(c.rate, Number(c.rate) < 10 ? 4 : 2),
      sortValue: (c) => Number(c.rate),
    },
  ];
  protected currencyActions = (c: Currency): RowAction[] => !this.canEdit() ? [] : [{ id: 'edit', label: 'Edit' }, ...(c.code === 'PKR' ? [] : [{ id: 'delete', label: 'Delete', tone: 'danger' as const }])];

  // forms
  protected lookupOpen = signal(false);
  protected lookupList = signal<LookupList>('PAY_METHOD');
  protected editingLookup = signal<Lookup | null>(null);
  protected containerOpen = signal(false);
  protected editingContainer = signal<ContainerType | null>(null);
  protected currencyOpen = signal(false);
  protected editingCurrency = signal<Currency | null>(null);

  protected openLookup(list: LookupList, entry: Lookup | null = null) {
    this.lookupList.set(list);
    this.editingLookup.set(entry);
    this.lookupOpen.set(true);
  }
  protected openContainer(c: ContainerType | null = null) {
    this.editingContainer.set(c);
    this.containerOpen.set(true);
  }
  protected openCurrency(c: Currency | null = null) {
    this.editingCurrency.set(c);
    this.currencyOpen.set(true);
  }

  protected onLookupAction(e: RowActionEvent<Lookup>) {
    if (e.id === 'edit') return this.openLookup(e.row.list, e.row);
    this.api.updateLookup(e.row.id, { active: !e.row.active }).subscribe({
      next: () => { this.toast.success(e.row.active ? `${e.row.code} switched off. It is no longer offered in new forms.` : `${e.row.code} is active again.`); this.store.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected onContainerAction(e: RowActionEvent<ContainerType>) {
    if (e.id === 'edit') return this.openContainer(e.row);
    void this.remove(`container type ${e.row.code}`, this.api.deleteContainer(e.row.code));
  }

  protected onCurrencyAction(e: RowActionEvent<Currency>) {
    if (e.id === 'edit') return this.openCurrency(e.row);
    void this.remove(`currency ${e.row.code}`, this.api.deleteCurrency(e.row.code));
  }

  private async remove(what: string, call: ReturnType<SettingsApi['deleteContainer']>) {
    const ok = await this.confirm.ask({ title: `Delete ${what}?`, message: 'It is removed for good. One that records already use cannot be deleted.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    call.subscribe({
      next: () => { this.toast.success('Deleted.'); this.store.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected number = fmtNumber;
}
