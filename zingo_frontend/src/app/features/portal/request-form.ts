import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { startWith } from 'rxjs';
import { containersLabel, fmtAmount2, fmtMoney, fmtNumber } from '../../shared/format';
import { AttachmentMeta } from '../../core/attachments.api';
import { Btn, Field, FileInput, Help, MoneyInput, Offcanvas, RefInput, RichText, Select, SelectOption } from '../../ui';
import { ProductForm } from '../manufacturing/product-form';
import { Distributor, Manufacturer } from '../ops/models';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { PortalRate } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** how a line is counted: so many containers, full trucks, or one half truck */
type Load = 'containers' | 'full' | 'half';

interface LineValue {
  productId: string;
  manufacturerId: string;
  packaging: string;
  packetsPerBundle: number;
  bundlesPerContainer: number;
  load: Load;
  containers: number;
  trucks: number;
}

/**
 * A distributor orders stock: several products in one order. Each line picks a product and one of its packaging
 * templates; the template fills packets per bundle and bundles per container, which can be changed for this order
 * only (the template itself stays as it is). With no approval step (Settings) every line goes straight to its
 * product's manufacturer as a production order, all under one order number; otherwise Zingo reviews them first.
 */
@Component({
  selector: 'app-request-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, Select, Help, ProductForm, RefInput, MoneyInput, FileInput],
  styles: `
    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-block-start: var(--space-5);

      & > header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);

        & h3 {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          margin: 0;
          font-size: var(--text-md);
        }

        & p {
          margin: 2px 0 0;
          font-size: var(--text-xs);
          color: var(--text-3);
        }
      }
    }

    .line__grid {
      display: grid;
      grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr));
      gap: var(--space-2) var(--space-3);
      align-items: start;

      & .span-2 {
        grid-column: span 2;
      }

      @media (max-width: 900px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .packing {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      font-size: var(--text-xs);
      color: var(--text-2);

      & span {
        padding: 1px var(--space-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface-sunken);
      }
    }

    .line {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);

      & .line__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-3);
      }

      & .line__sum {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-1) var(--space-3);
        padding-block-start: var(--space-2);
        border-block-start: 1px dashed var(--border);
        font-size: var(--text-sm);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;

        & strong {
          color: var(--tone-success-fg);
        }
      }

      & .changed {
        padding: 1px var(--space-2);
        border-radius: 999px;
        background: var(--tone-warning-bg);
        color: var(--tone-warning-fg);
        font-size: var(--text-xs);
      }
    }

    .total {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-2) var(--space-4);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
      font-variant-numeric: tabular-nums;

      & span {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & strong {
        display: block;
        font-size: var(--text-md);
        color: var(--tone-success-fg);
      }
    }

    .advance-guide {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      font-size: var(--text-sm);
      color: var(--text-2);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="direct() ? 'Order stock' : 'Request stock'" size="xl" [dirty]="form.dirty"
      [subtitle]="direct() ? 'Each product goes straight to its manufacturer. You are told when it is accepted, ready and dispatched.' : 'Zingo reviews the request first. It is not a confirmed dispatch.'"
      help="One order can hold several products. Each product becomes its own production order with the factory that makes it, all under one order number.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="send()" novalidate>
        <div class="form-grid">
          <app-field label="Order no." [required]="true" help="Filled in with the next order number. Change it if you keep your own numbers; it must not be used already.">
            <app-ref-input formControlName="orderNo" kind="distOrder" />
          </app-field>
          <app-field label="Order date" [required]="true"><input type="date" formControlName="date" /></app-field>
          <app-field label="Delivery wanted by" help="The date you need the goods. The manufacturer answers with its own ready date.">
            <input type="date" formControlName="requestedDate" [min]="form.controls.date.value" />
          </app-field>
          <app-field label="Your purchase order no."><input type="text" formControlName="poRef" maxlength="60" /></app-field>
        </div>

        <section class="block">
          <header>
            <div>
              <h3>Products
                <app-help title="Packing" text="A packet goes into a bundle, bundles go into a container (a Carton or a Bora). Pick the product's packaging template; you may change the figures for this order only, the saved template stays as it is." />
              </h3>
              <p>{{ lines.length }} product{{ lines.length === 1 ? '' : 's' }} in this order</p>
            </div>
            @if (canAddSku()) {
              <button appBtn type="button" size="sm" icon="plus" (click)="openSku()">New SKU</button>
            }
          </header>

          <div formArrayName="lines" class="stack">
            @for (g of lines.controls; track g; let i = $index) {
              @let rate = rateOf(i);
              @let tpl = templateOf(i);
              <div class="line" [formGroupName]="i">
                <div class="line__head">
                  <span>Product {{ i + 1 }}</span>
                  @if (lines.length > 1) {
                    <button appBtn type="button" size="sm" variant="ghost" icon="trash" (click)="removeLine(i)" [attr.aria-label]="'Remove product ' + (i + 1)">Remove</button>
                  }
                </div>
                <div class="line__grid">
                  <app-field label="Product" [required]="true" class="span-2" [error]="lineInvalid(i, 'productId') ? 'Choose a product' : null">
                    <app-select formControlName="productId" [options]="optionsFor(i)" placeholder="Choose a product" />
                  </app-field>
                  @if ((rate?.madeBy?.length ?? 0) > 1) {
                    <app-field label="Manufacturer"
                      help="Several factories make this product. The order goes to the one picked here; the default is preselected.">
                      <app-select formControlName="manufacturerId">
                        @for (m of rate!.madeBy!; track m.id) {
                          <option [value]="m.id">{{ m.name }}{{ m.isDefault ? ' (default)' : '' }}</option>
                        }
                      </app-select>
                    </app-field>
                  }
                  <app-field label="Packaging template" [hint]="tpl ? tpl.packetsPerBundle + ' × ' + tpl.bundlesPerContainer + ' saved' : 'No template saved: enter the figures'">
                    <app-select formControlName="packaging" (valueChange)="applyTemplate(i)">
                      @for (t of rate?.packagings ?? []; track t.name) {
                        <option [value]="t.name">{{ t.name }}{{ t.isDefault ? ' (default)' : '' }}</option>
                      } @empty {
                        <option value="">Custom</option>
                      }
                    </app-select>
                  </app-field>
                  <app-field label="Packets per bundle" [required]="true" [error]="lineInvalid(i, 'packetsPerBundle') ? '1 or more' : null">
                    <input type="number" formControlName="packetsPerBundle" min="1" step="1" />
                  </app-field>
                  <app-field [label]="'Bundles per ' + (unitOf(i) || 'container')" [required]="true" [error]="lineInvalid(i, 'bundlesPerContainer') ? '1 or more' : null">
                    <input type="number" formControlName="bundlesPerContainer" min="1" step="1" />
                  </app-field>
                  <app-field label="Load" help="Order a number of containers, or a full or half truck / shipping container when the packaging template says how many fill one.">
                    <app-select formControlName="load">
                      <option value="containers">{{ unitOf(i) || 'Container' }}s</option>
                      @if (tpl?.containersPerTruck) {
                        <option value="full">Full {{ truckOf(i) }}</option>
                        <option value="half">Half {{ truckOf(i) }}</option>
                      }
                    </app-select>
                  </app-field>
                  @switch (g.value.load) {
                    @case ('full') {
                      <app-field [label]="truckOf(i) + 's'" [required]="true" [error]="lineInvalid(i, 'trucks') ? '1 or more' : null">
                        <input type="number" formControlName="trucks" min="1" step="1" />
                      </app-field>
                    }
                    @case ('half') {}
                    @default {
                      <app-field [label]="(unitOf(i) || 'Container') + 's'" [required]="true" [error]="lineInvalid(i, 'containers') ? 'A whole number, 1 or more' : null">
                        <input type="number" formControlName="containers" min="1" step="1" />
                      </app-field>
                    }
                  }
                </div>
                @if (tpl) {
                  <div class="packing" aria-label="Packing of this product (from its template, read only)">
                    <span>Container: {{ tpl.containerUnit || 'not set' }}</span>
                    @if ((tpl.piecesPerPacket ?? 1) > 1) { <span>{{ tpl.piecesPerPacket }} pieces / packet</span> }
                    @if (tpl.containersPerTruck) { <span>Full {{ truckOf(i) }}: {{ num(tpl.containersPerTruck) }} {{ tpl.containerUnit || 'containers' }}</span> }
                  </div>
                }
                @let s = sums()[i];
                @if (s) {
                  <div class="line__sum">
                    <span><strong>{{ unitLabel(s.containers, unitOf(i)) }}</strong></span>
                    <span>{{ num(s.bundles) }} bundles</span>
                    <span>{{ num(s.packets) }} packets</span>
                    @if (rate) { <span>{{ money(s.value) }} at {{ amount(rate.rate) }} / packet</span> }
                    @if (s.changed) { <span class="changed">Packing changed for this order</span> }
                  </div>
                }
              </div>
            }
          </div>
          <div>
            <button appBtn type="button" icon="plus" (click)="addLine()">Add product</button>
          </div>

          <div class="total" aria-live="polite">
            <div><span>Products</span><strong>{{ lines.length }}</strong></div>
            <div><span>Containers</span><strong>{{ num(total().containers) }}</strong></div>
            <div><span>Bundles</span><strong>{{ num(total().bundles) }}</strong></div>
            <div><span>Packets</span><strong>{{ num(total().packets) }}</strong></div>
            <div><span>Order value</span><strong>{{ money(total().value) }}</strong></div>
          </div>
        </section>

        <section class="block">
          <header>
            <div>
              <h3>Advance payment
                <app-help title="Advance payment" text="If you pay part of the order up front, enter what you paid and upload the proof (bank slip or transfer screenshot). Zen Foods checks it against the bank. Leave the amount empty if you pay later." />
              </h3>
              <p>Optional. When you enter an amount, the method, date and proof are required</p>
            </div>
          </header>
          <div class="form-grid">
            @if (advancePct() > 0 && total().value > 0) {
              <div class="advance-guide">
                <span>Your advance guide is {{ advancePct() }}% of {{ money(total().value) }} = <strong class="info-figure">{{ money(guide()) }}</strong></span>
                <button appBtn type="button" size="sm" (click)="useGuide()">Pay {{ money(guide()) }}</button>
              </div>
            }
            <app-field label="Amount paid" [error]="advErr('amount')"><app-money-input formControlName="advAmount" /></app-field>
            <app-field label="Method" [required]="advOn()" [error]="advErr('method')">
              <app-select formControlName="advMethod">
                <option value="">Choose</option>
                @for (m of methods(); track m) {
                  <option [value]="m">{{ m }}</option>
                }
              </app-select>
            </app-field>
            <app-field label="Paid on" [required]="advOn()" [error]="advErr('date')"><input type="date" formControlName="advDate" [max]="today" /></app-field>
            <app-field label="Bank / transfer reference"><input type="text" formControlName="advRef" maxlength="80" /></app-field>
            <app-field label="Proof of payment" [wide]="true" [required]="advOn()" [error]="advErr('proof')" hint="Bank slip or transfer screenshot: picture or PDF, 5 MB at most">
              <app-file-input formControlName="advProof" />
            </app-field>
          </div>
        </section>

        <section class="block">
          <app-field label="Notes, route or delivery instruction" [wide]="true"><app-rich-text formControlName="notes" [max]="2000" /></app-field>
        </section>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()">
          {{ direct() ? (lines.length > 1 ? 'Send ' + lines.length + ' products to the manufacturers' : 'Send order to manufacturer') : 'Send request' }}
        </button>
      </ng-container>
    </app-offcanvas>

    @if (canAddSku()) {
      <app-product-form [(open)]="skuOpen" [manufacturers]="manufacturers()" [distributors]="distributorList()" (saved)="skuAdded.emit()" />
    }
  `,
})
export class RequestForm extends FormModal {
  /** the SKUs with this distributor's prices and packaging templates */
  readonly rates = input<PortalRate[]>([]);
  /** staff filing on behalf of a distributor */
  readonly distributorId = input<string | undefined>(undefined);
  /** Settings: no approval step, the order goes straight to the manufacturer */
  readonly direct = input(true);
  /** Admin: may add a new SKU from here */
  readonly canAddSku = input(false);
  /** a SKU was added: reload the rates */
  readonly skuAdded = output<void>();
  /** the distributor's advance guide, % of the order value */
  readonly advancePct = input(0);
  /** payment methods the distributor may use */
  readonly methods = input<string[]>(['Bank Transfer']);
  protected today = today();
  /** Pay (amount entered): the advance details are checked */
  private tried = signal(false);
  readonly formId = 'form-request';
  private portal = inject(PortalApi);

  protected skuOpen = signal(false);
  protected manufacturers = signal<Manufacturer[]>([]);
  protected distributorList = signal<Distributor[]>([]);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    requestedDate: [inDays(5)],
    poRef: [''],
    orderNo: [''],
    notes: [''],
    lines: this.fb.array<FormGroup>([]),
    advAmount: this.fb.control<number | null>(null),
    advMethod: [''],
    advDate: [today()],
    advRef: [''],
    advProof: this.fb.control<AttachmentMeta | null>(null),
  });

  private formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** an advance amount was entered */
  protected advOn = computed(() => Number(this.formValue().advAmount || 0) > 0);
  /** the advance guide amount: % of the order value */
  protected guide = computed(() => Math.round(this.total().value * this.advancePct()) / 100);
  protected useGuide() {
    this.form.patchValue({ advAmount: this.guide() });
    this.form.markAsDirty();
  }
  /** the message of one advance field, once Send was pressed */
  protected advErr(k: 'amount' | 'method' | 'date' | 'proof'): string | null {
    if (!this.tried() || !this.advOn()) return null;
    const v = this.formValue();
    if (k === 'amount') return Number(v.advAmount) > this.total().value + 0.001 ? 'More than the order value' : null;
    if (k === 'method') return v.advMethod ? null : 'Choose the method';
    if (k === 'date') return v.advDate ? null : 'Enter the date';
    return v.advProof ? null : 'Upload the proof';
  }

  protected get lines() {
    return this.form.controls.lines as FormArray<FormGroup>;
  }

  /** the lines as values, kept current for the sums */
  private lineValues = toSignal(this.form.controls.lines.valueChanges.pipe(startWith([])), { initialValue: [] as unknown[] });

  protected productOptions = computed<SelectOption<string>[]>(() =>
    this.rates().map((r) => ({
      value: r.productId,
      label: `${r.name} · ${r.sku}`,
      sub: [this.direct() && !this.canOrder(r) ? 'No manufacturer yet: cannot be ordered' : null, `PKR ${fmtAmount2(r.rate)} / packet`]
        .filter(Boolean).join(' · '),
      disabled: this.direct() && !this.canOrder(r),
    })));

  /**
   * The product list of one line: a product already on another line of this order is greyed out ("on product 2"),
   * so the same SKU is never ordered twice in one order; add containers on its line instead.
   */
  protected optionsFor(i: number): SelectOption<string>[] {
    this.lineValues();
    const taken = new Map<string, number>();
    this.lines.controls.forEach((g, j) => {
      const id = g.get('productId')?.value;
      if (id && j !== i) taken.set(id, j + 1);
    });
    return this.productOptions().map((o) => {
      const on = taken.get(o.value);
      return on ? { ...o, disabled: true, sub: `Already on product ${on} · add containers there` } : o;
    });
  }

  /** containers, bundles, packets and value per line; `changed` = the packing differs from the template */
  protected sums = computed(() => {
    this.lineValues();
    return this.lines.controls.map((g, i) => {
      const v = g.getRawValue() as LineValue;
      const rate = this.rateOf(i);
      const containers = this.containersOf(i);
      const bundles = containers * Math.max(0, Number(v.bundlesPerContainer) || 0);
      const packets = bundles * Math.max(0, Number(v.packetsPerBundle) || 0);
      const tpl = this.templateOf(i);
      const changed = !!tpl && (Number(v.packetsPerBundle) !== tpl.packetsPerBundle || Number(v.bundlesPerContainer) !== tpl.bundlesPerContainer);
      return v.productId ? { containers, bundles, packets, value: packets * (rate?.rate ?? 0), changed } : null;
    });
  });

  protected total = computed(() =>
    this.sums().reduce((t, s) => (s ? { containers: t.containers + s.containers, bundles: t.bundles + s.bundles, packets: t.packets + s.packets, value: t.value + s.value } : t),
      { containers: 0, bundles: 0, packets: 0, value: 0 }));

  protected num = fmtNumber;
  protected money = fmtMoney;
  protected amount = fmtAmount2;
  protected unitLabel = containersLabel;

  /** Carton, Bora: from the line's packaging template (read only) */
  protected unitOf(i: number): string | null {
    this.lineValues();
    return this.templateOf(i)?.containerUnit || this.rateOf(i)?.containerUnit || null;
  }

  /** Truck, Container 20 ft: the full load of the line's template */
  protected truckOf(i: number): string {
    return this.templateOf(i)?.transportUnit || 'truck';
  }

  /** containers on a line: as typed, full trucks x containers per truck, or half a truck (rounded up) */
  protected containersOf(i: number): number {
    const v = this.lines.at(i)?.getRawValue() as LineValue | undefined;
    if (!v) return 0;
    const per = Number(this.templateOf(i)?.containersPerTruck || 0);
    if (v.load === 'full' && per) return Math.max(0, Number(v.trucks) || 0) * per;
    if (v.load === 'half' && per) return Math.ceil(per / 2);
    return Math.max(0, Number(v.containers) || 0);
  }

  /** a product with a manufacturer set up can be ordered */
  protected canOrder = (r: PortalRate) => r.orderable ?? !!r.manufacturerName;

  protected rateOf(i: number): PortalRate | null {
    this.lineValues();
    const id = this.lines.at(i)?.get('productId')?.value;
    return this.rates().find((r) => r.productId === id) ?? null;
  }

  protected templateOf(i: number) {
    const name = this.lines.at(i)?.get('packaging')?.value;
    return this.rateOf(i)?.packagings?.find((t) => t.name === name) ?? null;
  }

  private lineGroup(productId = '') {
    const g = this.fb.nonNullable.group({
      productId: [productId, Validators.required],
      manufacturerId: [''],
      packaging: [''],
      packetsPerBundle: [1, [Validators.required, Validators.min(1)]],
      bundlesPerContainer: [1, [Validators.required, Validators.min(1)]],
      load: ['containers' as Load],
      containers: [1, [Validators.required, Validators.min(1)]],
      trucks: [1, [Validators.required, Validators.min(1)]],
    });
    // a new product brings its default template (and its figures)
    g.controls.productId.valueChanges.subscribe((id) => this.fillFromProduct(g, id));
    this.fillFromProduct(g, productId);
    return g;
  }

  private fillFromProduct(g: FormGroup, id: string) {
    const r = this.rates().find((x) => x.productId === id);
    const tpl = r?.packagings?.find((t) => t.isDefault) ?? r?.packagings?.[0];
    g.patchValue({
      manufacturerId: r?.madeBy?.find((m) => m.isDefault)?.id ?? r?.madeBy?.[0]?.id ?? '',
      packaging: tpl?.name ?? '',
      load: 'containers',
      packetsPerBundle: tpl?.packetsPerBundle ?? r?.packsPerCarton ?? 1,
      bundlesPerContainer: tpl?.bundlesPerContainer ?? r?.bundlesPerContainer ?? 1,
    }, { emitEvent: true });
  }

  /** picking another template puts its figures back (they can still be changed) */
  protected applyTemplate(i: number) {
    const tpl = this.templateOf(i);
    if (tpl) this.lines.at(i).patchValue({ packetsPerBundle: tpl.packetsPerBundle, bundlesPerContainer: tpl.bundlesPerContainer, ...(tpl.containersPerTruck ? {} : { load: 'containers' }) });
  }

  /** a new line starts on the first product not already in the order */
  protected addLine() {
    const used = new Set(this.lines.controls.map((g) => g.get('productId')?.value).filter(Boolean));
    const next = this.rates().find((r) => !used.has(r.productId) && (!this.direct() || this.canOrder(r)));
    this.lines.push(this.lineGroup(next?.productId ?? ''));
  }

  protected removeLine(i: number) {
    this.lines.removeAt(i);
    this.form.markAsDirty();
  }

  protected lineInvalid(i: number, name: string) {
    const c = this.lines.at(i)?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected openSku() {
    if (!this.manufacturers().length) {
      this.api.manufacturers().subscribe((m) => this.manufacturers.set(m));
      this.api.distributors().subscribe((d) => this.distributorList.set(d));
    }
    this.skuOpen.set(true);
  }

  /** the same product twice would be two production orders of one SKU: ask to merge them instead */
  protected send() {
    const ids = this.lines.controls.map((g) => g.get('productId')?.value).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      this.error.set('A product is on two lines. Put it on one line with more containers.');
      return;
    }
    this.tried.set(true);
    if (this.advOn() && (['amount', 'method', 'date', 'proof'] as const).some((k) => this.advErr(k))) {
      this.error.set('Complete the advance payment: method, date and proof, or clear the amount.');
      return;
    }
    this.submit();
  }

  protected reset() {
    this.lines.clear();
    const first = this.rates().find((r) => !this.direct() || this.canOrder(r));
    this.tried.set(false);
    this.form.reset({
      date: today(), requestedDate: inDays(5), poRef: '', orderNo: '', notes: '',
      advAmount: null, advMethod: this.methods()[0] ?? '', advDate: today(), advRef: '', advProof: null,
    });
    this.lines.push(this.lineGroup(first?.productId ?? ''));
    this.form.markAsPristine();
  }

  protected request() {
    const v = this.form.getRawValue();
    const lines = (v.lines as LineValue[]).map((l, i) => ({
      productId: l.productId, containers: this.containersOf(i), packaging: l.packaging || undefined, manufacturerId: l.manufacturerId || undefined,
      packetsPerBundle: Number(l.packetsPerBundle), bundlesPerContainer: Number(l.bundlesPerContainer),
    }));
    const amount = Number(v.advAmount || 0);
    const advance = amount > 0 && v.advProof
      ? { amount, method: v.advMethod, date: v.advDate, reference: v.advRef.trim() || undefined, proofId: v.advProof.id }
      : undefined;
    return this.portal.createRequest({
      date: v.date, orderNo: v.orderNo.trim() || undefined, requestedDate: v.requestedDate || undefined, poRef: v.poRef.trim() || undefined, notes: v.notes.trim() || undefined,
      lines, advance, distributorId: this.distributorId(),
    });
  }

  protected successMessage() {
    const n = this.lines.length;
    return this.direct()
      ? n > 1 ? `Order sent: ${n} products to their manufacturers.` : 'Order sent to the manufacturer.'
      : 'Request sent. Zingo will review it.';
  }
}
