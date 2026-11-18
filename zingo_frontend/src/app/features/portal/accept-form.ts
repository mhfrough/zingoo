import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { DeskRequest } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Staff accept a distributor's stock request. By default it becomes a production order with the product's
 * manufacturer, delivered straight to the distributor, and goes to the manufacturer at once (or stays a draft).
 * With warehouse sales orders switched on in Settings, it can still become a draft sales order instead.
 */
@Component({
  selector: 'app-accept-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Accept request" size="lg" [dirty]="form.dirty"
                   [subtitle]="req() ? req()!.distributor.name + ' · ' + req()!.product.sku + ' · ' + req()!.cartons + ' bundles · ' + money(req()!.value) : ''">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        @if (salesEnabled()) {
          <div class="choice" role="radiogroup" aria-label="What the request becomes">
            <label><input type="radio" formControlName="into" value="Production" /> <span><strong>Production order</strong> · the manufacturer makes it and sends it to the distributor</span></label>
            <label><input type="radio" formControlName="into" value="Sales" /> <span><strong>Sales order</strong> · from the Zen Foods warehouse</span></label>
          </div>
        }
        @if (production()) {
          <div class="notice" style="grid-column: 1 / -1">
            <span>
              @if (req()?.product?.manufacturer?.name; as m) {
                Ordered from <strong>{{ m }}</strong>, delivered to <strong>{{ req()!.distributor.name }}</strong>.
              } @else {
                <strong>{{ req()?.product?.sku }} has no manufacturer.</strong> Assign one in Settings &amp; Data first.
              }
              @if (req()?.containers) {
                {{ fmt(req()!.containers!) }} container{{ req()!.containers === 1 ? '' : 's' }} asked, packed {{ req()!.packetsPerBundle }} packets × {{ perContainer() }} bundles{{ req()!.packaging ? ' (' + req()!.packaging + ')' : '' }}{{ req()!.groupRef ? ' · order ' + req()!.groupRef : '' }}.
              } @else {
                {{ fmt(req()?.cartons ?? 0) }} bundles asked = {{ suggested() }} container{{ suggested() === 1 ? '' : 's' }} of {{ perContainer() }} bundles.
              }
            </span>
          </div>
          <app-field label="Containers" [required]="true" [error]="invalid('containers') ? 'At least 1' : null"
                     [hint]="fmt(bundles()) + ' bundles'">
            <input type="number" formControlName="containers" min="1" step="1" />
          </app-field>
          <app-field label="Due date" [hint]="req()?.requestedDate ? 'Asked for ' + req()!.requestedDate : ''">
            <input type="date" formControlName="dueDate" [min]="minDate" />
          </app-field>
          <app-field label="Note to the manufacturer" [wide]="true"><input type="text" formControlName="note" maxlength="500" /></app-field>
        } @else {
          <div class="notice" style="grid-column: 1 / -1"><span>A draft sales order is created with this price and these terms. The invoice is posted only when it is dispatched.</span></div>
          <app-field label="Price per pack" [required]="true" [error]="invalid('rate') ? 'Enter the price' : null">
            <app-money-input formControlName="rate" />
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
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        @if (production()) {
          <button appBtn type="submit" [attr.form]="formId" icon="check" [loading]="busy() && !sendNow()" (click)="sendNow.set(false)">Accept as draft</button>
          <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy() && sendNow()" (click)="sendNow.set(true)">Accept and send to manufacturer</button>
        } @else {
          <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Create sales order</button>
        }
      </ng-container>
    </app-offcanvas>
  `,
})
export class AcceptForm extends FormModal {
  readonly req = input<DeskRequest | null>(null);
  readonly cycles = input<number[]>([15, 30, 45, 60]);
  readonly defaultTerms = input(30);
  /** warehouse sales orders are switched on in Settings */
  readonly salesEnabled = input(false);
  readonly formId = 'form-accept';
  protected money = fmtMoney;
  protected fmt = fmtNumber;
  protected minDate = today();
  protected sendNow = signal(true);
  private portal = inject(PortalApi);

  readonly form = this.fb.nonNullable.group({
    into: ['Production' as 'Production' | 'Sales'],
    containers: [1, [Validators.required, Validators.min(1)]],
    dueDate: [''],
    rate: [0, [Validators.required, Validators.min(0.01)]],
    terms: ['30'],
    advancePct: [0, [Validators.min(0), Validators.max(100)]],
    note: [''],
  });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected production = computed(() => (this.value().into ?? 'Production') === 'Production');
  protected perContainer = computed(() => {
    const p = this.req()?.product;
    const tpl = p?.packagings?.find((t) => t.isDefault);
    // the packing the distributor asked for on this order wins over the product's default template
    return this.req()?.bundlesPerContainer || tpl?.bundlesPerContainer || p?.bundlesPerContainer || 1;
  });
  protected suggested = computed(() => this.req()?.containers || Math.max(1, Math.ceil((this.req()?.cartons ?? 0) / this.perContainer())));
  protected bundles = computed(() => Number(this.value().containers ?? 0) * this.perContainer());

  constructor() {
    super();
    // only the fields of the chosen path are checked
    this.form.controls.into.valueChanges.pipe(takeUntilDestroyed()).subscribe((into) => {
      const sales = into === 'Sales';
      for (const [name, on] of [['rate', sales], ['containers', !sales]] as const) {
        const c = this.form.controls[name];
        if (on) c.enable({ emitEvent: false });
        else c.disable({ emitEvent: false });
      }
    });
  }

  protected reset() {
    const r = this.req();
    const due = r?.requestedDate && r.requestedDate >= today() ? r.requestedDate : '';
    this.sendNow.set(true);
    this.form.reset({
      into: 'Production', containers: this.suggested(), dueDate: due,
      rate: Number(r?.rate ?? 0), terms: String(this.defaultTerms()), advancePct: 0, note: '',
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    if (this.production()) {
      return this.portal.acceptRequest(this.req()!.id, {
        into: 'Production', containers: Number(v.containers), dueDate: v.dueDate || null, send: this.sendNow(),
        ...(v.note.trim() ? { note: v.note.trim() } : {}),
      });
    }
    return this.portal.acceptRequest(this.req()!.id, { into: 'Sales', rate: Number(v.rate), terms: Number(v.terms), advancePct: Number(v.advancePct), note: v.note || undefined });
  }

  protected successMessage() {
    if (!this.production()) return 'Draft sales order created. Dispatch it from Distribution.';
    return this.sendNow() ? 'Production order sent to the manufacturer. The distributor is told.' : 'Production order saved as a draft. Send it from Manufacturing.';
  }
}
