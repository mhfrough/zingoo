import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtAmount2 } from '../../shared/format';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { PortalRate } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A distributor asks for stock. Zingo reviews it before a sales order exists; nothing is dispatched by asking. */
@Component({
  selector: 'app-request-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Request stock" size="lg" [dirty]="form.dirty"
                   subtitle="Zingo reviews the request first. It is not a confirmed dispatch.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Request date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Product" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null">
          <select formControlName="productId">
            <option value="">Choose a product</option>
            @for (r of rates(); track r.productId) {
              <option [value]="r.productId">{{ r.sku }} · {{ r.name }} · PKR {{ money(r.rate) }}/pack</option>
            }
          </select>
        </app-field>
        <app-field label="Bundles" [required]="true" [error]="invalid('cartons') ? 'Enter a whole number, 1 or more' : null">
          <input type="number" formControlName="cartons" min="1" step="1" />
        </app-field>
        <app-field label="Delivery wanted by"><input type="date" formControlName="requestedDate" /></app-field>
        <app-field label="Your purchase order no."><input type="text" formControlName="poRef" maxlength="60" /></app-field>
        <app-field label="Notes, route or delivery instruction" [wide]="true"><textarea formControlName="notes"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()">Send request</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class RequestForm extends FormModal {
  /** the SKUs with this distributor's prices */
  readonly rates = input<PortalRate[]>([]);
  /** staff filing on behalf of a distributor */
  readonly distributorId = input<string | undefined>(undefined);
  readonly formId = 'form-request';
  protected money = fmtAmount2;
  private portal = inject(PortalApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    productId: ['', Validators.required],
    cartons: [5, [Validators.required, Validators.min(1)]],
    requestedDate: [inDays(5)],
    poRef: [''],
    notes: [''],
  });

  protected reset() {
    this.form.reset({ date: today(), productId: this.rates()[0]?.productId ?? '', cartons: 5, requestedDate: inDays(5), poRef: '', notes: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.portal.createRequest({ ...v, cartons: Number(v.cartons), requestedDate: v.requestedDate || undefined, distributorId: this.distributorId() });
  }

  protected successMessage() {
    return 'Request sent. Zingo will review it.';
  }
}
