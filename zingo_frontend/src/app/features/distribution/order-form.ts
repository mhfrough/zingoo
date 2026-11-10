import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Order, Product } from '../ops/models';

const today = () => new Date().toISOString().slice(0, 10);

/** Create or edit a draft sales order for a distributor (a dispatched order is locked). */
@Component({
  selector: 'app-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="order() ? 'Edit draft order ' + order()!.refNo : 'New distributor sales order'"
               subtitle="Dispatch it later to reserve stock and create the invoice." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Order date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Distributor" [required]="true" [error]="invalid('distributorId') ? 'Choose a distributor' : null">
          <select formControlName="distributorId">
            <option value="">Choose a distributor...</option>
            @for (d of distributors(); track d.id) {
              <option [value]="d.id">{{ d.name }} · {{ d.region }}</option>
            }
          </select>
        </app-field>
        <app-field label="Product / SKU" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <select formControlName="productId">
            <option value="">Choose a product...</option>
            @for (p of products(); track p.id) {
              <option [value]="p.id">{{ p.sku }} · {{ p.name }} · Rs {{ p.pack }}</option>
            }
          </select>
        </app-field>
        <app-field label="Cartons ordered" [required]="true" [error]="invalid('cartons') ? 'At least 1 carton' : null">
          <input type="number" formControlName="cartons" min="1" step="1" />
        </app-field>
        <app-field label="Rate per pack" hint="Filled from the SKU price; change it for this order if needed" [required]="true">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="rate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Distributor PO number">
          <input type="text" formControlName="poRef" placeholder="Optional" />
        </app-field>
        <app-field label="Notes" [wide]="true"><textarea formControlName="notes" placeholder="Optional"></textarea></app-field>
      </form>
      @if (invoice() > 0) {
        <div class="notice">
          <span>Invoice value <strong>{{ money(invoice()) }}</strong> = {{ cartons() }} cartons × {{ packs() }} packs × PKR {{ rate() }}</span>
        </div>
      }
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ order() ? 'Save draft order' : 'Create draft order' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderForm extends FormModal {
  readonly order = input<Order | null>(null);
  readonly distributors = input<Distributor[]>([]);
  readonly products = input<Product[]>([]);
  readonly formId = 'form-order';
  protected money = fmtMoney;

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    distributorId: ['', Validators.required],
    productId: ['', Validators.required],
    cartons: [0, [Validators.required, Validators.min(1)]],
    rate: [0, [Validators.required, Validators.min(0)]],
    poRef: [''],
    notes: [''],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected cartons = computed(() => Number(this.value().cartons) || 0);
  protected rate = computed(() => Number(this.value().rate) || 0);
  protected packs = computed(() => this.products().find((p) => p.id === this.value().productId)?.packsPerCarton ?? 0);
  protected invoice = computed(() => Math.round(this.cartons() * this.packs() * this.rate() * 100) / 100);

  constructor() {
    super();
    // new order: when a SKU is picked, start from its distributor price
    this.form.controls.productId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      const p = this.products().find((x) => x.id === id);
      if (p && !this.order()) this.form.controls.rate.setValue(Number(p.rate));
    });
  }

  protected reset() {
    const o = this.order();
    this.form.reset(o
      ? { date: o.date, distributorId: o.distributorId, productId: o.productId, cartons: o.cartons, rate: Number(o.rate), poRef: o.poRef ?? '', notes: o.notes ?? '' }
      : { date: today(), distributorId: '', productId: '', cartons: 0, rate: 0, poRef: '', notes: '' });
  }

  protected request() {
    return this.api.saveOrder(this.order()?.id ?? null, this.form.getRawValue());
  }

  protected successMessage() {
    return this.order() ? 'Draft order saved.' : 'Draft order saved. Dispatch it to reserve stock and invoice.';
  }
}
