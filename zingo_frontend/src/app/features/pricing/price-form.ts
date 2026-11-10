import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtAmount2, fmtPct } from '../../shared/format';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Product } from '../ops/models';
import { unitEconomics } from './economics';
import { PricingApi } from './pricing.api';

/**
 * Edit the commercial rates of one SKU (what the factory charges, add-on costs, the distributor price and the MRP).
 * The margin underneath updates as the numbers are typed. Orders already booked keep the rate they were booked at.
 */
@Component({
  selector: 'app-price-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="lg" [title]="'Edit rates · ' + (product()?.sku ?? '')"
               subtitle="Every rate is per pack, in PKR. Booked sales keep the rate they were booked at.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Factory purchase rate"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="manufacturerRate" min="0" step="0.01" /></span></app-field>
        <app-field label="Packaging cost" hint="Only if billed separately"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="packagingRate" min="0" step="0.01" /></span></app-field>
        <app-field label="Printing cost" hint="Only if billed separately"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="printingRate" min="0" step="0.01" /></span></app-field>
        <app-field label="Inbound freight"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="inboundRate" min="0" step="0.01" /></span></app-field>
        <app-field label="Distributor price" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="rate" min="0" step="0.01" /></span></app-field>
        <app-field label="Retail MRP"><span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="mrp" min="0" step="0.01" /></span></app-field>
      </form>
      <div class="notice">
        <span>
          Landed cost <strong>PKR {{ money(eco().variable) }}</strong> ·
          Gross <strong>PKR {{ money(eco().gross) }}</strong> ({{ pct(eco().grossPct) }}) ·
          After {{ money(overhead()) }} overhead <strong>PKR {{ money(eco().net) }}</strong> ({{ pct(eco().netPct) }})
        </span>
      </div>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Update rates</button>
      </ng-container>
    </app-modal>
  `,
})
export class PriceForm extends FormModal {
  readonly product = input<Product | null>(null);
  /** overhead per pack, used for the live margin */
  readonly overhead = input(0);
  readonly formId = 'form-price';
  protected money = fmtAmount2;
  protected pct = fmtPct;
  private pricing = inject(PricingApi);

  readonly form = this.fb.nonNullable.group({
    manufacturerRate: [0, Validators.min(0)],
    packagingRate: [0, Validators.min(0)],
    printingRate: [0, Validators.min(0)],
    inboundRate: [0, Validators.min(0)],
    rate: [0, [Validators.required, Validators.min(0)]],
    mrp: [0, Validators.min(0)],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected eco = computed(() => unitEconomics(this.value() as Product, this.overhead()));

  protected reset() {
    const p = this.product();
    this.form.reset({
      manufacturerRate: Number(p?.manufacturerRate ?? 0), packagingRate: Number(p?.packagingRate ?? 0),
      printingRate: Number(p?.printingRate ?? 0), inboundRate: Number(p?.inboundRate ?? 0),
      rate: Number(p?.rate ?? 0), mrp: Number(p?.mrp ?? 0),
    });
  }

  protected request() {
    return this.pricing.saveRates(this.product()!.id, this.form.getRawValue());
  }

  protected successMessage() {
    return 'Commercial rates updated. Booked sales rates stay frozen.';
  }
}
