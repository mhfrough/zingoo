import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ContainerType } from '../features/exports/models';
import { Currency } from '../features/finance/models';
import { Settings } from '../features/ops/models';
import { setNumberLocale } from '../shared/format';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** One entry of an editable pick-list (payment methods, Incoterms). */
export interface Lookup {
  id: string;
  list: 'PAY_METHOD' | 'INCOTERM';
  code: string;
  description: string;
  /** Incoterms: which cost lines the seller carries */
  flags: Record<string, boolean>;
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
  private params = computed(() => (this.auth.user() ? { user: this.auth.user()!.id, tick: this.tick() } : undefined));

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
