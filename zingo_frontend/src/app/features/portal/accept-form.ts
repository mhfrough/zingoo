import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { DeskRequest } from './portal.models';

/** Staff turn a request into a draft sales order. The price and the credit days are locked on that order. */
@Component({
  selector: 'app-accept-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Accept request" size="lg" [dirty]="form.dirty"
                   [subtitle]="req() ? req()!.distributor.name + ' · ' + req()!.product.sku + ' · ' + req()!.cartons + ' cartons · ' + money(req()!.value) : ''">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <div class="notice"><span>A draft sales order is created with this price and these terms. The invoice is posted only when it is dispatched.</span></div>
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Price per pack" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null">
          <span class="money-input"><span class="money-input__cur">PKR</span><input type="number" formControlName="rate" min="0.01" step="0.01" /></span>
        </app-field>
        <app-field label="Credit days">
          <select formControlName="terms">
            @for (t of cycles(); track t) {
              <option [value]="t">{{ t }} days</option>
            }
          </select>
        </app-field>
        <app-field label="Suggested advance %"><input type="number" formControlName="advancePct" min="0" max="100" step="0.01" /></app-field>
        <app-field label="Internal note" [wide]="true"><input type="text" formControlName="note" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Create sales order</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AcceptForm extends FormModal {
  readonly req = input<DeskRequest | null>(null);
  readonly cycles = input<number[]>([15, 30, 45, 60]);
  readonly defaultTerms = input(30);
  readonly formId = 'form-accept';
  protected money = fmtMoney;
  private portal = inject(PortalApi);

  readonly form = this.fb.nonNullable.group({
    rate: [0, [Validators.required, Validators.min(0.01)]],
    terms: ['30'],
    advancePct: [0, [Validators.min(0), Validators.max(100)]],
    note: [''],
  });

  protected reset() {
    this.form.reset({ rate: Number(this.req()?.rate ?? 0), terms: String(this.defaultTerms()), advancePct: 0, note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.portal.acceptRequest(this.req()!.id, { rate: Number(v.rate), terms: Number(v.terms), advancePct: Number(v.advancePct), note: v.note || undefined });
  }

  protected successMessage() {
    return 'Draft sales order created. Dispatch it from Distribution.';
  }
}
