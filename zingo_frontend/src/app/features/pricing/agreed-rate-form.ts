import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtAmount2 } from '../../shared/format';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Product } from '../ops/models';
import { AgreedRate, PricingApi } from './pricing.api';

/**
 * Agree a price per pack with one distributor for one SKU. Setting it again for the same pair replaces it.
 * New orders for the pair start from this price; booked orders keep theirs.
 */
@Component({
  selector: 'app-agreed-rate-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="rate() ? 'Change agreed rate' : 'Agree a rate'"
               subtitle="The price per pack for one distributor and one SKU." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Distributor" [wide]="true" [required]="true" [error]="invalid('distributorId') ? 'Choose a distributor' : null">
          <select formControlName="distributorId">
            <option value="">Choose a distributor</option>
            @for (d of distributors(); track d.id) {
              <option [value]="d.id">{{ d.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Product / SKU" [wide]="true" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <select formControlName="productId">
            <option value="">Choose a product</option>
            @for (p of products(); track p.id) {
              <option [value]="p.id">{{ p.sku }} · {{ p.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Agreed price per pack" [wide]="true" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null"
                   [hint]="standard() !== null ? 'Standard price is PKR ' + money(standard()!) : ''">
          <app-money-input formControlName="rate" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save agreed rate</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AgreedRateForm extends FormModal {
  /** the agreement being changed (empty = a new one) */
  readonly rate = input<AgreedRate | null>(null);
  readonly distributors = input<Distributor[]>([]);
  readonly products = input<Product[]>([]);
  readonly formId = 'form-agreed-rate';
  protected money = fmtAmount2;
  private pricing = inject(PricingApi);

  readonly form = this.fb.nonNullable.group({
    distributorId: ['', Validators.required],
    productId: ['', Validators.required],
    rate: [0, [Validators.required, Validators.min(0.0001)]],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** the product's standard price, shown as a hint */
  protected standard = computed(() => {
    const p = this.products().find((x) => x.id === this.value().productId);
    return p ? Number(p.rate) : null;
  });

  protected reset() {
    const r = this.rate();
    this.form.reset({ distributorId: r?.distributorId ?? '', productId: r?.productId ?? '', rate: Number(r?.rate ?? 0) });
  }

  protected request() {
    return this.pricing.setRate(this.form.getRawValue());
  }

  protected successMessage() {
    return 'Agreed rate saved. New orders start from it.';
  }
}
