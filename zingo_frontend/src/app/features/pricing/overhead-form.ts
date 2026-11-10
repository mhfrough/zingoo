import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PricingApi } from './pricing.api';

/** Set the overhead share charged to every pack when judging margin (Admin only, it is a company setting). */
@Component({
  selector: 'app-overhead-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Overhead per pack"
               subtitle="A planning share of central costs charged to every pack. It is not booked as an expense." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Overhead per pack" [wide]="true" [required]="true" [error]="invalid('profitAllocationPerPack') ? 'Enter zero or more' : null">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="profitAllocationPerPack" min="0" step="0.01" /></span>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save overhead</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OverheadForm extends FormModal {
  readonly current = input(0);
  readonly formId = 'form-overhead';
  private pricing = inject(PricingApi);

  readonly form = this.fb.nonNullable.group({
    profitAllocationPerPack: [0, [Validators.required, Validators.min(0)]],
  });

  protected reset() {
    this.form.reset({ profitAllocationPerPack: Number(this.current()) });
  }

  protected request() {
    return this.pricing.updateSettings(this.form.getRawValue());
  }

  protected successMessage() {
    return 'Overhead per pack updated.';
  }
}
