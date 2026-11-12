import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ContainerType } from '../features/exports/models';
import { Currency } from '../features/finance/models';
import { Settings } from '../features/ops/models';
import { setNumberLocale } from '../shared/format';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** The editable pick-lists on Settings & Data. */
export type LookupList =
  | 'PAY_METHOD' | 'INCOTERM' | 'CAPITAL_SOURCE' | 'STREAM_TYPE' | 'PERSON'
  | 'LOAN_TENURE' | 'REPAY_PLAN' | 'REPAY_FREQUENCY' | 'ADVANCE_PURPOSE' | 'SETTLEMENT_METHOD' | 'BANK_ACCOUNT' | 'DELIVERY_STATUS' | 'BILL_TYPE' | 'BILL_TREATMENT' | 'APPROVER' | 'FLAVOUR' | 'PACKET_SIZE' | 'BANK' | 'ORDER_STAGE';

/** One entry of an editable pick-list (payment methods, Incoterms, capital sources, stream types, people). */
export interface Lookup {
  id: string;
  list: LookupList;
  code: string;
  description: string;
  /** Incoterm cost lines, capital source { liability }, stream type { depreciable } */
  flags: Record<string, boolean>;
  /** an investor account: { company, poc } */
  meta?: Record<string, string>;
  active: boolean;
  sortOrder: number;
}

/**
 * The company's settings and pick-lists, loaded once after sign-in and shared by every form and page.
 * Everything the client controls from Settings & Data (payment methods, Incoterms, currencies, containers, assumptions)
 * is read from here, so a change made there shows up in every form without a reload.
 * Call reload() after changing any of it.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  private tick = signal(0);
  /** a distributor login has no access to the company settings, so nothing is loaded for it (its portal sends what it needs) */
  private params = computed(() => {
    const u = this.auth.user();
    return u && u.role !== 'Distributor' && u.role !== 'Manufacturer' ? { user: u.id, tick: this.tick() } : undefined;
  });

  readonly settingsRes = rxResource({ params: () => this.params(), stream: () => this.api.get<Settings>('settings') });
  readonly lookupsRes = rxResource({ params: () => this.params(), stream: () => this.api.get<Lookup[]>('lookups') });
  readonly currenciesRes = rxResource({ params: () => this.params(), stream: () => this.api.get<Currency[]>('currencies') });
  readonly containersRes = rxResource({ params: () => this.params(), stream: () => this.api.get<ContainerType[]>('container-types') });

  readonly settings = computed(() => this.settingsRes.value() ?? null);
  readonly currencies = computed(() => this.currenciesRes.value() ?? []);
  readonly containers = computed(() => this.containersRes.value() ?? []);
  /** every list entry, including the switched-off ones (Settings & Data shows them all) */
  readonly lookups = computed(() => this.lookupsRes.value() ?? []);
  /** payment methods a new payment may use */
  readonly paymentMethods = computed(() => this.lookups().filter((l) => l.list === 'PAY_METHOD' && l.active).map((l) => l.code));
  /** capital sources a new investment may use (Equity, Shareholder Loan, Partner Advance ...) */
  readonly capitalSources = computed(() => this.lookups().filter((l) => l.list === 'CAPITAL_SOURCE' && l.active).map((l) => l.code));
  /** the same with their meaning and whether a source is a loan or advance (money to pay back) */
  readonly capitalSourceEntries = computed(() => this.lookups().filter((l) => l.list === 'CAPITAL_SOURCE' && l.active));
  /** types of investment stream a cost center may have (Fixed Asset, Movable Asset, Operation Cost ...) */
  readonly streamTypes = computed(() => this.lookups().filter((l) => l.list === 'STREAM_TYPE' && l.active));
  /** the active choices of a simple list (loan tenure, repayment plan, advance purpose, bank account ...) */
  options(list: LookupList) {
    return this.lookups().filter((l) => l.list === list && l.active).map((l) => l.code);
  }
  readonly loanTenures = computed(() => this.options('LOAN_TENURE'));
  readonly repayPlans = computed(() => this.options('REPAY_PLAN'));
  readonly repayFrequencies = computed(() => this.options('REPAY_FREQUENCY'));
  readonly advancePurposes = computed(() => this.options('ADVANCE_PURPOSE'));
  readonly settlementMethods = computed(() => this.options('SETTLEMENT_METHOD'));
  readonly bankAccounts = computed(() => this.options('BANK_ACCOUNT'));
  /** Incoterms a new quote may use */
  readonly incoterms = computed(() => this.lookups().filter((l) => l.list === 'INCOTERM' && l.active));
  /** the cost lines the seller carries, per Incoterm code */
  readonly incotermFlags = computed<Record<string, Record<string, boolean>>>(() =>
    Object.fromEntries(this.lookups().filter((l) => l.list === 'INCOTERM').map((l) => [l.code, l.flags])));

  constructor() {
    // numbers and amounts follow the locale chosen in Settings & Data
    effect(() => setNumberLocale(this.settings()?.numberFormat));
  }

  /** load everything again (after a change on Settings & Data) */
  reload() {
    this.tick.update((n) => n + 1);
  }
}
