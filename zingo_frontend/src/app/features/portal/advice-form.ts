import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { fmtMoney } from '../../shared/format';
import { ProofFile, readProof } from '../../shared/files';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { PortalApi } from './portal.api';
import { PortalOrder } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);

/** what can still be paid on an order: the invoice balance, or the pro-forma before dispatch, less what is already reported */
export const payableOf = (o: PortalOrder) =>
  Math.max(0, Math.round(((o.status === 'Dispatched' ? o.outstanding : o.billed - o.collected) - o.pendingAdvice) * 100) / 100);

/**
 * "I paid": report a payment (an instalment, or an advance before dispatch). It is an advice, not cash:
 * Zingo verifies it against the bank or cash record before it counts.
 */
@Component({
  selector: 'app-advice-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report a payment" size="lg" [dirty]="form.dirty"
                   subtitle="This is an advice, not confirmed cash. Zingo checks it against the bank record.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      @if (selected(); as o) {
        <div class="notice">
          <span>
            {{ o.refNo }} · {{ o.voucher }} {{ money(o.billed) }} · paid {{ money(o.collected) }}
            · <strong>you can report up to {{ money(max()) }}</strong>
            @if (o.status !== 'Dispatched') { (advance, held until dispatch) }
          </span>
        </div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Pay against" [wide]="true" [required]="true" [error]="invalid('orderId') ? 'Choose an order' : null">
          <select formControlName="orderId">
            <option value="">Choose an order</option>
            @for (o of payable(); track o.id) {
              <option [value]="o.id">{{ o.refNo }} · {{ o.product.sku }} · open {{ money(payableOf(o)) }}</option>
            }
          </select>
        </app-field>
        <app-field label="Payment date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Amount" [required]="true" [error]="invalid('amount') ? 'Enter an amount above zero' : null">
          <app-money-input formControlName="amount" />
        </app-field>
        <app-field label="Payment mode">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Bank reference / transaction ID" [wide]="true"><input type="text" formControlName="bankRef" maxlength="80" /></app-field>
        <app-field label="Receipt or screenshot" [wide]="true" [hint]="file() ? file()!.proofName : 'Image or PDF, under 450 KB'" [error]="fileError() || null">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" (change)="pick($event)" />
        </app-field>
        <app-field label="Remark" [wide]="true"><textarea formControlName="note"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">Send payment advice</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AdviceForm extends FormModal {
  /** orders that can still take a payment */
  readonly orders = input<PortalOrder[]>([]);
  readonly methods = input<string[]>(['Bank Transfer']);
  /** start on this order */
  readonly orderId = input<string | undefined>(undefined);
  readonly distributorId = input<string | undefined>(undefined);
  readonly formId = 'form-advice';
  protected money = fmtMoney;
  protected payableOf = payableOf;
  private portal = inject(PortalApi);

  protected file = signal<ProofFile | null>(null);
  protected fileError = signal('');

  readonly form = this.fb.nonNullable.group({
    orderId: ['', Validators.required],
    date: [today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['Bank Transfer'],
    bankRef: [''],
    note: [''],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected payable = computed(() => this.orders().filter((o) => payableOf(o) > 0));
  protected selected = computed(() => this.orders().find((o) => o.id === this.value().orderId) ?? null);
  protected max = computed(() => (this.selected() ? payableOf(this.selected()!) : 0));

  protected reset() {
    const first = this.orders().find((o) => o.id === this.orderId() && payableOf(o) > 0) ?? this.payable()[0];
    this.file.set(null);
    this.fileError.set('');
    this.form.reset({
      orderId: first?.id ?? '', date: today(), amount: first ? payableOf(first) : 0, method: this.methods()[0] ?? 'Bank Transfer', bankRef: '', note: '',
    });
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
    return this.portal.createAdvice({ ...v, amount: Number(v.amount), distributorId: this.distributorId(), ...(this.file() ?? {}) });
  }

  protected successMessage() {
    return 'Payment advice sent. It counts once Zingo has verified it.';
  }
}
