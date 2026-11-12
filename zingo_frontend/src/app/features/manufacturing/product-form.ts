import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtNumber } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Manufacturer, Product } from '../ops/models';

/** a value from a select, or keep what the product already has even if it was switched off in Settings */
const withCurrent = (list: string[], current: string | null | undefined): SelectOption<string>[] =>
  [...list, ...(current && !list.includes(current) ? [current] : [])].map((v) => ({ value: v, label: v }));

/**
 * Add or edit a SKU: one flavour in one packet size, its packaging (packet -> bundle -> container),
 * the manufacturer that makes it, the distributor that sells it (and in how many days), and its rates.
 * Flavours and packet sizes come from Settings & Data.
 */
@Component({
  selector: 'app-product-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn, Select],
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
            <app-field label="SKU code" [required]="true" [error]="invalid('sku') ? 'Enter the SKU code' : null">
              <input type="text" formControlName="sku" placeholder="Z10-MAS" />
            </app-field>
            <app-field label="Product name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
              <input type="text" formControlName="name" placeholder="Masala Masti" />
            </app-field>
            <app-field label="Flavour">
              <app-select formControlName="flavour" [options]="flavours()" placeholder="Choose a flavour" />
            </app-field>
            <app-field label="Packet size">
              <app-select formControlName="packetSize" [options]="sizes()" placeholder="Choose a size" />
            </app-field>
            <app-field label="Retail price tier" hint="Rs printed on the packet" [required]="true">
              <input type="number" formControlName="pack" min="1" step="1" />
            </app-field>
            <app-field label="Availability">
              <select formControlName="active"><option value="true">Active</option><option value="false">Inactive</option></select>
            </app-field>
            <app-field label="Description" wide>
              <textarea formControlName="description" rows="2" maxlength="2000" placeholder="Taste, ingredients, target buyer"></textarea>
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Packaging</h3><p>Snack packet → bundle → container. A container is one batch handed to a distributor.</p></header>
          <div class="form-grid">
            <app-field label="Packets per bundle" [required]="true" [error]="invalid('packsPerCarton') ? 'At least 1' : null">
              <input type="number" formControlName="packsPerCarton" min="1" step="1" />
            </app-field>
            <app-field label="Bundles per container" [required]="true"
                       [error]="invalid('bundlesPerContainer') ? 'At least 1' : null">
              <input type="number" formControlName="bundlesPerContainer" min="1" step="1" />
            </app-field>
            <app-field label="Packets per container">
              <input type="text" [value]="perContainer()" readonly tabindex="-1" />
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Partners</h3><p>Who makes it and who sells it. Sell-out days: how long the distributor has to sell one container.</p></header>
          <div class="form-grid">
            <app-field label="Manufacturer" hint="Makes this product">
              <app-select formControlName="manufacturerId" [options]="manufacturerOptions()" placeholder="Choose a manufacturer" />
            </app-field>
            <app-field label="Distributor" hint="Receives and sells it">
              <app-select formControlName="distributorId" [options]="distributorOptions()" placeholder="Choose a distributor" />
            </app-field>
            <app-field label="Sell-out days" [hint]="selloutHint()" [error]="invalid('selloutDays') ? '1 to 365 days' : null">
              <input type="number" formControlName="selloutDays" min="1" max="365" step="1" placeholder="Distributor default" />
            </app-field>
          </div>
        </section>

        <section class="block">
          <header><h3>Rates per packet</h3><p>In PKR.</p></header>
          <div class="form-grid">
            <app-field label="MRP">
              <app-money-input formControlName="mrp" />
            </app-field>
            <app-field label="Distributor price" [required]="true">
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
            <app-field label="Inbound freight">
              <app-money-input formControlName="inboundRate" />
            </app-field>
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

  readonly product = input<Product | null>(null);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly distributors = input<Distributor[]>([]);
  readonly formId = 'form-product';

  readonly form = this.fb.group({
    sku: this.fb.nonNullable.control('', Validators.required),
    name: this.fb.nonNullable.control('', Validators.required),
    flavour: this.fb.control<string | null>(null),
    packetSize: this.fb.control<string | null>(null),
    description: this.fb.nonNullable.control(''),
    pack: this.fb.nonNullable.control(10, [Validators.required, Validators.min(1)]),
    mrp: this.fb.nonNullable.control(10, Validators.min(0)),
    rate: this.fb.nonNullable.control(6.25, [Validators.required, Validators.min(0)]),
    packsPerCarton: this.fb.nonNullable.control(432, [Validators.required, Validators.min(1)]),
    bundlesPerContainer: this.fb.nonNullable.control(10, [Validators.required, Validators.min(1)]),
    manufacturerId: this.fb.control<string | null>(null),
    distributorId: this.fb.control<string | null>(null),
    selloutDays: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(365)]),
    manufacturerRate: this.fb.nonNullable.control(4.25, Validators.min(0)),
    packagingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    printingRate: this.fb.nonNullable.control(0, Validators.min(0)),
    inboundRate: this.fb.nonNullable.control(0, Validators.min(0)),
    active: this.fb.nonNullable.control('true'),
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected flavours = computed(() => withCurrent(this.store.options('FLAVOUR'), this.product()?.flavour));
  protected sizes = computed(() => withCurrent(this.store.options('PACKET_SIZE'), this.product()?.packetSize));
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    this.manufacturers().map((m) => ({ value: m.id, label: m.name, sub: m.poc ?? m.contact ?? undefined })));
  protected distributorOptions = computed<SelectOption<string>[]>(() =>
    this.distributors().map((d) => ({ value: d.id, label: d.name, sub: d.region })));

  protected perContainer = computed(() => {
    const v = this.value();
    return `${fmtNumber(Number(v.packsPerCarton || 0) * Number(v.bundlesPerContainer || 0))} packets`;
  });
  protected selloutHint = computed(() => {
    const d = this.distributors().find((x) => x.id === this.value().distributorId);
    return d ? `Empty = ${d.name}'s ${d.selloutDays ?? 30} days` : 'Empty = the distributor default';
  });

  protected reset() {
    const p = this.product();
    const s = this.store.settings();
    this.form.reset(p
      ? {
        ...p, description: p.description ?? '', flavour: p.flavour ?? null, packetSize: p.packetSize ?? null,
        bundlesPerContainer: p.bundlesPerContainer ?? 10, manufacturerId: p.manufacturerId ?? null,
        distributorId: p.distributorId ?? null, selloutDays: p.selloutDays ?? null, active: String(p.active),
      }
      : {
        sku: '', name: '', flavour: null, packetSize: null, description: '', pack: 10, mrp: 10, rate: 6.25,
        packsPerCarton: s?.packsPerCarton ?? 432, bundlesPerContainer: s?.bundlesPerContainer ?? 10,
        manufacturerId: this.manufacturers().length === 1 ? this.manufacturers()[0].id : null, distributorId: null, selloutDays: null,
        manufacturerRate: 4.25, packagingRate: 0, printingRate: 0, inboundRate: 0, active: 'true',
      });
  }

  protected request() {
    const v = this.form.getRawValue();
    const days = v.selloutDays === null || (v.selloutDays as unknown) === '' ? null : Number(v.selloutDays);
    return this.api.saveProduct(this.product()?.id ?? null, {
      ...v, sku: v.sku.trim(), name: v.name.trim(), description: v.description.trim() || null,
      selloutDays: days, active: v.active === 'true',
    });
  }

  protected successMessage() {
    return this.product() ? 'SKU updated.' : 'SKU added to the catalogue.';
  }
}
