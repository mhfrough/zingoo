import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Order } from '../ops/models';

/** Finance / Admin lets a draft order go out although the distributor is over the credit limit. */
@Component({
  selector: 'app-credit-override-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="sm" title="Credit hold override" [subtitle]="order() ? order()!.refNo + ' · ' + order()!.distributor.name : ''">
      @if (order(); as o) {
        <div class="notice" data-tone="warning">
          Projected debt {{ money(o.projectedExposure ?? 0) }} is above the limit of {{ money(o.creditLimit) }}.
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Finance authorisation / reason" [required]="true" [wide]="true"
                   [error]="invalid('reason') ? 'Give a short reason (at least 3 characters)' : null">
          <textarea formControlName="reason" placeholder="Why is this order allowed?"></textarea>
        </app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="shield-check" [loading]="busy()">Override hold</button>
      </ng-container>
    </app-modal>
  `,
})
export class CreditOverrideForm extends FormModal {
  readonly order = input<Order | null>(null);
  readonly formId = 'form-credit-override';
  protected money = fmtMoney;

  readonly form = this.fb.nonNullable.group({ reason: ['', [Validators.required, Validators.minLength(3)]] });

  protected reset() {
    this.form.reset({ reason: '' });
  }

  protected request() {
    return this.api.creditOverride(this.order()!.id, this.form.getRawValue().reason);
  }

  protected successMessage() {
    return 'Credit hold overridden for this order. It can now be dispatched.';
  }
}
