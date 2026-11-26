import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtAmount2, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas, RefInput, RichText, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Manufacturer, Product } from '../ops/models';
import { FactoryApi, ProductionOrder } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Place a production order with a manufacturer: so many containers of one SKU, at a rate per packet, delivered to
 * the product's distributor (or the warehouse) by a date. Manufacturer, distributor, packaging and rate start from
 * the product set-up; the advance % comes from the manufacturer. Save it as a draft or send it at once.
 */
@Component({
  selector: 'app-production-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select, MoneyInput, RichText, RefInput],
  styles: `
    .sum {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
      gap: var(--space-2) var(--space-4);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-sunken);

      & div {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }

      & span {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & strong {
        font-variant-numeric: tabular-nums;
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="order() ? 'Edit order ' + order()!.refNo : 'New production order'"
               subtitle="Containers of one SKU from its manufacturer." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Product" [required]="true" [wide]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <app-select formControlName="productId" [options]="productOptions()" placeholder="Choose a SKU" [clearable]="false" />
        </app-field>
        <app-field label="Order no." [required]="true">
          <app-ref-input formControlName="refNo" kind="production" [except]="order()?.id" />
        </app-field>
        <app-field label="Order date" [required]="true">
          <input type="date" formControlName="date" />
        </app-field>
        @if (templateOptions().length > 1) {
          <app-field label="Packaging" hint="The product's packaging templates">
            <app-select formControlName="packaging">
              @for (t of templateOptions(); track t.value) {
                <option [value]="t.value">{{ t.label }}</option>
              }
            </app-select>
          </app-field>
        }
        <app-field label="Containers" [required]="true" [error]="invalid('containers') ? 'At least 1' : null">
          <input type="number" formControlName="containers" min="1" step="1" />
        </app-field>
        <app-field label="Deliver by" hint="When the containers must arrive">
          <input type="date" formControlName="dueDate" [min]="value().date" />
        </app-field>
        <app-field label="Manufacturer" [required]="true" [error]="invalid('manufacturerId') ? 'Choose a manufacturer' : null">
          <app-select formControlName="manufacturerId" [options]="manufacturerOptions()" placeholder="Choose a manufacturer" [clearable]="false" />
        </app-field>
        <app-field label="Deliver to">
          <app-select formControlName="destination">
            <option value="Distributor">Assigned distributor</option>
            <option value="Warehouse">Zen Foods warehouse (exports)</option>
          </app-select>
        </app-field>
        @if (value().destination === 'Distributor') {
          <app-field label="Distributor" [required]="true" [error]="invalid('distributorId') ? 'Choose a distributor' : null">
            <app-select formControlName="distributorId" [options]="distributorOptions()" placeholder="Choose a distributor" [clearable]="false" />
          </app-field>
        }
        <app-field label="Manufacturer rate per packet (PKR)" hint="Before packaging and printing" [required]="true">
          <app-money-input formControlName="rate" />
        </app-field>
        <div class="formula field--wide" aria-live="polite">
          <span>Rate <strong>{{ amount(value().rate) }}</strong></span>
          <span>+ Packaging <strong>{{ amount(fees().packaging) }}</strong></span>
          <span>+ Printing <strong>{{ amount(fees().printing) }}</strong></span>
          <span class="formula__total">= <strong>{{ amount(total()) }}</strong> per packet</span>
        </div>
        <app-field label="Notes" [wide]="true">
          <app-rich-text formControlName="notes" [max]="2000" [storeMax]="2000" placeholder="Anything the manufacturer should know" />
        </app-field>

        <div class="sum" aria-live="polite">
          <div><span>Bundles</span><strong>{{ num(bundles()) }}</strong></div>
          <div><span>Packets</span><strong>{{ num(packets()) }}</strong></div>
          <div><span>Order value</span><strong>{{ money(orderValue()) }}</strong></div>
          <div><span>Advance {{ advancePct() }}%</span><strong>{{ money(advance()) }}</strong></div>
        </div>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn type="submit" [attr.form]="formId" icon="check" [loading]="busy() && !sendNow()" (click)="sendNow.set(false)">Save draft</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy() && sendNow()" (click)="sendNow.set(true)">
          Send to manufacturer
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ProductionOrderForm extends FormModal {
  private factory = inject(FactoryApi);

  readonly order = input<ProductionOrder | null>(null);
  readonly products = input<Product[]>([]);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly distributors = input<Distributor[]>([]);
  readonly formId = 'form-production-order';

  /** which footer button was pressed */
  protected sendNow = signal(false);

  readonly form = this.fb.group({
    refNo: this.fb.nonNullable.control(''),
    productId: this.fb.control<string | null>(null, Validators.required),
    date: this.fb.nonNullable.control(today(), Validators.required),
    containers: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
    packaging: this.fb.nonNullable.control(''),
    dueDate: this.fb.control<string | null>(null),
    manufacturerId: this.fb.control<string | null>(null, Validators.required),
    destination: this.fb.nonNullable.control<'Distributor' | 'Warehouse'>('Distributor'),
    distributorId: this.fb.control<string | null>(null, Validators.required),
    rate: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0)]),
    notes: this.fb.nonNullable.control(''),
  });

  protected value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected productOptions = computed<SelectOption<string>[]>(() =>
    this.products().filter((p) => p.active || p.id === this.order()?.productId).map((p) => ({
      value: p.id, label: `${p.sku} · ${p.name}`,
      sub: [p.manufacturer?.name ?? 'No manufacturer', p.distributor?.name ?? 'no distributor'].join(' → '),
    })));
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    this.manufacturers().map((m) => ({ value: m.id, label: m.name, sub: `${Number(m.advancePct ?? 0)}% advance` })));
  protected distributorOptions = computed<SelectOption<string>[]>(() =>
    this.distributors().map((d) => ({ value: d.id, label: d.name, sub: d.region })));

  private product = computed(() => this.products().find((p) => p.id === this.value().productId) ?? null);
  /** the chosen product's packaging templates ("Standard · 432 × 10") */
  protected templateOptions = computed(() => (this.product()?.packagings ?? []).map((t) => ({
    value: t.name, label: `${t.name} · ${t.packetsPerBundle} per bundle × ${t.bundlesPerContainer} bundles${t.isDefault ? ' (default)' : ''}`,
  })));
  /** the template the order uses */
  private template = computed(() => {
    const list = this.product()?.packagings ?? [];
    return list.find((t) => t.name === this.value().packaging) ?? list.find((t) => t.isDefault) ?? null;
  });
  /** a saved order keeps its own packaging; a new one uses the product's */
  protected bundles = computed(() => {
    const o = this.order();
    const same = o && o.productId === this.value().productId && (o.packaging ?? '') === (this.value().packaging ?? '');
    const per = same ? o!.bundlesPerContainer : this.template()?.bundlesPerContainer ?? this.product()?.bundlesPerContainer ?? 0;
    return Number(this.value().containers || 0) * per;
  });
  protected packets = computed(() => {
    const o = this.order();
    const same = o && o.productId === this.value().productId && (o.packaging ?? '') === (this.value().packaging ?? '');
    const per = same ? o!.packetsPerBundle : this.template()?.packetsPerBundle ?? this.product()?.packsPerCarton ?? 0;
    return this.bundles() * per;
  });
  /** the packaging and printing the chosen manufacturer charges: the order's own while it keeps its product and maker */
  protected fees = computed(() => {
    const o = this.order();
    const v = this.value();
    if (o && o.productId === v.productId && o.manufacturerId === v.manufacturerId) return { packaging: Number(o.packagingFee ?? 0), printing: Number(o.printingFee ?? 0) };
    const m = (this.product()?.makers ?? []).find((x) => x.manufacturerId === v.manufacturerId);
    return { packaging: Number(m?.packagingFee ?? 0), printing: Number(m?.printingFee ?? 0) };
  });
  /** what the manufacturer is paid per packet */
  protected total = computed(() => Math.round((Number(this.value().rate || 0) + this.fees().packaging + this.fees().printing) * 10000) / 10000);
  protected orderValue = computed(() => Math.round(this.packets() * this.total() * 100) / 100);
  protected advancePct = computed(() => {
    const o = this.order();
    if (o && o.manufacturerId === this.value().manufacturerId) return Number(o.advancePct);
    return Number(this.manufacturers().find((m) => m.id === this.value().manufacturerId)?.advancePct ?? 0);
  });
  protected advance = computed(() => Math.round(this.orderValue() * this.advancePct()) / 100);

  protected num = fmtNumber;
  protected money = fmtMoney;
  protected amount = fmtAmount2;

  constructor() {
    super();
    // a distributor is needed only when the containers go to a distributor
    this.form.controls.destination.valueChanges.pipe(takeUntilDestroyed()).subscribe((d) => {
      const c = this.form.controls.distributorId;
      c.setValidators(d === 'Distributor' ? Validators.required : null);
      c.updateValueAndValidity({ emitEvent: false });
    });
    // picking a product fills in its manufacturer, distributor and rate
    this.form.controls.productId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      const p = this.products().find((x) => x.id === id);
      if (!p || (this.order() && this.order()!.productId === id)) return;
      this.form.patchValue({
        packaging: (p.packagings ?? []).find((t) => t.isDefault)?.name ?? '',
        manufacturerId: p.manufacturerId ?? this.form.controls.manufacturerId.value,
        distributorId: p.distributorId ?? this.form.controls.distributorId.value,
        rate: Number(p.manufacturerRate ?? 0),
      });
    });
    // another manufacturer: its own rate for this SKU
    this.form.controls.manufacturerId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      const o = this.order();
      const p = this.product();
      if (!p || !id || (o && o.productId === p.id && o.manufacturerId === id)) return;
      const m = (p.makers ?? []).find((x) => x.manufacturerId === id);
      if (m) this.form.controls.rate.setValue(Number(m.rate));
    });
  }

  protected reset() {
    const o = this.order();
    this.sendNow.set(false);
    this.form.reset(o
      ? {
        refNo: o.refNo, productId: o.productId, date: o.date, containers: o.containers, packaging: o.packaging ?? '', dueDate: o.dueDate, manufacturerId: o.manufacturerId,
        destination: o.destination, distributorId: o.distributorId, rate: Number(o.baseRate ?? o.rate), notes: o.notes ?? '',
      }
      : {
        refNo: '', productId: null, date: today(), containers: 1, packaging: '', dueDate: null, manufacturerId: null,
        destination: 'Distributor', distributorId: null, rate: 0, notes: '',
      }, { emitEvent: true });
    this.form.controls.distributorId.setValidators(this.form.controls.destination.value === 'Distributor' ? Validators.required : null);
    this.form.controls.distributorId.updateValueAndValidity({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.save(this.order()?.id ?? null, {
      refNo: v.refNo.trim() || undefined, productId: v.productId, date: v.date, containers: Number(v.containers), packaging: v.packaging || null, dueDate: v.dueDate || null,
      manufacturerId: v.manufacturerId, destination: v.destination,
      distributorId: v.destination === 'Distributor' ? v.distributorId : null,
      rate: Number(v.rate), notes: v.notes.trim() || null, send: this.sendNow(),
    });
  }

  protected successMessage() {
    return this.sendNow() ? 'Order sent. The manufacturer sees it in its portal.' : 'Order saved as a draft.';
  }
}
