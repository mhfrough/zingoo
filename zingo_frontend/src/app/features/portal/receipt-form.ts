import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { ProofFile, readProof } from '../../shared/files';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { PortalOrder } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);
const CONDITIONS = ['Good', 'Damaged', 'Wet', 'Tampered', 'Other'];

/**
 * Proof of delivery. Good + damaged + missing cartons must equal what was shipped; a shortage or damage becomes
 * a claim that Zingo reviews. Attach a photo or PDF if you have one (under 450 KB).
 */
@Component({
  selector: 'app-receipt-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Confirm delivery" size="lg" [dirty]="form.dirty"
                   [subtitle]="order() ? order()!.refNo + ' · ' + order()!.product.sku + ' · ' + order()!.cartons + ' cartons shipped' : ''">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <div class="notice" [attr.data-tone]="balanced() ? null : 'warning'">
        <span>
          Good + damaged + missing = <strong>{{ sum() }}</strong> of {{ order()?.cartons ?? 0 }} shipped.
          @if (claim() > 0) { Claim value <strong>{{ money(claim()) }}</strong>. }
        </span>
      </div>
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Date received" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Good cartons" [required]="true"><input type="number" formControlName="goodCartons" min="0" step="1" /></app-field>
        <app-field label="Damaged cartons"><input type="number" formControlName="damagedCartons" min="0" step="1" /></app-field>
        <app-field label="Missing cartons"><input type="number" formControlName="missingCartons" min="0" step="1" /></app-field>
        <app-field label="Condition">
          <select formControlName="condition">
            @for (c of conditions; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </app-field>
        <app-field label="Delivery challan / vehicle no."><input type="text" formControlName="waybill" maxlength="80" /></app-field>
        <app-field label="Received by"><input type="text" formControlName="receivedBy" maxlength="120" /></app-field>
        <app-field label="What happened" [wide]="true" hint="Needed when anything is damaged or missing"><textarea formControlName="reason"></textarea></app-field>
        <app-field label="Photo or PDF" [wide]="true" [hint]="file() ? file()!.proofName : 'Image or PDF, under 450 KB'" [error]="fileError() || null">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" (change)="pick($event)" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()" [disabled]="!balanced()">Submit receipt</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ReceiptForm extends FormModal {
  readonly order = input<PortalOrder | null>(null);
  readonly distributorId = input<string | undefined>(undefined);
  readonly formId = 'form-receipt';
  protected conditions = CONDITIONS;
  protected money = fmtMoney;
  private portal = inject(PortalApi);

  protected file = signal<ProofFile | null>(null);
  protected fileError = signal('');

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    goodCartons: [0, [Validators.required, Validators.min(0)]],
    damagedCartons: [0, Validators.min(0)],
    missingCartons: [0, Validators.min(0)],
    condition: ['Good'],
    waybill: [''],
    receivedBy: [''],
    reason: [''],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected sum = computed(() => Number(this.value().goodCartons || 0) + Number(this.value().damagedCartons || 0) + Number(this.value().missingCartons || 0));
  protected balanced = computed(() => this.sum() === (this.order()?.cartons ?? -1));
  /** value of what is claimed, at the order's price */
  protected claim = computed(() => {
    const o = this.order();
    if (!o) return 0;
    const bad = Number(this.value().damagedCartons || 0) + Number(this.value().missingCartons || 0);
    return bad * (o.product.packsPerCarton || 1) * Number(o.rate);
  });

  protected reset() {
    const o = this.order();
    this.file.set(null);
    this.fileError.set('');
    this.form.reset({ date: today(), goodCartons: o?.cartons ?? 0, damagedCartons: 0, missingCartons: 0, condition: 'Good', waybill: o?.refNo ?? '', receivedBy: '', reason: '' });
  }

  protected pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.fileError.set('');
    this.file.set(null);
    if (!f) return;
    readProof(f).then((p) => this.file.set(p), (err: Error) => this.fileError.set(err.message));
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.portal.createReceipt({
      orderId: this.order()!.id, distributorId: this.distributorId(), ...v,
      goodCartons: Number(v.goodCartons), damagedCartons: Number(v.damagedCartons), missingCartons: Number(v.missingCartons), ...(this.file() ?? {}),
    });
  }

  protected successMessage() {
    return this.claim() > 0 ? 'Delivery recorded. Your claim is with Zingo for review.' : 'Delivery recorded.';
  }
}
