import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { LookupList, SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtAmount2, fmtNumber } from '../../shared/format';
import { Btn, Field, MoneyInput, MultiSelect, Offcanvas, Select, SelectOption, ToastService } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Manufacturer, PackagingTemplate, Product } from '../ops/models';
import { SettingsApi } from '../settings/settings.api';

/** a value from a select, or keep what the product already has even if it was switched off in Settings */
const withCurrent = (list: string[], current: string | null | undefined): SelectOption<string>[] =>
  [...list, ...(current && !list.includes(current) ? [current] : [])].map((v) => ({ value: v, label: v }));

/**
 * Add or edit a SKU: name, flavour, packet size and grams; its packaging templates (packet -> bundle -> container,
 * one default, picked on each production order); the manufacturer that makes it and the distributors that sell it;
 * its per-packet rates with the cost and margin worked out per packet, bundle and container.
 * Flavours and packet sizes come from Settings & Data; an Admin can add a new one right here.
 */
@Component({
  selector: 'app-product-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn, Select, MultiSelect],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="product() ? 'Edit product / SKU' : 'Add product / SKU'"
               subtitle="Rates are per packet, in PKR." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" novalidate class="sections">
        <section class="block">
          <header><h3>Product</h3><p>What it is. Flavours and packet sizes are lists in Settings &amp; Data.</p></header>
          <div class="form-grid">
            <app-field label="SKU code" [required]="true" [error]="invalid('sku') ? 'Enter the SKU code' : null" hint="Unique; letter case does not matter">
              <input type="text" formControlName="sku" placeholder="Z10-MAS" />
            </app-field>
            <app-field label="Product name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
              <input type="text" formControlName="name" placeholder="Masala Masti" />
            </app-field>
            <app-field label="Availability">
              <select formControlName="active"><option value="true">Active</option><option value="false">Inactive</option></select>
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
              <textarea formControlName="description" rows="2" maxlength="2000" placeholder="Taste, ingredients, target buyer"></textarea>
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Packaging templates</h3><p>Snack packet → bundle → container. Save several; one is the default, and each production order picks one.</p></header>
          <div class="templates" formArrayName="packagings">
            @for (g of templates.controls; track g; let i = $index) {
              <div class="tpl" [formGroupName]="i">
                <app-field label="Name" [required]="true"><input type="text" formControlName="name" maxlength="60" /></app-field>
                <app-field label="Packets per bundle" [required]="true"><input type="number" formControlName="packetsPerBundle" min="1" step="1" /></app-field>
                <app-field label="Bundles per container" [required]="true"><input type="number" formControlName="bundlesPerContainer" min="1" step="1" /></app-field>
                <span class="tpl__total">{{ num(perContainerOf(i)) }} packets / container</span>
                <label class="tpl__default"><input type="radio" name="tpl-default" [checked]="g.value.isDefault" (change)="makeDefault(i)" /> Default</label>
                <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="removeTemplate(i)" [disabled]="templates.length === 1"
                        [attr.aria-label]="'Remove packaging template ' + (i + 1)"></button>
              </div>
            }
            <div><button appBtn type="button" size="sm" icon="plus" (click)="addTemplate()">Add packaging template</button></div>
          </div>
        </section>

        <section class="block">
          <header><h3>Partners</h3><p>Who makes it and who sells it. Sell-out days: how long a distributor has to sell one container (0 = no limit).</p></header>
          <div class="form-grid">
            <app-field label="Manufacturer" hint="Makes this product">
              <app-select formControlName="manufacturerId" [options]="manufacturerOptions()" placeholder="Choose a manufacturer" />
            </app-field>
            <app-field label="Sell-out days" [hint]="selloutHint()" [error]="invalid('selloutDays') ? '0 to 365 days' : null">
              <input type="number" formControlName="selloutDays" min="0" max="365" step="1" placeholder="Distributor default" />
            </app-field>
            <app-field label="Distributors" [wide]="true" hint="One or more; the first is the default for orders">
              <app-multi-select formControlName="distributorIds" [options]="distributorOptions()" placeholder="Add a distributor" />
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Rates per packet</h3><p>In PKR. Type the price of one packet; the bundle and container figures are worked out below (default packaging).</p></header>
          <div class="form-grid">
            <app-field label="MRP">
              <app-money-input formControlName="mrp" />
            </app-field>
            <app-field label="Distributor price" [required]="true" hint="What the distributor pays Zen Foods">
              <app-money-input formControlName="rate" />
            </app-field>
            <app-field label="Manufacturer rate">
              <app-money-input formControlName="manufacturerRate" />
            </app-field>
            <app-field label="Packaging cost" hint="Only if bought separately">
              <app-money-input formControlName="packagingRate" />
            </app-field>
            <app-field label="Printing cost" hint="Only if bought separately">
              <app-money-input formControlName="printingRate" />
            </app-field>
            <app-field label="Inbound freight" hint="Manufacturer to us">
              <app-money-input formControlName="inboundRate" />
            </app-field>
            <app-field label="Outbound freight" hint="To the distributor">
              <app-money-input formControlName="outboundRate" />
            </app-field>
          </div>
          <table class="prices" aria-label="Costs and margin per packet, bundle and container">
            <thead>
              <tr>
                <th scope="col">PKR</th>
                <th scope="col">Per packet</th>
                <th scope="col">Per bundle<small>{{ num(packetsPerBundle()) }} packets</small></th>
                <th scope="col">Per container<small>{{ num(packetsPerContainer()) }} packets</small></th>
              </tr>
            </thead>
            <tbody>
              @for (r of priceRows(); track r.label) {
                <tr [attr.data-kind]="r.kind">
                  <th scope="row">{{ r.label }}</th>
                  <td>{{ amount2(r.packet) }}</td>
                  <td>{{ amount2(r.packet * packetsPerBundle()) }}</td>
                  <td>{{ amount2(r.packet * packetsPerContainer()) }}</td>
                </tr>
              }
            </tbody>
          </table>
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
    /* the worked-out prices: per packet, bundle and container, read only */
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
      }

      & th:first-child {
        text-align: start;
        font-weight: var(--weight-medium, 500);
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
        background: var(--surface-sunken);
      }
    }

    .templates {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .tpl {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) auto auto auto;
      align-items: end;
      gap: var(--space-2);
      padding-block-end: var(--space-3);
      border-block-end: 1px solid var(--border);

      @media (max-width: 760px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .tpl__total,
    .tpl__default {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      block-size: var(--control-h);
      font-size: var(--text-sm);
      white-space: nowrap;
    }

    .tpl__total {
      color: var(--text-3);
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
  private toasts = inject(ToastService);

  readonly product = input<Product | null>(null);
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
    manufacturerId: this.fb.control<string | null>(null),
    distributorIds: this.fb.nonNullable.control<string[]>([]),
    selloutDays: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(365)]),
    manufacturerRate: this.fb.nonNullable.control(4.25, Validators.min(0)),
    packagingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    printingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    inboundRate: this.fb.nonNullable.control(0, Validators.min(0)),
    outboundRate: this.fb.nonNullable.control(0, Validators.min(0)),
    active: this.fb.nonNullable.control('true'),
  });

  protected get templates() {
    return this.form.controls.packagings as FormArray<FormGroup>;
  }

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected flavours = computed(() => withCurrent(this.store.options('FLAVOUR'), this.value().flavour ?? this.product()?.flavour));
  protected sizes = computed(() => withCurrent(this.store.options('PACKET_SIZE'), this.value().packetSize ?? this.product()?.packetSize));
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    this.manufacturers().map((m) => ({ value: m.id, label: m.name, sub: m.poc ?? m.contact ?? undefined })));
  protected distributorOptions = computed<SelectOption<string>[]>(() =>
    this.distributors().map((d) => ({ value: d.id, label: d.name, sub: d.region })));

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
      packetsPerBundle: [t?.packetsPerBundle ?? 432, [Validators.required, Validators.min(1)]],
      bundlesPerContainer: [t?.bundlesPerContainer ?? 10, [Validators.required, Validators.min(1)]],
      isDefault: [t?.isDefault ?? false],
    });
  }

  protected addTemplate() {
    const d = this.defaultTemplate();
    this.templates.push(this.templateGroup({ name: `Template ${this.templates.length + 1}`, packetsPerBundle: d.packetsPerBundle, bundlesPerContainer: d.bundlesPerContainer }));
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

  private defaultTemplate = computed(() => {
    const list = (this.value().packagings ?? []) as Partial<PackagingTemplate>[];
    const d = list.find((t) => t.isDefault) ?? list[0];
    return { packetsPerBundle: Number(d?.packetsPerBundle || 0), bundlesPerContainer: Number(d?.bundlesPerContainer || 0) };
  });
  protected perContainerOf = (i: number) => {
    const t = ((this.value().packagings ?? [])[i] ?? {}) as Partial<PackagingTemplate>;
    return Number(t.packetsPerBundle || 0) * Number(t.bundlesPerContainer || 0);
  };

  /** packets in one bundle and in one container of the default template, as typed */
  protected packetsPerBundle = computed(() => this.defaultTemplate().packetsPerBundle);
  protected packetsPerContainer = computed(() => this.packetsPerBundle() * this.defaultTemplate().bundlesPerContainer);

  /**
   * The client's margin check, per packet: MRP less every cost (the manufacturer's rate, the distributor's share
   * of the MRP, printing, packaging, inbound and outbound freight). Display only; nothing extra is stored.
   */
  protected priceRows = computed(() => {
    const v = this.value();
    const n = (x: unknown) => Number(x || 0);
    const mrp = n(v.mrp);
    const costs = [
      { label: 'Manufacturer rate', packet: n(v.manufacturerRate) },
      { label: 'Distributor share (MRP − distributor price)', packet: Math.max(0, mrp - n(v.rate)) },
      { label: 'Printing', packet: n(v.printingRate) },
      { label: 'Packaging', packet: n(v.packagingRate) },
      { label: 'Inbound freight', packet: n(v.inboundRate) },
      { label: 'Outbound freight', packet: n(v.outboundRate) },
    ];
    const total = costs.reduce((s, c) => s + c.packet, 0);
    return [
      { label: 'MRP', packet: mrp, kind: 'price' },
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
    const p = this.product();
    const s = this.store.settings();
    this.adding.set(null);
    this.templates.clear();
    const templates: Partial<PackagingTemplate>[] = p?.packagings?.length
      ? p.packagings
      : [{ name: 'Standard', packetsPerBundle: p?.packsPerCarton ?? s?.packsPerCarton ?? 432, bundlesPerContainer: p?.bundlesPerContainer ?? s?.bundlesPerContainer ?? 10, isDefault: true }];
    for (const t of templates) this.templates.push(this.templateGroup(t));
    this.form.reset(p
      ? {
        sku: p.sku, name: p.name, flavour: p.flavour ?? null, packetSize: p.packetSize ?? null, gramsPerPacket: p.gramsPerPacket ?? null,
        description: p.description ?? '', pack: p.pack, mrp: p.mrp, rate: p.rate, manufacturerId: p.manufacturerId ?? null,
        distributorIds: p.distributorIds?.length ? [...p.distributorIds] : p.distributorId ? [p.distributorId] : [],
        selloutDays: p.selloutDays ?? null, manufacturerRate: p.manufacturerRate, packagingRate: p.packagingRate,
        printingRate: p.printingRate, inboundRate: p.inboundRate, outboundRate: p.outboundRate ?? 0, active: String(p.active),
      }
      : {
        sku: '', name: '', flavour: null, packetSize: null, gramsPerPacket: null, description: '', pack: 10, mrp: 10, rate: 6.25,
        manufacturerId: this.manufacturers().length === 1 ? this.manufacturers()[0].id : null, distributorIds: [], selloutDays: null,
        manufacturerRate: 4.25, packagingRate: 0, printingRate: 0, inboundRate: 0, outboundRate: 0, active: 'true',
      });
    // reset() above sets the template rows back to their first values; put them back
    templates.forEach((t, i) => this.templates.at(i).reset({ ...t, isDefault: !!t.isDefault }));
  }

  protected request() {
    const v = this.form.getRawValue();
    const days = v.selloutDays === null || (v.selloutDays as unknown) === '' ? null : Number(v.selloutDays);
    const grams = v.gramsPerPacket === null || (v.gramsPerPacket as unknown) === '' ? null : Number(v.gramsPerPacket);
    return this.api.saveProduct(this.product()?.id ?? null, {
      ...v, sku: v.sku.trim(), name: v.name.trim(), description: v.description.trim() || null,
      selloutDays: days, gramsPerPacket: grams, active: v.active === 'true',
      packagings: (v.packagings as PackagingTemplate[]).map((t) => ({
        name: t.name.trim(), packetsPerBundle: Number(t.packetsPerBundle), bundlesPerContainer: Number(t.bundlesPerContainer), isDefault: !!t.isDefault,
      })),
      packsPerCarton: Number(this.packetsPerBundle()), bundlesPerContainer: Number(this.defaultTemplate().bundlesPerContainer),
    });
  }

  protected successMessage() {
    return this.product() ? 'SKU updated.' : 'SKU added to the catalogue.';
  }
}
