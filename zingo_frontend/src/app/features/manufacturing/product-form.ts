import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { LookupList, SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtAmount2, fmtNumber } from '../../shared/format';
import { Btn, Field, MoneyInput, MultiSelect, Offcanvas, RefInput, RichText, Select, SelectOption, ToastService } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Manufacturer, PackagingTemplate, Product, ProductMaker } from '../ops/models';
import { PricingApi } from '../pricing/pricing.api';
import { SettingsApi } from '../settings/settings.api';

/** a value from a select, or keep what the product already has even if it was switched off in Settings */
const withCurrent = (list: string[], current: string | null | undefined): SelectOption<string>[] =>
  [...list, ...(current && !list.includes(current) ? [current] : [])].map((v) => ({ value: v, label: v }));

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Add or edit a SKU: name, flavour, packet size and grams; its packaging templates (piece -> packet -> bundle ->
 * container -> truck, one default, picked on each production order); the manufacturers that make it, each with its
 * rate + packaging + printing = total per packet; the distributors that sell it (with their agreed rates); and the
 * rates with the cost and margin worked out per piece, packet, bundle, container and truck.
 * Flavours, packet sizes, container and transport units come from Settings & Data; an Admin can add a flavour or size here.
 */
@Component({
  selector: 'app-product-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn, Select, MultiSelect, RichText, RefInput],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="product() ? 'Edit product / SKU' : copyOf() ? 'Duplicate ' + copyOf()!.sku : 'Add product / SKU'"
               subtitle="Rates are per packet, in PKR." size="xl" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" novalidate class="sections">
        <section class="block">
          <header><h3>Product</h3><p>What it is. Flavours and packet sizes are lists in Settings &amp; Data.</p></header>
          <div class="form-grid">
            <app-field label="SKU code" [required]="true" [error]="invalid('sku') ? 'Enter the SKU code' : null">
              <app-ref-input formControlName="sku" kind="product" [except]="product()?.id" />
            </app-field>
            <app-field label="Product name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
              <input type="text" formControlName="name" placeholder="Masala Masti" />
            </app-field>
            <app-field label="Availability">
              <app-select formControlName="active"><option value="true">Active</option><option value="false">Inactive</option></app-select>
            </app-field>
            <app-field label="Flavour">
              <app-select formControlName="flavour" [options]="flavours()" placeholder="Choose a flavour" />
              @if (canAddToLists()) {
                @if (adding() === 'FLAVOUR') {
                  <div class="add-row">
                    <input type="text" [value]="newEntry()" (input)="newEntry.set($any($event.target).value)" placeholder="New flavour" maxlength="80" aria-label="New flavour" />
                    <button appBtn type="button" size="sm" (click)="addEntry('FLAVOUR')" [loading]="saving()">Add</button>
                    <button appBtn type="button" size="sm" variant="ghost" (click)="adding.set(null)">Cancel</button>
                  </div>
                } @else {
                  <button type="button" class="add-link" (click)="startAdd('FLAVOUR')">+ Add a flavour</button>
                }
              }
            </app-field>
            <app-field label="Packet size">
              <app-select formControlName="packetSize" [options]="sizes()" placeholder="Choose a size" />
              @if (canAddToLists()) {
                @if (adding() === 'PACKET_SIZE') {
                  <div class="add-row">
                    <input type="text" [value]="newEntry()" (input)="newEntry.set($any($event.target).value)" placeholder="New size" maxlength="80" aria-label="New packet size" />
                    <button appBtn type="button" size="sm" (click)="addEntry('PACKET_SIZE')" [loading]="saving()">Add</button>
                    <button appBtn type="button" size="sm" variant="ghost" (click)="adding.set(null)">Cancel</button>
                  </div>
                } @else {
                  <button type="button" class="add-link" (click)="startAdd('PACKET_SIZE')">+ Add a packet size</button>
                }
              }
            </app-field>
            <app-field label="Retail price tier" hint="Rs printed on the packet" [required]="true">
              <input type="number" formControlName="pack" min="1" step="1" />
            </app-field>
            <app-field label="Grams per packet" hint="Weight the price tier buys; helps bargain with the manufacturer">
              <input type="number" formControlName="gramsPerPacket" min="0" step="0.5" placeholder="e.g. 18" />
            </app-field>
            <app-field label="Description" [wide]="true">
              <app-rich-text formControlName="description" [max]="2000" [storeMax]="2000" placeholder="Taste, ingredients, target buyer" />
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Packaging templates</h3><p>Piece → packet → bundle → container (bag / carton / bora) → truck. Save several; one is the default, and each order picks one.</p></header>
          <div class="templates" formArrayName="packagings">
            @for (g of templates.controls; track g; let i = $index) {
              <div class="tpl" [formGroupName]="i">
                <div class="tpl__fields">
                  <app-field label="Name" [required]="true"><input type="text" formControlName="name" maxlength="60" /></app-field>
                  <app-field label="Pieces per packet" [help]="i === 0 ? 'How many pieces are inside one packet. 1 when the packet itself is the piece.' : undefined">
                    <input type="number" formControlName="piecesPerPacket" min="1" step="1" />
                  </app-field>
                  <app-field label="Packets per bundle" [required]="true"><input type="number" formControlName="packetsPerBundle" min="1" step="1" /></app-field>
                  <app-field [label]="'Bundles per ' + unitWord(i)" [required]="true"><input type="number" formControlName="bundlesPerContainer" min="1" step="1" /></app-field>
                  <app-field label="Container is a" [help]="i === 0 ? 'What one container of this packing is called when it is counted: a Carton, Bag or Bora (sack). The list is on Settings & Data.' : undefined">
                    <app-select formControlName="containerUnit">
                      <option value="">Not set</option>
                      @for (u of units(); track u.value) {
                        <option [value]="u.value">{{ u.label }}</option>
                      }
                    </app-select>
                  </app-field>
                  <app-field [label]="unitWord(i) + ' per full load'" hint="Empty = not set">
                    <input type="number" formControlName="containersPerTruck" min="1" step="1" />
                  </app-field>
                  <app-field label="Full load is a" [help]="i === 0 ? 'A Truck or a shipping Container: the full load an order can ask for (half loads come later). The list is on Settings & Data.' : undefined">
                    <app-select formControlName="transportUnit">
                      <option value="">Not set</option>
                      @for (u of trucks(); track u.value) {
                        <option [value]="u.value">{{ u.label }}</option>
                      }
                    </app-select>
                  </app-field>
                </div>
                <div class="tpl__foot">
                  <span class="tpl__total">
                    @for (part of totalsOf(i); track part; let last = $last) {
                      <span [class.info-figure]="last">{{ part }}</span>
                    }
                  </span>
                  <label class="tpl__default"><input type="radio" name="tpl-default" [checked]="g.value.isDefault" (change)="makeDefault(i)" /> Default</label>
                  <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="removeTemplate(i)" [disabled]="templates.length === 1"
                          [attr.aria-label]="'Remove packaging template ' + (i + 1)"></button>
                </div>
              </div>
            }
            <div><button appBtn type="button" size="sm" icon="plus" (click)="addTemplate()">Add packaging template</button></div>
          </div>
        </section>

        <section class="block">
          <header>
            <h3>Manufacturers and rates</h3>
            <p>Each manufacturer has its own rate per packet, plus the packaging and printing it charges. The total is what an order with it is priced at. The default one gets new orders.</p>
          </header>
          <div class="makers" formArrayName="makers">
            @for (g of makerRows.controls; track g; let i = $index) {
              <div class="maker" [formGroupName]="i">
                <app-field label="Manufacturer" [required]="true" [error]="makerInvalid(i) ? 'Choose one, once' : null">
                  <app-select formControlName="manufacturerId" [options]="manufacturerOptions()" placeholder="Choose a manufacturer" [clearable]="false" />
                </app-field>
                <app-field label="Rate / packet" [required]="true"><app-money-input formControlName="rate" /></app-field>
                <app-field label="+ Packaging"><app-money-input formControlName="packagingFee" /></app-field>
                <app-field label="+ Printing"><app-money-input formControlName="printingFee" /></app-field>
                <div class="maker__total" [attr.aria-label]="'Total per packet ' + amount2(makerTotal(i))">
                  <span>= Total / packet</span>
                  <strong>{{ amount2(makerTotal(i)) }}</strong>
                </div>
                <label class="tpl__default"><input type="radio" name="maker-default" [checked]="g.value.isDefault" (change)="makeMakerDefault(i)" /> Default</label>
                <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="removeMaker(i)" [attr.aria-label]="'Remove manufacturer ' + (i + 1)"></button>
              </div>
            } @empty {
              <p class="muted">No manufacturer yet: add the one that makes it.</p>
            }
            <div><button appBtn type="button" size="sm" icon="plus" (click)="addMaker()">Add manufacturer</button></div>
          </div>
        </section>

        <section class="block">
          <header><h3>Distributors</h3><p>Who sells it. Each distributor pays its agreed rate (Pricing &amp; Margins), else the distributor price below. Sell-out days: how long a distributor has to sell one container (0 = no limit).</p></header>
          <div class="form-grid">
            <app-field label="Distributors" [wide]="true" hint="One or more; the first is the default for orders">
              <app-multi-select formControlName="distributorIds" [options]="distributorOptions()" placeholder="Add a distributor" />
            </app-field>
            <app-field label="Sell-out days" [hint]="selloutHint()" [error]="invalid('selloutDays') ? '0 to 365 days' : null">
              <input type="number" formControlName="selloutDays" min="0" max="365" step="1" placeholder="Distributor default" />
            </app-field>
          </div>
          @if (distributorRates().length) {
            <ul class="dist-rates" aria-label="What each distributor pays per packet">
              @for (d of distributorRates(); track d.id) {
                <li><span>{{ d.name }}</span><strong>{{ amount2(d.rate) }}</strong><small>{{ d.agreed ? 'agreed rate' : 'distributor price' }}</small></li>
              }
            </ul>
          }
        </section>

        <section class="block">
          <header><h3>Prices and costs per packet</h3><p>In PKR. Type the price of one packet; the piece, bundle, container and truck figures are worked out below (default packaging).</p></header>
          <div class="form-grid">
            <app-field label="MRP">
              <app-money-input formControlName="mrp" />
            </app-field>
            <app-field label="Distributor price" [required]="true" hint="Standard price a distributor pays, unless it has an agreed rate">
              <app-money-input formControlName="rate" />
            </app-field>
            <app-field label="Packaging bought by us" hint="Only if Zen Foods buys it separately">
              <app-money-input formControlName="packagingRate" />
            </app-field>
            <app-field label="Printing bought by us" hint="Only if Zen Foods buys it separately">
              <app-money-input formControlName="printingRate" />
            </app-field>
            <app-field label="Inbound freight" hint="Manufacturer to us">
              <app-money-input formControlName="inboundRate" />
            </app-field>
            <app-field label="Outbound freight" hint="To the distributor">
              <app-money-input formControlName="outboundRate" />
            </app-field>
          </div>
          <div class="table-wrap">
            <table class="prices" aria-label="Costs and margin per piece, packet, bundle, container and truck">
              <thead>
                <tr>
                  <th scope="col">PKR</th>
                  <th scope="col">Per piece<small>{{ num(piecesPerPacket()) }} / packet</small></th>
                  <th scope="col">Per packet</th>
                  <th scope="col">Per bundle<small>{{ num(packetsPerBundle()) }} packets</small></th>
                  <th scope="col">Per {{ defaultUnit() }}<small>{{ num(packetsPerContainer()) }} packets</small></th>
                  @if (packetsPerTruck()) {
                    <th scope="col">Per {{ defaultTruck() }}<small>{{ num(packetsPerTruck()) }} packets</small></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of priceRows(); track r.label) {
                  <tr [attr.data-kind]="r.kind">
                    <th scope="row">{{ r.label }}</th>
                    <td>{{ amount2(r.packet / piecesPerPacket()) }}</td>
                    <td>{{ amount2(r.packet) }}</td>
                    <td>{{ amount2(r.packet * packetsPerBundle()) }}</td>
                    <td>{{ amount2(r.packet * packetsPerContainer()) }}</td>
                    @if (packetsPerTruck()) {
                      <td>{{ amount2(r.packet * packetsPerTruck()) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ product() ? 'Save product' : 'Add product' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
  styles: `
    .table-wrap {
      overflow-x: auto;
    }

    /* the worked-out prices: per piece, packet, bundle, container and truck, read only */
    .prices {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);

      & th,
      & td {
        padding: var(--space-2) var(--space-2);
        border-block-end: 1px solid var(--border);
        text-align: end;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      & th:first-child {
        text-align: start;
        font-weight: var(--weight-medium, 500);
        white-space: normal;
      }

      & thead th {
        font-size: var(--text-xs);
        color: var(--text-3);
        font-weight: var(--weight-semibold);

        & small {
          display: block;
          font-weight: 400;
        }
      }

      & tr[data-kind='cost'] th {
        padding-inline-start: var(--space-4);
        color: var(--text-2);
      }

      & tr[data-kind='total'] {
        font-weight: var(--weight-semibold);
      }

      & tr[data-kind='margin'] {
        font-weight: var(--weight-semibold);
        background: var(--tone-success-bg);
        color: var(--tone-success-fg);
      }
    }

    .templates,
    .makers {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .tpl {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding-block-end: var(--space-3);
      border-block-end: 1px solid var(--border);
    }

    .tpl__fields {
      display: grid;
      grid-template-columns: minmax(8rem, 1.3fr) repeat(3, minmax(5.5rem, 1fr)) minmax(6.5rem, 1fr) minmax(6rem, 1fr) minmax(7rem, 1fr);
      gap: var(--space-2);

      /* label, control and hint rows shared across the row, so every input lines up */
      & > app-field {
        display: grid;
        grid-row: span 3;
        grid-template-rows: subgrid;
        row-gap: var(--space-2);

        & > :is(.field__label, .field__head) {
          align-self: end;
        }
      }

      @media (max-width: 1100px) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      @media (max-width: 640px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .tpl__foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-4);
    }

    .tpl__total {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      flex: 1;
      font-size: var(--text-sm);
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }

    .tpl__default {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      block-size: var(--control-h);
      font-size: var(--text-sm);
      white-space: nowrap;
    }

    .maker {
      display: grid;
      grid-template-columns: minmax(10rem, 1.6fr) repeat(3, minmax(6rem, 1fr)) minmax(7rem, 1fr) auto auto;
      align-items: end;
      gap: var(--space-2);
      padding-block-end: var(--space-2);
      border-block-end: 1px solid var(--border);

      @media (max-width: 900px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .maker__total {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-block-size: var(--control-h);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--tone-success-line);
      border-radius: var(--radius);
      background: var(--tone-success-bg);
      color: var(--tone-success-fg);

      & span {
        font-size: var(--text-2xs);
      }

      & strong {
        font-size: var(--text-lg);
        font-variant-numeric: tabular-nums;
      }
    }

    .dist-rates {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;

      & li {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-1) var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: var(--text-sm);
      }

      & strong {
        color: var(--tone-success-fg);
        font-variant-numeric: tabular-nums;
      }

      & small {
        color: var(--text-3);
      }
    }

    .muted {
      margin: 0;
      color: var(--text-3);
      font-size: var(--text-sm);
    }

    .add-row {
      display: flex;
      gap: var(--space-2);
      margin-block-start: var(--space-2);

      & input {
        flex: 1;
        min-inline-size: 0;
      }
    }

    .add-link {
      align-self: flex-start;
      margin-block-start: var(--space-1);
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent-text);
      font-size: var(--text-xs);
      cursor: pointer;
    }

    .sections {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
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
  `,
})
export class ProductForm extends FormModal {
  private store = inject(SettingsStore);
  private auth = inject(AuthService);
  private settingsApi = inject(SettingsApi);
  private pricing = inject(PricingApi);
  private toasts = inject(ToastService);

  readonly product = input<Product | null>(null);
  /** a new SKU that starts as a copy of this one (every field, packaging, manufacturers and rates); saved as new */
  readonly copyOf = input<Product | null>(null);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly distributors = input<Distributor[]>([]);
  readonly formId = 'form-product';

  readonly form = this.fb.group({
    sku: this.fb.nonNullable.control('', Validators.required),
    name: this.fb.nonNullable.control('', Validators.required),
    flavour: this.fb.control<string | null>(null),
    packetSize: this.fb.control<string | null>(null),
    gramsPerPacket: this.fb.control<number | null>(null, Validators.min(0)),
    description: this.fb.nonNullable.control(''),
    pack: this.fb.nonNullable.control(10, [Validators.required, Validators.min(1)]),
    mrp: this.fb.nonNullable.control(10, Validators.min(0)),
    rate: this.fb.nonNullable.control(6.25, [Validators.required, Validators.min(0)]),
    packagings: this.fb.array<FormGroup>([]),
    makers: this.fb.array<FormGroup>([]),
    distributorIds: this.fb.nonNullable.control<string[]>([]),
    selloutDays: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(365)]),
    packagingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    printingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    inboundRate: this.fb.nonNullable.control(0, Validators.min(0)),
    outboundRate: this.fb.nonNullable.control(0, Validators.min(0)),
    active: this.fb.nonNullable.control('true'),
  });

  // ───────── manufacturers: rate + packaging + printing = total per packet ─────────
  protected get makerRows() {
    return this.form.controls.makers as FormArray<FormGroup>;
  }

  private makerGroup(m?: Partial<ProductMaker>) {
    return this.fb.group({
      manufacturerId: this.fb.control<string | null>(m?.manufacturerId ?? null, Validators.required),
      rate: this.fb.nonNullable.control(Number(m?.rate ?? 4.25), [Validators.required, Validators.min(0)]),
      packagingFee: this.fb.nonNullable.control(Number(m?.packagingFee ?? 0), Validators.min(0)),
      printingFee: this.fb.nonNullable.control(Number(m?.printingFee ?? 0), Validators.min(0)),
      isDefault: this.fb.nonNullable.control(!!m?.isDefault),
    });
  }

  protected addMaker() {
    const first = !this.makerRows.length;
    const d = this.defaultMaker();
    this.makerRows.push(this.makerGroup({ rate: d?.rate ?? 4.25, isDefault: first }));
    this.form.markAsDirty();
  }

  protected removeMaker(i: number) {
    const wasDefault = this.makerRows.at(i).value.isDefault;
    this.makerRows.removeAt(i);
    if (wasDefault && this.makerRows.length) this.makerRows.at(0).patchValue({ isDefault: true });
    this.form.markAsDirty();
  }

  protected makeMakerDefault(i: number) {
    this.makerRows.controls.forEach((g, j) => g.patchValue({ isDefault: j === i }));
    this.form.markAsDirty();
  }

  /** a row must name a manufacturer, and each one only once */
  protected makerInvalid(i: number) {
    const g = this.makerRows.at(i);
    const id = g.get('manufacturerId')?.value;
    const ids = this.makerRows.controls.map((c) => c.get('manufacturerId')?.value);
    return (g.touched || g.dirty) && (!id || ids.indexOf(id) !== i);
  }

  protected makerTotal = (i: number) => {
    const m = ((this.value().makers ?? [])[i] ?? {}) as Partial<ProductMaker>;
    return r4(Number(m.rate || 0) + Number(m.packagingFee || 0) + Number(m.printingFee || 0));
  };

  private defaultMaker = computed(() => {
    const list = (this.value().makers ?? []) as Partial<ProductMaker>[];
    return list.find((m) => m.isDefault) ?? list[0] ?? null;
  });

  protected get templates() {
    return this.form.controls.packagings as FormArray<FormGroup>;
  }

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected flavours = computed(() => withCurrent(this.store.options('FLAVOUR'), this.value().flavour ?? this.product()?.flavour));
  /** Carton, Bora ... plus any unit a template still uses that was switched off in Settings */
  protected units = computed(() => this.listWithUsed('CONTAINER_UNIT', 'containerUnit'));
  /** Truck, Container 20 ft ... the same way */
  protected trucks = computed(() => this.listWithUsed('TRANSPORT_UNIT', 'transportUnit'));
  private listWithUsed(list: LookupList, key: 'containerUnit' | 'transportUnit') {
    const used = ((this.value().packagings ?? []) as Partial<PackagingTemplate>[]).map((t) => t[key]).filter((u): u is string => !!u);
    const all = this.store.options(list);
    return [...all, ...used.filter((u) => !all.includes(u))].map((u) => ({ value: u, label: u }));
  }
  protected sizes = computed(() => withCurrent(this.store.options('PACKET_SIZE'), this.value().packetSize ?? this.product()?.packetSize));
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    this.manufacturers().map((m) => ({ value: m.id, label: m.name, sub: m.poc ?? m.contact ?? undefined })));
  protected distributorOptions = computed<SelectOption<string>[]>(() =>
    this.distributors().map((d) => ({ value: d.id, label: d.name, sub: d.region })));

  /** the agreed rates of this SKU (staff only), loaded when an existing product opens */
  private agreed = rxResource({
    params: () => (this.open() && this.product()?.id && this.auth.can('admin') ? this.product()!.id : undefined),
    stream: ({ params }) => (params ? this.pricing.agreedRates() : of([])),
  });
  /** what each chosen distributor pays per packet: its agreed rate, else the distributor price */
  protected distributorRates = computed(() => {
    const id = this.product()?.id;
    const rows = (this.agreed.value() ?? []).filter((r) => r.productId === id);
    return (this.value().distributorIds ?? []).map((d) => {
      const a = rows.find((r) => r.distributorId === d);
      return { id: d, name: this.distributors().find((x) => x.id === d)?.name ?? 'Distributor', rate: Number(a?.rate ?? this.value().rate ?? 0), agreed: !!a };
    });
  });

  // ───────── a new flavour or packet size, added to the Settings list from here (Admin only) ─────────
  protected canAddToLists = computed(() => this.auth.can('admin'));
  protected adding = signal<LookupList | null>(null);
  protected newEntry = signal('');
  protected saving = signal(false);

  protected startAdd(list: LookupList) {
    this.newEntry.set('');
    this.adding.set(list);
  }

  protected addEntry(list: LookupList) {
    const code = this.newEntry().trim();
    if (!code) return;
    this.saving.set(true);
    this.settingsApi.addLookup({ list, code }).subscribe({
      next: () => {
        this.saving.set(false);
        this.adding.set(null);
        this.store.reload();
        this.form.patchValue(list === 'FLAVOUR' ? { flavour: code } : { packetSize: code });
        this.form.markAsDirty();
        this.toasts.success(`${code} added to Settings & Data.`);
      },
      error: (err) => {
        this.saving.set(false);
        this.toasts.error(errorText(err));
      },
    });
  }

  // ───────── packaging templates ─────────
  private templateGroup(t?: Partial<PackagingTemplate>) {
    return this.fb.nonNullable.group({
      name: [t?.name ?? '', Validators.required],
      piecesPerPacket: [t?.piecesPerPacket ?? 1, [Validators.required, Validators.min(1)]],
      packetsPerBundle: [t?.packetsPerBundle ?? 432, [Validators.required, Validators.min(1)]],
      bundlesPerContainer: [t?.bundlesPerContainer ?? 10, [Validators.required, Validators.min(1)]],
      containerUnit: [t?.containerUnit ?? ''],
      containersPerTruck: this.fb.control<number | null>(t?.containersPerTruck ?? null, Validators.min(1)),
      transportUnit: [t?.transportUnit ?? ''],
      isDefault: [t?.isDefault ?? false],
    });
  }

  protected addTemplate() {
    const d = this.defaultTemplate();
    this.templates.push(this.templateGroup({
      name: `Template ${this.templates.length + 1}`, piecesPerPacket: d.piecesPerPacket, packetsPerBundle: d.packetsPerBundle,
      bundlesPerContainer: d.bundlesPerContainer, containerUnit: d.containerUnit, containersPerTruck: d.containersPerTruck, transportUnit: d.transportUnit,
    }));
    this.form.markAsDirty();
  }

  protected removeTemplate(i: number) {
    const wasDefault = this.templates.at(i).value.isDefault;
    this.templates.removeAt(i);
    if (wasDefault && this.templates.length) this.templates.at(0).patchValue({ isDefault: true });
    this.form.markAsDirty();
  }

  protected makeDefault(i: number) {
    this.templates.controls.forEach((g, j) => g.patchValue({ isDefault: j === i }));
    this.form.markAsDirty();
  }

  private tplAt = (i: number) => ((this.value().packagings ?? [])[i] ?? {}) as Partial<PackagingTemplate>;
  private defaultTemplate = computed(() => {
    const list = (this.value().packagings ?? []) as Partial<PackagingTemplate>[];
    const d = list.find((t) => t.isDefault) ?? list[0];
    return {
      piecesPerPacket: Math.max(1, Number(d?.piecesPerPacket || 1)), packetsPerBundle: Number(d?.packetsPerBundle || 0),
      bundlesPerContainer: Number(d?.bundlesPerContainer || 0), containerUnit: d?.containerUnit ?? '',
      containersPerTruck: Number(d?.containersPerTruck || 0) || null, transportUnit: d?.transportUnit ?? '',
    };
  });
  /** "Bora" or "container" for template i */
  protected unitWord = (i: number) => this.tplAt(i).containerUnit || 'container';
  /** "12 pieces × 6 packets × 8 bundles = 576 pieces per Bora", "48 packets per Bora", "100 Bora per Truck = 4,800 packets" */
  protected totalsOf = (i: number): string[] => {
    const t = this.tplAt(i);
    const pcs = Math.max(1, Number(t.piecesPerPacket || 1));
    const ppb = Number(t.packetsPerBundle || 0);
    const bpc = Number(t.bundlesPerContainer || 0);
    const unit = t.containerUnit || 'container';
    const packets = ppb * bpc;
    const parts = [
      pcs > 1 ? `${this.num(pcs)} pieces × ${this.num(ppb)} packets × ${this.num(bpc)} bundles = ${this.num(pcs * packets)} pieces per ${unit}` : null,
      `${this.num(ppb)} packets × ${this.num(bpc)} bundles = ${this.num(packets)} packets per ${unit}`,
    ];
    const per = Number(t.containersPerTruck || 0);
    if (per) parts.push(`${this.num(per)} ${unit} per ${t.transportUnit || 'full load'} = ${this.num(per * packets)} packets`);
    return parts.filter((x): x is string => !!x);
  };

  /** the default template's figures, as typed */
  protected piecesPerPacket = computed(() => this.defaultTemplate().piecesPerPacket);
  protected packetsPerBundle = computed(() => this.defaultTemplate().packetsPerBundle);
  protected packetsPerContainer = computed(() => this.packetsPerBundle() * this.defaultTemplate().bundlesPerContainer);
  protected packetsPerTruck = computed(() => this.packetsPerContainer() * (this.defaultTemplate().containersPerTruck ?? 0));
  protected defaultUnit = computed(() => this.defaultTemplate().containerUnit || 'container');
  protected defaultTruck = computed(() => this.defaultTemplate().transportUnit || 'full load');

  /**
   * The client's margin check, per packet: MRP less every cost (the default manufacturer's total, the distributor's
   * share of the MRP, packaging and printing bought separately, inbound and outbound freight). Display only.
   */
  protected priceRows = computed(() => {
    const v = this.value();
    const n = (x: unknown) => Number(x || 0);
    const mrp = n(v.mrp);
    const d = this.defaultMaker();
    const maker = d ? n(d.rate) + n(d.packagingFee) + n(d.printingFee) : 0;
    const costs = [
      { label: 'Manufacturer total (rate + packaging + printing)', packet: maker },
      { label: 'Distributor share (MRP − distributor price)', packet: Math.max(0, mrp - n(v.rate)) },
      { label: 'Packaging bought by us', packet: n(v.packagingRate) },
      { label: 'Printing bought by us', packet: n(v.printingRate) },
      { label: 'Inbound freight', packet: n(v.inboundRate) },
      { label: 'Outbound freight', packet: n(v.outboundRate) },
    ].filter((c, i) => i < 2 || c.packet);
    const total = costs.reduce((s, c) => s + c.packet, 0);
    return [
      { label: 'MRP', packet: mrp, kind: 'price' },
      { label: 'Distributor price', packet: n(v.rate), kind: 'price' },
      ...costs.map((c) => ({ ...c, kind: 'cost' })),
      { label: 'Total cost', packet: total, kind: 'total' },
      { label: 'Margin (MRP − total cost)', packet: mrp - total, kind: 'margin' },
    ];
  });
  protected amount2 = fmtAmount2;
  protected num = fmtNumber;
  protected selloutHint = computed(() => {
    const first = this.value().distributorIds?.[0];
    const d = this.distributors().find((x) => x.id === first);
    return d ? `Empty = ${d.name}'s ${d.selloutDays ? d.selloutDays + ' days' : 'no limit'}. 0 = no limit` : 'Empty = the distributor default. 0 = no limit';
  });

  protected reset() {
    const p = this.product() ?? this.copyOf();
    const s = this.store.settings();
    this.adding.set(null);
    this.templates.clear();
    // a template saved before units moved onto templates takes the product's unit
    const firstUnit = p?.containerUnit ?? this.store.options('CONTAINER_UNIT')[0] ?? '';
    const templates: Partial<PackagingTemplate>[] = p?.packagings?.length
      ? p.packagings.map((t) => ({ ...t, containerUnit: t.containerUnit ?? firstUnit }))
      : [{ name: 'Standard', piecesPerPacket: 1, packetsPerBundle: p?.packsPerCarton ?? s?.packsPerCarton ?? 432, bundlesPerContainer: p?.bundlesPerContainer ?? s?.bundlesPerContainer ?? 10, containerUnit: firstUnit, isDefault: true }];
    for (const t of templates) this.templates.push(this.templateGroup(t));
    // the manufacturers: the saved list, else the one default manufacturer, else (new SKU, one manufacturer) that one
    const makers: Partial<ProductMaker>[] = p?.makers?.length
      ? p.makers
      : p?.manufacturerId ? [{ manufacturerId: p.manufacturerId, rate: p.manufacturerRate, isDefault: true }]
        : !p && this.manufacturers().length === 1 ? [{ manufacturerId: this.manufacturers()[0].id, rate: 4.25, isDefault: true }] : [];
    this.makerRows.clear();
    for (const m of makers) this.makerRows.push(this.makerGroup(m));
    this.form.reset(p
      ? {
        sku: p.sku, name: p.name, flavour: p.flavour ?? null, packetSize: p.packetSize ?? null, gramsPerPacket: p.gramsPerPacket ?? null,
        description: p.description ?? '', pack: p.pack, mrp: p.mrp, rate: p.rate,
        distributorIds: p.distributorIds?.length ? [...p.distributorIds] : p.distributorId ? [p.distributorId] : [],
        selloutDays: p.selloutDays ?? null, packagingRate: p.packagingRate,
        printingRate: p.printingRate, inboundRate: p.inboundRate, outboundRate: p.outboundRate ?? 0, active: String(p.active),
      }
      : {
        sku: '', name: '', flavour: null, packetSize: null, gramsPerPacket: null, description: '', pack: 10, mrp: 10, rate: 6.25,
        distributorIds: [], selloutDays: null, packagingRate: 0, printingRate: 0, inboundRate: 0, outboundRate: 0, active: 'true',
      });
    // reset() above sets the rows back to their first values; put them back
    templates.forEach((t, i) => this.templates.at(i).reset({ ...this.templateGroup(t).getRawValue(), isDefault: !!t.isDefault }));
    makers.forEach((m, i) => this.makerRows.at(i).reset(this.makerGroup(m).getRawValue()));
    // a duplicate needs its own SKU code: suggest one, the person changes it
    const c = !this.product() ? this.copyOf() : null;
    if (c) {
      this.form.patchValue({ sku: `${c.sku}-COPY`, name: `${c.name} (copy)` });
      this.form.markAsDirty();
    }
  }

  protected override submit() {
    const ids = this.makerRows.controls.map((c) => c.get('manufacturerId')?.value);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      this.makerRows.controls.forEach((c) => c.markAsTouched());
      this.error.set('Choose each manufacturer once.');
      return;
    }
    super.submit();
  }

  protected request() {
    const v = this.form.getRawValue();
    const makers = (v.makers as ProductMaker[]).map((m) => ({
      manufacturerId: m.manufacturerId, rate: Number(m.rate), packagingFee: Number(m.packagingFee || 0), printingFee: Number(m.printingFee || 0), isDefault: !!m.isDefault,
    }));
    const days = v.selloutDays === null || (v.selloutDays as unknown) === '' ? null : Number(v.selloutDays);
    const grams = v.gramsPerPacket === null || (v.gramsPerPacket as unknown) === '' ? null : Number(v.gramsPerPacket);
    const { makers: _m, packagings: _p, ...rest } = v;
    return this.api.saveProduct(this.product()?.id ?? null, {
      ...rest, sku: v.sku.trim(), name: v.name.trim(), description: v.description.trim() || null,
      selloutDays: days, gramsPerPacket: grams, active: v.active === 'true',
      packagings: (v.packagings as PackagingTemplate[]).map((t) => ({
        name: t.name.trim(), piecesPerPacket: Math.max(1, Number(t.piecesPerPacket) || 1), packetsPerBundle: Number(t.packetsPerBundle),
        bundlesPerContainer: Number(t.bundlesPerContainer), containerUnit: t.containerUnit || null,
        containersPerTruck: Number(t.containersPerTruck) || null, transportUnit: t.transportUnit || null, isDefault: !!t.isDefault,
      })),
      packsPerCarton: Number(this.packetsPerBundle()), bundlesPerContainer: Number(this.defaultTemplate().bundlesPerContainer),
      makers,
    });
  }

  protected successMessage() {
    return this.product() ? 'SKU updated.' : this.copyOf() ? 'Copy added to the catalogue.' : 'SKU added to the catalogue.';
  }
}
