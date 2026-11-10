import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { Lookup, SettingsStore } from '../../core/settings.store';
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
            <div><h2>Container types</h2><p>Planning cartons per container</p></div>
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
  protected store = inject(SettingsStore);
  protected auth = inject(AuthService);
  protected canEdit = computed(() => this.auth.can('admin'));
  private api = inject(SettingsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);

  protected methods = computed(() => this.store.lookups().filter((l) => l.list === 'PAY_METHOD'));
  protected incoterms = computed(() => this.store.lookups().filter((l) => l.list === 'INCOTERM'));

  private statusTone = (l: Lookup): Tone => (l.active ? 'success' : 'neutral');

  protected methodColumns: TableColumn<Lookup>[] = [
    { id: 'code', label: 'Method', value: (l) => l.code },
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
    { id: 'max', label: 'Planning cartons', kind: 'number', align: 'end', value: (c) => c.maxCartons },
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
  protected lookupList = signal<'PAY_METHOD' | 'INCOTERM'>('PAY_METHOD');
  protected editingLookup = signal<Lookup | null>(null);
  protected containerOpen = signal(false);
  protected editingContainer = signal<ContainerType | null>(null);
  protected currencyOpen = signal(false);
  protected editingCurrency = signal<Currency | null>(null);

  protected openLookup(list: 'PAY_METHOD' | 'INCOTERM', entry: Lookup | null = null) {
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
