import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Product } from '../ops/models';

/** Add or edit a SKU: one flavour in one pack tier, with its selling and cost rates. */
@Component({
  selector: 'app-product-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="lg" [title]="product() ? 'Edit product / SKU' : 'Add product / SKU'"
               subtitle="Rates are per pack, in PKR.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="SKU code" [required]="true" [error]="invalid('sku') ? 'Enter the SKU code' : null">
          <input type="text" formControlName="sku" placeholder="Z10-MAS" />
        </app-field>
        <app-field label="Flavour / product name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
          <input type="text" formControlName="name" placeholder="Masala Masti" />
        </app-field>
        <app-field label="Retail price tier" hint="Rs 10 or Rs 20 pack" [required]="true">
          <input type="number" formControlName="pack" min="1" step="1" />
        </app-field>
        <app-field label="Packs per carton" [required]="true">
          <input type="number" formControlName="packsPerCarton" min="1" step="1" />
        </app-field>
        <app-field label="MRP per pack">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="mrp" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Distributor price per pack" [required]="true">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="rate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Factory purchase rate per pack">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="manufacturerRate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Packaging cost per pack" hint="Only if bought separately">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="packagingRate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Printing cost per pack" hint="Only if bought separately">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="printingRate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Inbound freight per pack">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="inboundRate" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Availability">
          <select formControlName="active"><option value="true">Active</option><option value="false">Inactive</option></select>
        </app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ product() ? 'Save product' : 'Add product' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ProductForm extends FormModal {
  readonly product = input<Product | null>(null);
  readonly formId = 'form-product';

  readonly form = this.fb.nonNullable.group({
    sku: ['', Validators.required],
    name: ['', Validators.required],
    pack: [10, [Validators.required, Validators.min(1)]],
    mrp: [10, Validators.min(0)],
    rate: [6.25, [Validators.required, Validators.min(0)]],
    packsPerCarton: [432, [Validators.required, Validators.min(1)]],
    manufacturerRate: [4.25, Validators.min(0)],
    packagingRate: [0, Validators.min(0)],
    printingRate: [0, Validators.min(0)],
    inboundRate: [0, Validators.min(0)],
    active: ['true'],
  });

  protected reset() {
    const p = this.product();
    this.form.reset(p
      ? { ...p, active: String(p.active) }
      : { sku: '', name: '', pack: 10, mrp: 10, rate: 6.25, packsPerCarton: 432, manufacturerRate: 4.25, packagingRate: 0, printingRate: 0, inboundRate: 0, active: 'true' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.api.saveProduct(this.product()?.id ?? null, { ...v, sku: v.sku.trim(), name: v.name.trim(), active: v.active === 'true' });
  }

  protected successMessage() {
    return this.product() ? 'SKU updated.' : 'SKU added to the catalogue.';
  }
}
