import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas, TabItem, Tabs, Tag } from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountingDoc, Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { Product } from '../ops/models';
import { OpsApi } from '../ops/ops.api';

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Uom = 'Packs' | 'Dozens' | 'Cartons';
const UOMS: Uom[] = ['Packs', 'Dozens', 'Cartons'];
/** what each unit is called on screen ('Cartons' is the stored name of a bundle) */
const UOM_LABEL: Record<Uom, string> = { Packs: 'Packets', Dozens: 'Dozens', Cartons: 'Bundles' };
const COSTS = [['freight', 'Freight / delivery'], ['insurance', 'Insurance'], ['customs', 'Customs / clearance'], ['packaging', 'Extra packaging / handling'], ['other', 'Other order costs']] as const;

const lineGroup = (fb: NonNullableFormBuilder, l?: { productId: string; qty: number; uom: Uom; sellPrice: number; unitCost: number }) =>
  fb.group({
    productId: [l?.productId ?? '', Validators.required],
    qty: [l?.qty ?? 0, [Validators.required, Validators.min(0.01)]],
    uom: [l?.uom ?? ('Packs' as Uom)],
    sellPrice: [l?.sellPrice ?? 0, [Validators.min(0)]],
    unitCost: [l?.unitCost ?? 0, [Validators.min(0)]],
  });
type LineForm = ReturnType<typeof lineGroup>;

/**
 * Record an income invoice in steps, as in the client's design: 01 invoice details (customer, terms, receiving account,
 * dispatch), 02 SKU lines with discount, sales tax and the costs the seller carries, and the profit it leaves.
 * Saved as a draft (nothing posts) or issued (posts to the ledger: receivable, income and sales tax).
 */
@Component({
  selector: 'app-income-invoice-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, MoneyInput, Btn, Tabs, Tag],
  styles: `
    .step {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
      padding-block-start: var(--space-4);
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);

      & + .block {
        padding-block-start: var(--space-5);
        border-block-start: 1px solid var(--border);
      }

      & > header h3 {
        margin: 0;
        font-size: var(--text-md);
      }

      & > header p {
        margin: var(--space-1) 0 0;
        font-size: var(--text-xs);
        color: var(--text-3);
      }
    }

    .grid-4 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
      gap: var(--space-3) var(--space-4);
    }

    /* SKU lines: sku, quantity, uom, sell, cost, line sales, remove */
    .items {
      container-type: inline-size;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-sunken);
      padding: var(--space-3);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .items__head,
    .item {
      display: grid;
      grid-template-columns: minmax(10rem, 2.2fr) minmax(5rem, 1fr) minmax(6rem, 1fr) minmax(6rem, 1fr) minmax(6rem, 1fr) minmax(6rem, 1fr) var(--btn-h-sm);
      gap: var(--space-2);
      align-items: start;
    }

    .items__head {
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .item__packs,
    .items__note {
      font-size: var(--text-xs);
      color: var(--text-3);
    }

    .item__sales {
      align-self: center;
      text-align: end;
      font-family: var(--font-mono);
      font-weight: var(--weight-semibold);
    }

    .cap {
      display: none;
      font-size: var(--text-xs);
      color: var(--text-3);
    }

    @container (max-width: 44rem) {
      .items__head {
        display: none;
      }

      .item {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--btn-h-sm);
        padding-block-end: var(--space-2);
        border-block-end: 1px solid var(--border);
      }

      .item__sku {
        grid-column: 1 / -1;
      }

      .cap {
        display: block;
      }

      .item__sales {
        text-align: start;
      }
    }

    .items__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }

    /* profitability check */
    .profit {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
      gap: var(--space-2);

      & > div {
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface-card);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }

      & span {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & strong {
        font-family: var(--font-mono);
        font-size: var(--text-md);
      }

      & [data-bad] strong {
        color: var(--danger);
      }
    }

    .foot-status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin-inline-end: auto;
      font-size: var(--text-sm);
      color: var(--text-2);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="doc() ? 'Edit income ' + doc()!.refNo : 'Record new income'"
                   subtitle="Sales invoice, SKU costing and profitability." size="xl" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <app-tabs [tabs]="steps" [(active)]="step" [remember]="false" param="invoiceStep" ariaLabel="Invoice steps" />
      <form [id]="formId" [formGroup]="form" (ngSubmit)="issue()" novalidate>
        @switch (step()) {
          @case ('details') {
            <div class="step">
              <section class="block">
                <header><h3>Invoice classification & customer</h3><p>Who owes you, what type of income it is, and the agreed terms.</p></header>
                <div class="grid-4">
                  <app-field label="Income category" [required]="true">
                    <select formControlName="category">
                      @for (c of categories(); track c) {
                        <option [value]="c">{{ c }}</option>
                      }
                    </select>
                  </app-field>
                  <app-field label="Invoice / bill number" hint="Blank: the document number is used">
                    <input type="text" formControlName="invoiceNo" maxlength="60" [placeholder]="doc()?.refNo ?? 'e.g. ZF-INV-0001'" />
                  </app-field>
                  <app-field label="Invoice date" [required]="true"><input type="date" formControlName="date" /></app-field>
                  <app-field label="Customer / income source" [required]="true" [error]="invalid('party') ? 'Enter who owes the money' : null">
                    <input type="text" formControlName="party" maxlength="150" placeholder="Distributor, export buyer or payer" />
                  </app-field>
                  <app-field label="Customer ID / tax reference"><input type="text" formControlName="customerTaxId" maxlength="60" placeholder="Optional" /></app-field>
                  <app-field label="Region / sales territory"><input type="text" formControlName="region" maxlength="80" placeholder="e.g. Hyderabad" /></app-field>
                  <app-field label="Invoice currency" [required]="true">
                    <select formControlName="currency">
                      @for (c of currencies(); track c.code) {
                        <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
                      }
                    </select>
                  </app-field>
                  <app-field label="Exchange rate · PKR per 1 unit" hint="Stored on the document; used for PKR reporting and profit">
                    <input type="number" formControlName="fxRate" min="0" step="any" />
                  </app-field>
                  <app-field label="Payment terms">
                    <select formControlName="paymentDays">
                      <option [ngValue]="0">On receipt</option>
                      @for (d of cycles(); track d) {
                        <option [ngValue]="d">{{ d }} days</option>
                      }
                    </select>
                  </app-field>
                  <app-field label="Due date" [required]="true"><input type="date" formControlName="dueDate" /></app-field>
                  <app-field label="Receiving account" hint="From Settings">
                    <select formControlName="receivingAccount">
                      <option value="">Choose</option>
                      @for (b of bankAccounts(); track b) {
                        <option [value]="b">{{ b }}</option>
                      }
                    </select>
                  </app-field>
                  <app-field label="Order / contract reference"><input type="text" formControlName="orderRef" maxlength="80" placeholder="e.g. ORD-1025" /></app-field>
                </div>
              </section>

              <section class="block">
                <header><h3>Receipt & dispatch controls</h3><p>Track dispatch and acceptance separately from collections.</p></header>
                <div class="grid-4">
                  <app-field label="Delivery / acceptance status" hint="From Settings">
                    <select formControlName="deliveryStatus">
                      <option value="">Choose</option>
                      @for (s of deliveryStatuses(); track s) {
                        <option [value]="s">{{ s }}</option>
                      }
                    </select>
                  </app-field>
                  <app-field label="GRN / delivery challan / POD"><input type="text" formControlName="deliveryProof" maxlength="120" placeholder="Proof of delivery" /></app-field>
                  <app-field label="Sales / route owner"><input type="text" formControlName="salesOwner" maxlength="120" placeholder="Sales agent" /></app-field>
                </div>
              </section>

              <section class="block">
                <header><h3>Internal notes</h3></header>
                <app-field label="Notes"><textarea formControlName="note" placeholder="Commercial notes, special terms, discount approval, references"></textarea></app-field>
              </section>
            </div>
          }
          @case ('items') {
            <div class="step">
              <section class="block">
                <header><h3>SKU-wise sales and landed margin</h3><p>Quantity in packs, dozens or bundles. Selling price is per pack in {{ cur() }}; unit cost is per pack in PKR.</p></header>
                <div class="items" formArrayName="lines">
                  <div class="items__bar">
                    <strong>Invoice items <app-tag tone="neutral">{{ lines.length }}</app-tag></strong>
                    <button appBtn type="button" size="sm" icon="plus" [disabled]="lines.length >= 50" (click)="addLine()">Add SKU</button>
                  </div>
                  <div class="items__head" aria-hidden="true">
                    <span>SKU / product</span><span>Quantity</span><span>UOM</span><span>Sell / pack ({{ cur() }})</span><span>Cost / pack (PKR)</span><span>Line sales</span><span></span>
                  </div>
                  @for (l of lines.controls; track l; let i = $index) {
                    <div class="item" [formGroupName]="i">
                      <div class="item__sku field"><span class="cap">SKU / product</span><div class="field__control">
                        <select formControlName="productId" (change)="onProduct(l)" [attr.aria-label]="'SKU, line ' + (i + 1)">
                          <option value="">Choose a SKU</option>
                          @for (p of products(); track p.id) {
                            <option [value]="p.id">{{ p.name }} · Rs {{ p.mrp }}</option>
                          }
                        </select>
                      </div></div>
                      <div class="field"><span class="cap">Quantity</span><div class="field__control">
                        <app-money-input formControlName="qty" currency="" [decimals]="2" [ariaLabel]="'Quantity, line ' + (i + 1)" />
                      </div></div>
                      <div class="field"><span class="cap">UOM</span><div class="field__control">
                        <select formControlName="uom" [attr.aria-label]="'Unit, line ' + (i + 1)">
                          @for (u of uoms; track u) {
                            <option [value]="u">{{ uomLabel[u] }}</option>
                          }
                        </select>
                      </div>
                        <span class="item__packs">{{ packsOf(l) }} packs</span>
                      </div>
                      <div class="field"><span class="cap">Sell / pack</span><div class="field__control">
                        <app-money-input formControlName="sellPrice" currency="" [decimals]="2" [ariaLabel]="'Sell price per pack, line ' + (i + 1)" />
                      </div></div>
                      <div class="field"><span class="cap">Cost / pack (PKR)</span><div class="field__control">
                        <app-money-input formControlName="unitCost" currency="" [decimals]="2" [ariaLabel]="'Cost per pack, line ' + (i + 1)" />
                      </div></div>
                      <span class="item__sales"><span class="cap">Line sales</span>{{ num(lineSales(l)) }}</span>
                      <button appBtn type="button" size="sm" variant="ghost" icon="x" [attr.aria-label]="'Remove line ' + (i + 1)" (click)="removeLine(i)"></button>
                    </div>
                  }
                  <span class="items__note">Price and cost start from the SKU set-up on Pricing & Margins; change them per invoice. Bundles use the SKU's packs per bundle.</span>
                </div>
              </section>

              <section class="block">
                <header><h3>Commercial adjustments & taxes</h3></header>
                <div class="grid-4">
                  <app-field [label]="'Invoice discount (' + cur() + ')'"><app-money-input formControlName="discount" currency="" /></app-field>
                  <app-field label="Sales tax %" hint="Set according to applicable tax law"><app-money-input formControlName="salesTaxPct" currency="" [decimals]="2" [max]="100" /></app-field>
                  <app-field label="Expected withholding tax %" hint="Information only. Applied when a certificate is received">
                    <app-money-input formControlName="whtPct" currency="" [decimals]="2" [max]="100" />
                  </app-field>
                </div>
              </section>

              <section class="block" formGroupName="sellerCosts">
                <header><h3>Seller-borne costs (PKR)</h3><p>These reduce the contribution margin. Do not include costs already in the unit cost.</p></header>
                <div class="grid-4">
                  @for (c of costs; track c[0]) {
                    <app-field [label]="c[1]"><app-money-input [formControlName]="c[0]" currency="" /></app-field>
                  }
                </div>
              </section>

              <section class="block">
                <header><h3>Profitability check</h3><p>In PKR at the invoice rate. An estimate: only the invoice total and sales tax post.</p></header>
                <div class="profit">
                  <div><span>Net sales</span><strong>{{ money(calc().netPkr) }}</strong></div>
                  <div><span>Sales tax</span><strong>{{ money(calc().taxPkr) }}</strong></div>
                  <div><span>Invoice total</span><strong>{{ money(calc().totalPkr) }}</strong></div>
                  <div><span>Cost of goods</span><strong>{{ money(calc().cogs) }}</strong></div>
                  <div><span>Seller costs</span><strong>{{ money(calc().costs) }}</strong></div>
                  <div [attr.data-bad]="calc().margin < 0 ? '' : null"><span>Contribution margin</span><strong>{{ money(calc().margin) }} · {{ calc().marginPct }}%</strong></div>
                  <div><span>Expected withholding</span><strong>{{ money(calc().wht) }}</strong></div>
                </div>
              </section>
            </div>
          }
        }
      </form>
      <ng-container offcanvasFooter>
        <span class="foot-status">
          <app-tag [tone]="doc()?.status === 'Draft' || !doc() ? 'neutral' : 'success'">{{ doc() ? doc()!.status : 'Draft' }}</app-tag>
          Due {{ cur() }} {{ num(calc().total) }}
        </span>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        @if (!doc() || doc()!.status === 'Draft') {
          <button appBtn type="button" [loading]="busy() && draft()" [disabled]="busy()" (click)="saveDraft()">Save draft</button>
        }
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy() && !draft()" [disabled]="busy()">
          {{ doc() && doc()!.status !== 'Draft' ? 'Save invoice' : 'Issue invoice' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class IncomeInvoiceForm extends FormModal {
  readonly doc = input<AccountingDoc | null>(null);
  readonly categories = input<string[]>([]);
  readonly currencies = input<Currency[]>([]);
  readonly formId = 'form-income-invoice';
  protected money = fmtMoney;
  protected num = (n: number) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  protected uoms = UOMS;
  protected uomLabel = UOM_LABEL;
  protected costs = COSTS;
  protected steps: TabItem[] = [
    { id: 'details', label: '01 · Invoice details' },
    { id: 'items', label: '02 · Items & profit' },
  ];
  protected step = signal('details');
  /** the last button was Save draft */
  protected draft = signal(false);

  private fin = inject(FinanceApi);
  private ops = inject(OpsApi);
  private store = inject(SettingsStore);
  private nfb = inject(NonNullableFormBuilder);
  protected bankAccounts = this.store.bankAccounts;
  protected deliveryStatuses = computed(() => this.store.options('DELIVERY_STATUS'));
  protected cycles = computed(() => this.store.settings()?.paymentCycles ?? [15, 30, 45, 60]);
  private productsRes = rxResource({ params: () => this.open() || null, stream: () => this.ops.products() });
  protected products = computed(() => (this.productsRes.value() ?? []).filter((p) => p.active || this.lines.controls.some((l) => l.controls.productId.value === p.id)));

  readonly form = this.nfb.group({
    category: ['', Validators.required],
    invoiceNo: [''],
    date: [today(), Validators.required],
    party: ['', Validators.required],
    customerTaxId: [''],
    region: [''],
    currency: ['PKR'],
    fxRate: [1, [Validators.required, Validators.min(0.000001)]],
    paymentDays: [30],
    dueDate: [today(), Validators.required],
    receivingAccount: [''],
    orderRef: [''],
    deliveryStatus: [''],
    deliveryProof: [''],
    salesOwner: [''],
    note: [''],
    lines: this.nfb.array<LineForm>([]),
    discount: [0, Validators.min(0)],
    salesTaxPct: [0],
    whtPct: [0],
    sellerCosts: this.nfb.group({ freight: [0], insurance: [0], customs: [0], packaging: [0], other: [0] }),
  });

  protected get lines() {
    return this.form.controls.lines;
  }

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected cur = computed(() => this.value().currency ?? 'PKR');

  /** every number of the invoice: in its currency, and in PKR for the profit check */
  protected calc = computed(() => {
    const v = this.form.getRawValue();
    this.value();
    const fx = Number(v.fxRate) || 0;
    const subtotal = round2(this.lines.controls.reduce((n, l) => n + this.lineSales(l), 0));
    const net = round2(subtotal - (Number(v.discount) || 0));
    const tax = round2((net * (Number(v.salesTaxPct) || 0)) / 100);
    const total = round2(net + tax);
    const netPkr = round2(net * fx);
    const cogs = round2(this.lines.controls.reduce((n, l) => n + this.packsOf(l) * (Number(l.controls.unitCost.value) || 0), 0));
    const costs = round2(Object.values(v.sellerCosts).reduce((n, x) => n + (Number(x) || 0), 0));
    const margin = round2(netPkr - cogs - costs);
    return {
      subtotal, net, tax, total, netPkr, taxPkr: round2(tax * fx), totalPkr: round2(total * fx), cogs, costs, margin,
      marginPct: netPkr > 0 ? Math.round((margin / netPkr) * 1000) / 10 : 0,
      wht: round2((netPkr * (Number(v.whtPct) || 0)) / 100),
    };
  });

  constructor() {
    super();
    // picking a currency fills its rate; PKR is always 1
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      const rate = this.currencies().find((c) => c.code === code)?.rate;
      this.form.controls.fxRate.setValue(code === 'PKR' ? 1 : Number(rate ?? 1));
      this.lockRate();
    });
    // the due date follows the invoice date and the payment terms
    const followTerms = () => {
      const v = this.form.getRawValue();
      if (v.date) this.form.controls.dueDate.setValue(addDays(v.date, Number(v.paymentDays) || 0));
    };
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(followTerms);
    this.form.controls.paymentDays.valueChanges.pipe(takeUntilDestroyed()).subscribe(followTerms);
  }

  private lockRate() {
    if (this.form.controls.currency.value === 'PKR') this.form.controls.fxRate.disable({ emitEvent: false });
    else this.form.controls.fxRate.enable({ emitEvent: false });
  }

  protected reset() {
    const d = this.doc();
    this.step.set('details');
    this.draft.set(false);
    this.lines.clear({ emitEvent: false });
    const days = d?.paymentDays ?? 30;
    this.form.reset({
      category: d?.category ?? this.categories()[0] ?? '', invoiceNo: d?.invoiceNo && d.invoiceNo !== d.refNo ? d.invoiceNo : '',
      date: d?.date ?? today(), party: d?.party ?? '', customerTaxId: d?.customerTaxId ?? '', region: d?.region ?? '',
      currency: d?.currency ?? 'PKR', fxRate: Number(d?.fxRate ?? 1), paymentDays: days, dueDate: d?.dueDate ?? addDays(today(), days),
      receivingAccount: d?.receivingAccount ?? '', orderRef: d?.orderRef ?? '', deliveryStatus: d?.deliveryStatus ?? this.deliveryStatuses()[0] ?? '',
      deliveryProof: d?.deliveryProof ?? '', salesOwner: d?.salesOwner ?? '', note: d?.note ?? '',
      discount: Number(d?.discount ?? 0), salesTaxPct: Number(d?.salesTaxPct ?? 0), whtPct: Number(d?.whtPct ?? 0),
      sellerCosts: { freight: 0, insurance: 0, customs: 0, packaging: 0, other: 0, ...(d?.sellerCosts ?? {}) },
    }, { emitEvent: false });
    for (const l of d?.lines ?? []) this.lines.push(lineGroup(this.nfb, l), { emitEvent: false });
    if (!this.lines.length) this.lines.push(lineGroup(this.nfb), { emitEvent: false });
    this.lockRate();
    this.form.markAsPristine();
    this.form.updateValueAndValidity();
  }

  // ───────────── SKU lines ─────────────

  private product(l: LineForm): Product | undefined {
    return (this.productsRes.value() ?? []).find((p) => p.id === l.controls.productId.value);
  }

  protected packsOf(l: LineForm): number {
    this.value();
    const p = this.product(l);
    const qty = Number(l.controls.qty.value) || 0;
    const per = l.controls.uom.value === 'Cartons' ? p?.packsPerCarton || this.store.settings()?.packsPerCarton || 1 : l.controls.uom.value === 'Dozens' ? 12 : 1;
    return round2(qty * per);
  }

  protected lineSales(l: LineForm): number {
    return round2(this.packsOf(l) * (Number(l.controls.sellPrice.value) || 0));
  }

  /** a SKU brings its price per pack and its cost per pack from Pricing & Margins */
  protected onProduct(l: LineForm) {
    const p = this.product(l);
    if (!p) return;
    const fx = Number(this.form.controls.fxRate.value) || 1;
    l.controls.sellPrice.setValue(round2(Number(p.rate) / fx));
    l.controls.unitCost.setValue(round2(Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate)));
  }

  protected addLine() {
    this.lines.push(lineGroup(this.nfb));
    this.form.markAsDirty();
  }

  protected removeLine(i: number) {
    this.lines.removeAt(i);
    if (!this.lines.length) this.lines.push(lineGroup(this.nfb));
    this.form.markAsDirty();
  }

  // ───────────── save ─────────────

  protected saveDraft() {
    this.draft.set(true);
    const c = this.form.controls;
    for (const k of ['party', 'category', 'date'] as const) c[k].markAsTouched();
    if (c.party.invalid || c.category.invalid || c.date.invalid) {
      this.step.set('details');
      this.error.set('A draft needs at least the customer, the category and the invoice date.');
      return;
    }
    this.send();
  }

  protected issue() {
    this.draft.set(false);
    this.form.markAllAsTouched();
    const p = this.problem();
    if (p) {
      this.error.set(p.msg);
      this.step.set(p.step);
      return;
    }
    this.send();
  }

  private problem(): { msg: string; step: string } | null {
    const c = this.form.controls;
    if (c.party.invalid || c.category.invalid || c.date.invalid || c.dueDate.invalid || c.fxRate.invalid) return { msg: 'Fill in the invoice details marked with *.', step: 'details' };
    if (c.dueDate.value < c.date.value) return { msg: 'The due date cannot be before the invoice date.', step: 'details' };
    if (this.lines.controls.some((l) => !l.controls.productId.value)) return { msg: 'Choose a SKU on every line, or remove the empty line.', step: 'items' };
    if (this.lines.controls.some((l) => !(Number(l.controls.qty.value) > 0))) return { msg: 'Enter a quantity on every line.', step: 'items' };
    if (this.calc().net < 0) return { msg: 'The discount cannot be more than the invoice lines.', step: 'items' };
    if (!(this.calc().total > 0)) return { msg: 'The invoice total must be above zero.', step: 'items' };
    return null;
  }

  /** FormModal's submit without its own validity check (a draft may be incomplete) */
  private send() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.request().subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(this.successMessage());
        this.open.set(false);
        this.saved.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
      },
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    const draft = this.draft();
    const lines = this.lines.controls
      .filter((l) => l.controls.productId.value && Number(l.controls.qty.value) > 0)
      .map((l) => {
        const x = l.getRawValue();
        return { productId: x.productId, qty: Number(x.qty), uom: x.uom, sellPrice: Number(x.sellPrice) || 0, unitCost: Number(x.unitCost) || 0 };
      });
    const body = {
      kind: 'Income', category: v.category, invoiceNo: v.invoiceNo.trim(), date: v.date, party: v.party.trim(), customerTaxId: v.customerTaxId.trim(),
      region: v.region.trim(), currency: v.currency, fxRate: Number(v.fxRate), paymentDays: Number(v.paymentDays) || 0, dueDate: v.dueDate,
      receivingAccount: v.receivingAccount, orderRef: v.orderRef.trim(), deliveryStatus: v.deliveryStatus, deliveryProof: v.deliveryProof.trim(),
      salesOwner: v.salesOwner.trim(), note: v.note.trim(), lines, discount: Number(v.discount) || 0, salesTaxPct: Number(v.salesTaxPct) || 0,
      whtPct: Number(v.whtPct) || 0, sellerCosts: Object.fromEntries(Object.entries(v.sellerCosts).map(([k, x]) => [k, Number(x) || 0])),
      // a draft without lines still needs an amount; 0 is fine for a draft
      ...(lines.length ? {} : { foreignAmount: 0 }),
      ...(this.doc() && this.doc()!.status !== 'Draft' ? {} : { status: draft ? 'Draft' : 'Issued' }),
    };
    const id = this.doc()?.id ?? null;
    if (id) {
      const { kind: _k, ...patch } = body;
      return this.fin.saveDoc(id, patch);
    }
    return this.fin.saveDoc(null, body);
  }

  protected successMessage() {
    return this.draft() ? 'Draft saved. Nothing is posted until you issue it.' : 'Invoice issued. Collect it from the documents list.';
  }
}
