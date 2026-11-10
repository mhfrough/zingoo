import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtAmount2, fmtMoney, fmtPct } from '../../shared/format';
import { Btn, Field, Offcanvas } from '../../ui';
import { Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { Product } from '../ops/models';
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
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="quote() ? 'Edit container quote' : 'New container quote'"
               subtitle="A quote is a costing scenario. Shipping it posts the invoice, the goods cost and the seller's costs." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Quote date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Foreign buyer" [required]="true" [error]="invalid('buyer') ? 'Enter the buyer' : null"><input type="text" formControlName="buyer" /></app-field>
        <app-field label="Destination country" [required]="true" [error]="invalid('country') ? 'Enter the country' : null"><input type="text" formControlName="country" /></app-field>
        <app-field label="Destination port or named place"><input type="text" formControlName="port" /></app-field>
        <app-field label="Container type" [required]="true">
          <select formControlName="container">
            @for (c of containers(); track c.code) {
              <option [value]="c.code">{{ c.code }} · planning {{ c.maxCartons }} cartons</option>
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
            @for (p of products(); track p.id) {
              <option [value]="p.id">{{ p.sku }} · {{ p.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Cartons in this container" [required]="true" [error]="invalid('cartons') ? 'Enter at least 1 carton' : null">
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
        <app-field label="Selling price per pack" [hint]="'In ' + currencyCode()" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null">
          <input type="number" formControlName="rate" min="0" step="any" />
        </app-field>
        @for (c of costs; track c[0]) {
          <app-field [label]="c[1]" [hint]="'In ' + currencyCode()"><input type="number" [formControlName]="c[0]" min="0" step="0.01" /></app-field>
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
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected currencyCode = computed(() => this.value().currency ?? 'USD');

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
    });
  }

  protected reset() {
    const q = this.quote();
    this.form.reset(q
      ? {
          date: q.date, buyer: q.buyer, country: q.country, port: q.port ?? '', container: q.container, incoterm: q.incoterm,
          productId: q.productId, cartons: q.cartons, currency: q.currency, fxRate: Number(q.fxRate), rate: Number(q.rate),
          inland: Number(q.inland), origin: Number(q.origin), documentation: Number(q.documentation), ocean: Number(q.ocean),
          insurance: Number(q.insurance), destination: Number(q.destination), duty: Number(q.duty), bankFees: Number(q.bankFees),
          otherCosts: Number(q.otherCosts),
        }
      : {
          date: today(), buyer: '', country: '', port: '', container: this.defaultContainer(), incoterm: this.defaultIncoterm(),
          productId: this.products()[0]?.id ?? '', cartons: 0, currency: 'USD',
          fxRate: Number(this.currencies().find((c) => c.code === 'USD')?.rate ?? 280), rate: 0,
          inland: 0, origin: 0, documentation: 0, ocean: 0, insurance: 0, destination: 0, duty: 0, bankFees: 0, otherCosts: 0,
        });
  }

  protected request() {
    return this.exportsApi.save(this.quote()?.id ?? null, this.form.getRawValue());
  }

  protected successMessage() {
    return this.quote() ? 'Container quote updated.' : 'Container quote saved. Ship it when the goods leave.';
  }
}
