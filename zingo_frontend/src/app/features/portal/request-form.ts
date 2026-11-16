import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtAmount2 } from '../../shared/format';
import { Btn, Field, Offcanvas, RichText } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { PortalRate } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A distributor orders stock. With no approval step (Settings) it goes straight to the product's manufacturer as a
 * production order; otherwise Zingo reviews it first. Nothing is dispatched by ordering.
 */
@Component({
  selector: 'app-request-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="direct() ? 'Order stock' : 'Request stock'" size="lg" [dirty]="form.dirty"
                   [subtitle]="direct() ? 'The order goes straight to the manufacturer. You are told when it is accepted, ready and dispatched.' : 'Zingo reviews the request first. It is not a confirmed dispatch.'">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Request date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Product" [required]="true" [error]="invalid('productId') ? 'Choose a product' : null"
          [hint]="picked()?.manufacturerName ? 'Made by ' + picked()!.manufacturerName : undefined">
          <select formControlName="productId">
            <option value="">Choose a product</option>
            @for (r of rates(); track r.productId) {
              <option [value]="r.productId" [disabled]="direct() && !r.manufacturerName">{{ r.name }} · {{ r.sku }} · PKR {{ money(r.rate) }}/pack{{ direct() && !r.manufacturerName ? ' (no manufacturer yet)' : '' }}</option>
            }
          </select>
        </app-field>
        <app-field label="Bundles" [required]="true" [error]="invalid('cartons') ? 'Enter a whole number, 1 or more' : null">
          <input type="number" formControlName="cartons" min="1" step="1" />
        </app-field>
        <app-field label="Delivery wanted by"><input type="date" formControlName="requestedDate" /></app-field>
        <app-field label="Your purchase order no."><input type="text" formControlName="poRef" maxlength="60" /></app-field>
        <app-field label="Notes, route or delivery instruction" [wide]="true"><app-rich-text formControlName="notes" [max]="2000" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()">{{ direct() ? 'Send order to manufacturer' : 'Send request' }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class RequestForm extends FormModal {
  /** the SKUs with this distributor's prices */
  readonly rates = input<PortalRate[]>([]);
  /** staff filing on behalf of a distributor */
  readonly distributorId = input<string | undefined>(undefined);
  /** Settings: no approval step, the order goes straight to the manufacturer */
  readonly direct = input(true);
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

  private productId = toSignal(this.form.controls.productId.valueChanges, { initialValue: '' });
  protected picked = computed(() => this.rates().find((r) => r.productId === this.productId()) ?? null);

  protected reset() {
    const first = this.rates().find((r) => !this.direct() || r.manufacturerName);
    this.form.reset({ date: today(), productId: first?.productId ?? '', cartons: 5, requestedDate: inDays(5), poRef: '', notes: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.portal.createRequest({ ...v, cartons: Number(v.cartons), requestedDate: v.requestedDate || undefined, distributorId: this.distributorId() });
  }

  protected successMessage() {
    return this.direct() ? 'Order sent to the manufacturer.' : 'Request sent. Zingo will review it.';
  }
}
