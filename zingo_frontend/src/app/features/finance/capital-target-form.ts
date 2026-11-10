import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';

/** Change the total capital the business intends to raise (an Admin setting). */
@Component({
  selector: 'app-capital-target-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Capital investment target" subtitle="Used for the progress bar on the Overview." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
        <app-field label="Target amount" [required]="true" [error]="invalid('target') ? 'Enter a valid amount' : null">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="target" min="0" step="10000" /></span>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save target</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CapitalTargetForm extends FormModal {
  /** the current target, to start from */
  readonly current = input(0);
  readonly formId = 'form-capital-target';
  private fin = inject(FinanceApi);

  readonly form = this.fb.nonNullable.group({ target: [0, [Validators.required, Validators.min(0)]] });

  protected reset() {
    this.form.reset({ target: Number(this.current()) });
  }

  protected request() {
    return this.fin.updateSettings({ capitalTarget: Number(this.form.getRawValue().target) });
  }

  protected successMessage() {
    return 'Capital target updated.';
  }
}
