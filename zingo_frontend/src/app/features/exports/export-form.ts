import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtAmount2, fmtMoney, fmtPct } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas } from '../../ui';
import { Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { OpsApi } from '../ops/ops.api';
import { Distributor, DistributorPrice, Product } from '../ops/models';
import { ApiService } from '../../core/api.service';
import { QuoteInputs, quoteEstimate } from './export-math';
import { ExportsApi } from './exports.api';
import { ContainerType, ExportRow } from './models';

const today = () => new Date().toISOString().slice(0, 10);

/** the nine seller-side cost lines of a container, in the invoice currency */
const COSTS = [
  ['inland', 'Origin inland transport'], ['origin', 'Origin handling and port charges'], ['documentation', 'Documentation and certificates'],
  ['ocean', 'Ocean freight'], ['insurance', 'Marine insurance'], ['destination', 'Destination charges'],
  ['duty', 'Import duty'], ['bankFees', 'Bank charges'], ['otherCosts', 'Other costs'],
] as const;

/**
 * Build or change a container quote. Costs are typed in the invoice currency; which of them the seller carries
 * depends on the Incoterm, and the estimate underneath shows the result as the numbers are typed.
 * A shipped container is locked.
 */
@Component({
  selector: 'app-export-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, MoneyInput, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="quote() ? 'Edit container quote' : 'New container quote'"
               subtitle="A quote is a costing scenario. Shipping it posts the invoice, the goods cost and the seller's costs." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="International distributor" [wide]="true"
                   [hint]="distributorId() ? 'Its buyer name, country, port, Incoterm, currency, price and terms are filled in; change any of them for this order only' : 'Or a one-off buyer typed below'">
          <select formControlName="distributorId">
            <option value="">No distributor (one-off buyer)</option>
            @for (d of distributors(); track d.id) {
              <option [value]="d.id">{{ d.name }}{{ d.code ? ' · ' + d.code : '' }}{{ d.registrationStatus !== 'Active' ? ' (' + (d.registrationStatus ?? 'Draft').toLowerCase() + ')' : '' }}</option>
            }
          </select>
        </app-field>
        <app-field label="Quote date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Foreign buyer" [required]="true" [error]="invalid('buyer') ? 'Enter the buyer' : null"><input type="text" formControlName="buyer" /></app-field>
        <app-field label="Destination country" [required]="true" [error]="invalid('country') ? 'Enter the country' : null"><input type="text" formControlName="country" /></app-field>
        <app-field label="Destination port or named place"><input type="text" formControlName="port" /></app-field>
        <app-field label="Container type" [required]="true">
          <select formControlName="container">
            @for (c of containers(); track c.code) {
              <option [value]="c.code">{{ c.code }} · planning {{ c.maxCartons }} bundles</option>
            }
          </select>
        </app-field>
        <app-field label="Sale term (Incoterm)" [required]="true">
          <select formControlName="incoterm">
            @for (t of terms(); track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </app-field>
        <app-field label="Export product" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <select formControlName="productId">
            <option value="">Choose a product</option>
            @for (p of productChoices(); track p.id) {
              <option [value]="p.id">{{ p.sku }} · {{ p.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Bundles in this container" [required]="true" [error]="invalid('cartons') ? 'Enter at least 1 bundle' : null">
          <input type="number" formControlName="cartons" min="1" step="1" />
        </app-field>
        <app-field label="Invoice currency" [required]="true">
          <select formControlName="currency">
            @for (c of currencies(); track c.code) {
              <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Exchange rate" hint="PKR per 1 unit of the invoice currency" [required]="true" [error]="invalid('fxRate') ? 'Enter the rate' : null">
          <input type="number" formControlName="fxRate" min="0" step="any" />
        </app-field>
        <app-field label="Selling price per pack" [hint]="priceHint()" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null">
          <app-money-input formControlName="rate" [currency]="currencyCode()" [decimals]="4" />
        </app-field>
        @if (distributorId()) {
          <app-field label="Payment days" hint="After shipping; from the distributor, for this order only">
            <input type="number" formControlName="paymentDays" min="0" max="365" step="1" />
          </app-field>
        }
        @for (c of costs; track c[0]) {
          <app-field [label]="c[1]" [hint]="'In ' + currencyCode()"><app-money-input [formControlName]="c[0]" [currency]="currencyCode()" /></app-field>
        }
      </form>
      <div class="notice">
        <span>
          Invoice <strong>{{ currencyCode() }} {{ amount(est().revenueForeign) }}</strong> = {{ money(est().revenuePKR) }} ·
          goods cost about {{ money(est().cogs) }} · seller costs <strong>{{ currencyCode() }} {{ amount(est().costs.seller) }}</strong>
          ({{ money(est().sellerPKR) }}) · profit <strong>{{ money(est().net) }}</strong> ({{ pct(est().margin) }}).
          Goods cost is estimated at the product's planning rates until it ships.
        </span>
      </div>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ quote() ? 'Update quote' : 'Save quote' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ExportForm extends FormModal {
  readonly quote = input<ExportRow | null>(null);
  readonly products = input<Product[]>([]);
  readonly containers = input<ContainerType[]>([]);
  readonly currencies = input<Currency[]>([]);
  readonly defaultContainer = input('40HC');
  readonly defaultIncoterm = input('FOB');
  readonly packsPerCarton = input(432);
  /** international distributors an order can be for */
  readonly distributors = input<Distributor[]>([]);
  private http = inject(ApiService);
  /** the chosen distributor's price list, and the rate per pack it gives for the product and currency */
  private prices = signal<DistributorPrice[]>([]);
  /** true while the form is being filled from a quote (no defaults are applied then) */
  private resetting = false;
  protected priceRate = signal<number | null>(null);
  readonly formId = 'form-export';
  private store = inject(SettingsStore);
  /** active Incoterms, plus the one a quote already uses even if it was switched off since */
  protected terms = computed(() => {
    const list = this.store.incoterms().map((t) => t.code);
    const cur = this.quote()?.incoterm;
    return cur && !list.includes(cur) ? [...list, cur] : list;
  });
  protected costs = COSTS;
  protected money = fmtMoney;
  protected amount = fmtAmount2;
  protected pct = fmtPct;
  private exportsApi = inject(ExportsApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    buyer: ['', Validators.required],
    country: ['', Validators.required],
    port: [''],
    container: ['40HC'],
    incoterm: ['FOB'],
    productId: ['', Validators.required],
    cartons: [0, [Validators.required, Validators.min(1)]],
    currency: ['USD'],
    fxRate: [280, [Validators.required, Validators.min(0.000001)]],
    rate: [0, [Validators.required, Validators.min(0)]],
    inland: [0, Validators.min(0)],
    origin: [0, Validators.min(0)],
    documentation: [0, Validators.min(0)],
    ocean: [0, Validators.min(0)],
    insurance: [0, Validators.min(0)],
    destination: [0, Validators.min(0)],
    duty: [0, Validators.min(0)],
    bankFees: [0, Validators.min(0)],
    otherCosts: [0, Validators.min(0)],
    distributorId: [''],
    paymentDays: [0],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected currencyCode = computed(() => this.value().currency ?? 'USD');
  protected distributorId = computed(() => this.value().distributorId ?? '');
  private distributor = computed(() => this.distributors().find((d) => d.id === this.distributorId()) ?? null);
  /** with a distributor, only its approved SKUs */
  protected productChoices = computed(() => {
    const d = this.distributor();
    return d ? this.products().filter((p) => (d.approvedProductIds ?? []).includes(p.id)) : this.products();
  });
  protected priceHint = computed(() => {
    const r = this.priceRate();
    return r === null ? `In ${this.currencyCode()}` : `In ${this.currencyCode()}; its price list says ${r}`;
  });

  /** live costing of what is typed */
  protected est = computed(() => {
    const v = this.value();
    const p = this.products().find((x) => x.id === v.productId);
    const packs = Number(p?.packsPerCarton ?? this.packsPerCarton());
    const perPack = p ? Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate) : 0;
    return quoteEstimate(v as unknown as QuoteInputs, packs, perPack * packs, this.store.incotermFlags()[v.incoterm ?? ""]);
  });

  constructor() {
    super();
    // picking a currency fills its current rate
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      const rate = this.currencies().find((c) => c.code === code)?.rate;
      this.form.controls.fxRate.setValue(code === 'PKR' ? 1 : Number(rate ?? 1));
      this.applyPrice();
    });
    // picking a distributor fills its defaults (for this order only) and loads its price list
    this.form.controls.distributorId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => { if (!this.resetting) this.pickDistributor(id); });
    this.form.controls.productId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.applyPrice());
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.applyPrice());
  }

  private pickDistributor(id: string) {
    this.prices.set([]);
    this.priceRate.set(null);
    const d = this.distributors().find((x) => x.id === id);
    if (!d) return;
    const approved = d.approvedProductIds ?? [];
    this.form.patchValue({
      buyer: d.legalName || d.name, country: d.country || d.countries?.[0] || '', port: d.incotermPlace ?? '',
      ...(d.incoterm ? { incoterm: d.incoterm } : {}), paymentDays: d.paymentDays ?? 0,
      ...(approved.length && !approved.includes(this.form.controls.productId.value) ? { productId: approved[0] } : {}),
    });
    if (d.invoiceCurrency) this.form.controls.currency.setValue(d.invoiceCurrency);
    this.http.get<DistributorPrice[]>(`distributors/${d.id}/prices`).subscribe({
      next: (rows) => { this.prices.set(rows); this.applyPrice(); },
      error: () => this.prices.set([]),
    });
  }

  /** the price that applies on the quote date: a promotional one first, else the latest regular version */
  private applyPrice() {
    const v = this.form.getRawValue();
    if (!v.distributorId) return;
    const live = this.prices().filter((r) => r.productId === v.productId && r.currency === v.currency && r.status === 'Active'
      && r.effectiveFrom <= v.date && (!r.effectiveTo || r.effectiveTo >= v.date));
    const p = live.find((r) => r.promo) ?? live.filter((r) => !r.promo).sort((a, b) => b.version - a.version)[0];
    const rate = p ? Math.round((Number(p.price) * (1 - Number(p.discountPct) / 100) / Number(p.packsPerUnit)) * 1e6) / 1e6 : null;
    this.priceRate.set(rate);
    if (rate !== null) this.form.controls.rate.setValue(rate);
  }

  protected reset() {
    const q = this.quote();
    this.resetting = true;
    this.form.reset(q
      ? {
          date: q.date, buyer: q.buyer, country: q.country, port: q.port ?? '', container: q.container, incoterm: q.incoterm,
          productId: q.productId, cartons: q.cartons, currency: q.currency, fxRate: Number(q.fxRate), rate: Number(q.rate),
          inland: Number(q.inland), origin: Number(q.origin), documentation: Number(q.documentation), ocean: Number(q.ocean),
          insurance: Number(q.insurance), destination: Number(q.destination), duty: Number(q.duty), bankFees: Number(q.bankFees),
          otherCosts: Number(q.otherCosts), distributorId: q.distributorId ?? '', paymentDays: q.paymentDays ?? 0,
        }
      : {
          date: today(), buyer: '', country: '', port: '', container: this.defaultContainer(), incoterm: this.defaultIncoterm(),
          productId: this.products()[0]?.id ?? '', cartons: 0, currency: 'USD',
          fxRate: Number(this.currencies().find((c) => c.code === 'USD')?.rate ?? 280), rate: 0,
          inland: 0, origin: 0, documentation: 0, ocean: 0, insurance: 0, destination: 0, duty: 0, bankFees: 0, otherCosts: 0,
          distributorId: '', paymentDays: 0,
        });
    this.resetting = false;
    this.prices.set([]);
    this.priceRate.set(null);
    if (q?.distributorId) {
      this.http.get<DistributorPrice[]>(`distributors/${q.distributorId}/prices`).subscribe({ next: (rows) => this.prices.set(rows), error: () => this.prices.set([]) });
    }
  }

  protected request() {
    const { distributorId, paymentDays, ...v } = this.form.getRawValue();
    if (!distributorId) return this.exportsApi.save(this.quote()?.id ?? null, { ...v, ...(this.quote() ? { distributorId: null } : {}) });
    // the price-list rate is left for the server, so the order keeps the link to the price version
    const fromList = this.priceRate() !== null && Math.abs(Number(v.rate) - (this.priceRate() ?? 0)) < 1e-9 && !this.quote();
    const { rate, ...rest } = v;
    return this.exportsApi.save(this.quote()?.id ?? null, { ...rest, ...(fromList ? {} : { rate }), distributorId, paymentDays: Number(paymentDays) || 0 });
  }

  protected successMessage() {
    return this.quote() ? 'Container quote updated.' : 'Container quote saved. Ship it when the goods leave.';
  }
}
