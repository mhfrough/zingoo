import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';

/** Add a new investment cost center (a stream that spending is booked against) with its budget. */
@Component({
  selector: 'app-cost-center-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="sm" title="New investment cost center" subtitle="It appears in the budgets and in every stream list.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
        <app-field label="Cost center name" [required]="true" [error]="invalid('name') ? 'Enter a name' : null">
          <input type="text" formControlName="name" />
        </app-field>
        <app-field label="Budget allocation">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="budget" min="0" step="1000" /></span>
        </app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="plus" [loading]="busy()">Add cost center</button>
      </ng-container>
    </app-modal>
  `,
})
export class CostCenterForm extends FormModal {
  readonly formId = 'form-cost-center';
  private fin = inject(FinanceApi);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    budget: [0, Validators.min(0)],
  });

  protected reset() {
    this.form.reset({ name: '', budget: 0 });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.fin.createCostCenter(v.name.trim(), Number(v.budget));
  }

  protected successMessage() {
    return 'New cost center added to the budgets.';
  }
}
