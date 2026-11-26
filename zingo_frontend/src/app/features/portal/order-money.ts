import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { AttachmentMeta, AttachmentsApi } from '../../core/attachments.api';
import { errorText } from '../../shared/errors';
import { fmtDate, fmtMoney, Tone } from '../../shared/format';
import { Btn, Field, FileInput, Modal, MoneyInput, RichText, Select, ToastService } from '../../ui';
import { PortalApi } from './portal.api';
import { OrderMoney } from './portal.models';

const today = () => new Date().toISOString().slice(0, 10);

/** "20/30" days: green while under 70% of the credit days, amber up to the due date, red once overdue */
export function daysTone(o: OrderMoney): Tone | null {
  if (o.daysSince === null || o.balance <= 0.01) return o.balance <= 0.01 ? 'success' : null;
  if (o.overdue) return 'danger';
  return o.creditDays > 0 && o.daysSince / o.creditDays >= 0.7 ? 'warning' : 'success';
}

/**
 * Pay on one order: the order total, what is paid and what is left; the amount paid now, how, when, a reference and
 * the proof. It counts at once (Zen Foods can reverse it if the money did not arrive).
 */
@Component({
  selector: 'app-order-pay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn, MoneyInput, FileInput, RichText, Select],
  template: `
    <app-modal #dlg [(open)]="open" [dirty]="form.dirty" [title]="'Pay on ' + (order()?.orderRef ?? '')" [subtitle]="order()?.products?.join(', ') ?? ''" size="md">
      @if (order(); as o) {
        @if (error()) {
          <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
        }
        <div class="sums">
          <div><span>Total</span><strong>{{ money(o.amount) }}</strong></div>
          <div><span>Paid</span><strong>{{ money(o.paid) }}</strong></div>
          <div><span>Balance</span><strong class="info-figure">{{ money(o.balance) }}</strong></div>
          <div><span>Balance after this</span><strong>{{ money(after()) }}</strong></div>
        </div>
        <form id="form-order-pay" class="form-grid" [formGroup]="form" (ngSubmit)="send()" novalidate>
          <app-field label="Pay now" [required]="true" [error]="err('amount')">
            <app-money-input formControlName="amount" />
          </app-field>
          <app-field label="Method" [required]="true" [error]="err('method')">
            <app-select formControlName="method">
              @for (m of methods(); track m) {
                <option [value]="m">{{ m }}</option>
              }
            </app-select>
          </app-field>
          <app-field label="Paid on" [required]="true"><input type="date" formControlName="date" [max]="today" /></app-field>
          <app-field label="Bank / transfer reference" [wide]="true"><app-rich-text formControlName="reference" [max]="80" [storeMax]="80" /></app-field>
          <app-field label="Proof of payment" [wide]="true" [required]="true" [error]="err('proof')" hint="Bank slip or transfer screenshot: picture or PDF, 5 MB at most">
            <app-file-input formControlName="proof" />
          </app-field>
        </form>
      }
      <ng-container modalFooter>
        <button appBtn type="button" (click)="dlg.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" form="form-order-pay" icon="check" [loading]="busy()">Pay {{ money(amount()) }}</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .sums {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-2);
      margin-block-end: var(--space-4);
      padding: var(--space-3);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
      font-variant-numeric: tabular-nums;

      & span {
        display: block;
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      @media (max-width: 560px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
})
export class OrderPay {
  readonly open = model(false);
  readonly order = input<OrderMoney | null>(null);
  readonly methods = input<string[]>(['Bank Transfer']);
  /** staff paying for a distributor */
  readonly distributorId = input<string | undefined>(undefined);
  readonly saved = output<void>();

  private api = inject(PortalApi);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);
  protected busy = signal(false);
  protected error = signal('');
  private tried = signal(false);
  protected today = today();
  protected money = fmtMoney;

  readonly form = this.fb.group({
    amount: this.fb.control<number | null>(null),
    method: this.fb.nonNullable.control(''),
    date: this.fb.nonNullable.control(today()),
    reference: this.fb.nonNullable.control(''),
    proof: this.fb.control<AttachmentMeta | null>(null),
  });
  private v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected amount = computed(() => Number(this.v().amount || 0));
  protected after = computed(() => Math.max(0, (this.order()?.balance ?? 0) - this.amount()));

  constructor() {
    // each time it opens: the whole balance, the first method, today
    effect(() => {
      if (!this.open()) return;
      const o = this.order();
      this.tried.set(false);
      this.error.set('');
      this.form.reset({ amount: o?.balance || null, method: this.methods()[0] ?? '', date: today(), reference: '', proof: null });
    });
  }

  protected err(k: 'amount' | 'method' | 'proof'): string | null {
    if (!this.tried()) return null;
    const v = this.v();
    const o = this.order();
    if (k === 'amount') return !(Number(v.amount) > 0) ? 'Enter the amount' : o && Number(v.amount) > Math.max(o.orderedValue, o.receivedValue) - o.paid + 0.001 ? 'More than is open on the order' : null;
    if (k === 'method') return v.method ? null : 'Choose the method';
    return v.proof ? null : 'Upload the proof';
  }

  protected send() {
    this.tried.set(true);
    if ((['amount', 'method', 'proof'] as const).some((k) => this.err(k))) return;
    const v = this.form.getRawValue();
    const o = this.order()!;
    this.busy.set(true);
    this.api.payOrder({
      distributorId: this.distributorId(), orderRef: o.orderRef, amount: Number(v.amount), method: v.method, date: v.date,
      reference: v.reference.trim() || undefined, proofId: v.proof!.id,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(`Payment recorded on ${o.orderRef}.`);
        this.open.set(false);
        this.saved.emit();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorText(e));
      },
    });
  }
}

/** One order's payments with the balance after each, and the proof of each (staff can open it and reverse a payment). */
@Component({
  selector: 'app-order-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal, Btn],
  template: `
    <app-modal [(open)]="open" [title]="'Payments on ' + (orderRef() ?? '')" size="lg">
      @if (data.isLoading()) {
        <p class="muted">Loading…</p>
      } @else if (data.value(); as d) {
        <div class="sums">
          <div><span>Order total</span><strong>{{ money(d.order.amount) }}</strong></div>
          <div><span>Paid</span><strong>{{ money(d.order.paid) }}</strong></div>
          <div><span>Balance</span><strong class="info-figure">{{ money(d.order.balance) }}</strong></div>
          <div><span>Days</span><strong>{{ d.order.daysSince === null ? 'Not received' : d.order.daysSince + ' / ' + d.order.creditDays }}</strong></div>
        </div>
        <div class="table-wrap">
          <table class="ledger" aria-label="Payments on this order">
            <thead><tr><th>Date</th><th>Payment</th><th>Method / reference</th><th>Proof</th><th class="num">Amount</th><th class="num">Balance</th>@if (canReverse()) { <th></th> }</tr></thead>
            <tbody>
              @for (e of d.entries; track e.refNo) {
                <tr [class.reversed]="e.status === 'Reversed'">
                  <td>{{ date(e.date) }}</td>
                  <td><strong>{{ e.refNo }}</strong><small>{{ e.kind }}{{ e.status === 'Reversed' ? ' · reversed' : '' }}</small></td>
                  <td>{{ e.method }}@if (e.reference) { <small>{{ e.reference }}</small> }</td>
                  <td>
                    @if (e.proofId && canOpenProof()) {
                      <button appBtn type="button" size="sm" variant="ghost" icon="download" (click)="proof(e.proofId, e.proofName)">{{ e.proofName }}</button>
                    } @else { {{ e.proofName || '—' }} }
                  </td>
                  <td class="num">{{ money(e.amount) }}</td>
                  <td class="num">{{ money(e.balance) }}</td>
                  @if (canReverse()) {
                    <td>@if (e.id && e.status === 'Active') { <button appBtn type="button" size="sm" variant="ghost" (click)="reverse.emit(e.id)">Reverse</button> }</td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="canReverse() ? 7 : 6" class="muted">Nothing paid on this order yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (data.error()) {
        <div class="notice" data-tone="danger" role="alert">{{ errorText(data.error()) }}</div>
      }
      <ng-container modalFooter>
        <button appBtn type="button" (click)="open.set(false)">Close</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .sums {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-2);
      margin-block-end: var(--space-4);
      padding: var(--space-3);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
      font-variant-numeric: tabular-nums;

      & span {
        display: block;
        font-size: var(--text-xs);
        color: var(--text-3);
      }
    }

    .table-wrap {
      overflow-x: auto;
    }

    .ledger {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);

      & th,
      & td {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        text-align: start;
        vertical-align: top;
      }

      & th {
        font-size: var(--text-xs);
        color: var(--text-3);
        font-weight: var(--weight-semibold);
      }

      & .num {
        text-align: end;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      & small {
        display: block;
        color: var(--text-3);
        font-size: var(--text-xs);
      }

      & tr.reversed td {
        color: var(--text-3);
        text-decoration: line-through;
      }
    }

    .muted {
      color: var(--text-3);
    }
  `,
})
export class OrderLedger {
  readonly open = model(false);
  readonly orderRef = input<string | null>(null);
  readonly distributorId = input<string | undefined>(undefined);
  /** staff: open the proofs; Finance / Admin: reverse a payment */
  readonly canOpenProof = input(false);
  readonly canReverse = input(false);
  readonly tick = input(0);
  readonly reverse = output<string>();

  private api = inject(PortalApi);
  private files = inject(AttachmentsApi);
  private toast = inject(ToastService);
  protected data = rxResource({
    params: () => (this.open() && this.orderRef() ? { ref: this.orderRef()!, d: this.distributorId(), t: this.tick() } : undefined),
    stream: ({ params }) => (params ? this.api.orderLedger(params.ref, params.d) : of(null)),
  });
  protected money = fmtMoney;
  protected date = fmtDate;
  protected errorText = errorText;

  protected proof(id: string, name: string | null) {
    this.files.download({ id, name: name ?? 'proof' }).subscribe({ error: (e) => this.toast.error(errorText(e)) });
  }
}
