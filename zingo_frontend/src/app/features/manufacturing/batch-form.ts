import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Batch, Manufacturer, Product, QC_OPTIONS } from '../ops/models';

const today = () => new Date().toISOString().slice(0, 10);

/** Plan or edit a production batch (a released batch is locked). */
@Component({
  selector: 'app-batch-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="batch() ? 'Edit production batch ' + batch()!.refNo : 'New production batch'"
               subtitle="Enter the actual cartons and cost after the run, then release it once QC passes." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Production date" [required]="true">
          <input type="date" formControlName="date" />
        </app-field>
        <app-field label="Product / SKU" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <select formControlName="productId">
            <option value="">Choose a product...</option>
            @for (p of products(); track p.id) {
              <option [value]="p.id">{{ p.sku }} · {{ p.name }} · Rs {{ p.pack }}</option>
            }
          </select>
        </app-field>
        <app-field label="Manufacturer" [required]="true" [error]="invalid('manufacturerId') ? 'Choose the manufacturer' : null">
          <select formControlName="manufacturerId">
            <option value="">Choose a manufacturer...</option>
            @for (m of manufacturers(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Quality control">
          <select formControlName="qc">
            @for (q of qcOptions; track q) {
              <option [value]="q">{{ q }}</option>
            }
          </select>
        </app-field>
        <app-field label="Target cartons" [required]="true" [error]="invalid('targetCartons') ? 'At least 1 carton' : null">
          <input type="number" formControlName="targetCartons" min="1" step="1" />
        </app-field>
        <app-field label="Actual finished cartons" hint="Leave 0 until the run is done">
          <input type="number" formControlName="producedCartons" min="0" step="1" />
        </app-field>
        <app-field label="Actual / accrued batch cost" hint="What the manufacturer charges for the whole batch" [wide]="true">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="cost" min="0" step="0.01" /></span>
        </app-field>
        <app-field label="Production notes" [wide]="true">
          <textarea formControlName="notes" placeholder="Optional"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ batch() ? 'Save batch' : 'Create batch' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class BatchForm extends FormModal {
  readonly batch = input<Batch | null>(null);
  readonly products = input<Product[]>([]);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly formId = 'form-batch';
  protected qcOptions = QC_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    productId: ['', Validators.required],
    manufacturerId: ['', Validators.required],
    targetCartons: [0, [Validators.required, Validators.min(1)]],
    producedCartons: [0, Validators.min(0)],
    cost: [0, Validators.min(0)],
    qc: ['Pending'],
    notes: [''],
  });

  protected reset() {
    const b = this.batch();
    this.form.reset(b
      ? { date: b.date, productId: b.productId, manufacturerId: b.manufacturerId, targetCartons: b.targetCartons, producedCartons: b.producedCartons, cost: b.cost, qc: b.qc, notes: b.notes ?? '' }
      : { date: today(), productId: '', manufacturerId: this.manufacturers()[0]?.id ?? '', targetCartons: 0, producedCartons: 0, cost: 0, qc: 'Pending', notes: '' });
  }

  protected request() {
    return this.api.saveBatch(this.batch()?.id ?? null, this.form.getRawValue());
  }

  protected successMessage() {
    return this.batch() ? 'Batch saved.' : 'Batch created. Release it after QC passes.';
  }
}
