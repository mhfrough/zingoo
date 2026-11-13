import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AttachmentMeta } from '../../core/attachments.api';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { fmtAmount2, fmtDate } from '../../shared/format';
import { Btn, Field, FileInput, FilesInput, Tag, ToastService } from '../../ui';

/** what the portal sees of an order: no Zen Foods costs or margins */
interface PortalExportOrder {
  id: string; refNo: string; date: string; shipDate: string | null; status: 'Quote' | 'Shipped'; cartons: number; incoterm: string; port: string | null;
  currency: string; revenueForeign: number; collected: number; credited: number; due: number; dueDate: string | null; overdue: boolean;
  product: { sku: string; name: string }; shippingStatus: string | null; blNo: string | null; vessel: string | null; eta: string | null; etd: string | null;
  containerNo: string | null; batchRef: string | null; expiryDate: string | null;
}
interface PortalAccount {
  agingLabels: string[];
  credit: { currency: string; limit: number; exposure: number; available: number; problems: string[] };
  currencies: { currency: string; invoiced: number; collected: number; open: number; overdue: number; unapplied: number; aging: number[]; balance: number }[];
  orders: PortalExportOrder[];
  remittances: { id: string; refNo: string; date: string; currency: string; amount: number; unapplied: number; allocations: { shipment: string; amount: number }[] }[];
  claims: { id: string; refNo: string; date: string; kind: string; quantity: number; status: string; resolution: string | null; creditAmount: number; creditNoteRef: string | null; decisionNote: string | null; shipment: { refNo: string; currency: string } }[];
  advices: { id: string; refNo: string; date: string; currency: string; amount: number; status: string; reviewNote: string | null }[];
  statement: { date: string; ref: string; text: string; currency: string; debit: number; credit: number; balance: number }[];
}
interface PortalPrice { sku: string; name: string; unit: string; packsPerUnit: number; currency: string; price: number; discountPct: number; effectiveFrom: string; effectiveTo: string | null; moq: number; increment: number; promo: boolean }
interface PortalNote { kind: string; date: string; title: string; text: string }

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The portal of an international distributor (the client's spec, section 7): notifications, what it owes per
 * currency with aging, its export orders and where they are, its agreed prices, claims and payment advices, and its
 * statement. What a login may do follows its portal role (Owner, Sales, Finance, Warehouse, Read-only).
 */
@Component({
  selector: 'app-intl-portal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Btn, Field, FileInput, FilesInput, Tag],
  styles: `
    :host { display: block; }
    section { margin-block-end: var(--space-6); }
    h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
    .lead { margin: 0 0 var(--space-3); color: var(--text-2); font-size: var(--text-sm); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr)); gap: var(--space-2); margin-block-end: var(--space-2); }
    .cards div { padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .cards small { display: block; font-size: var(--text-xs); color: var(--text-3); }
    .cards strong { font-variant-numeric: tabular-nums; }
    .notes { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .notes li { padding: var(--space-2) var(--space-3); border-inline-start: 3px solid var(--border-strong); background: var(--surface); font-size: var(--text-sm); }
    .notes li[data-kind='overdue'], .notes li[data-kind='advice'] { border-color: var(--danger); }
    .notes li[data-kind='due'] { border-color: var(--warning); }
    .notes small { display: block; color: var(--text-3); }
    .scroll { overflow-x: auto; }
    .t { inline-size: 100%; border-collapse: collapse; font-size: var(--text-sm); }
    .t th { padding: var(--space-2); text-align: start; font-size: var(--text-xs); color: var(--text-3); border-block-end: 1px solid var(--border-strong); white-space: nowrap; }
    .t td { padding: var(--space-2); border-block-end: 1px solid var(--border); vertical-align: top; }
    .t .num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .t small { display: block; color: var(--text-3); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: var(--space-3); align-items: end; }
    .card { padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  `,
  template: `
    @if (acc.value(); as a) {
      <section>
        <h2>Notifications</h2>
        @if (notes.value()?.length) {
          <ul class="notes">
            @for (n of notes.value(); track $index) {
              <li [attr.data-kind]="n.kind"><strong>{{ n.title }}</strong> <small>{{ date(n.date) }} · {{ n.text }}</small></li>
            }
          </ul>
        } @else {
          <p class="lead">Nothing new.</p>
        }
      </section>

      <section>
        <h2>What you owe</h2>
        <p class="lead">Credit: {{ a.credit.currency }} {{ amt(a.credit.limit) }} · available {{ amt(a.credit.available) }}{{ a.credit.problems.length ? ' · ' + a.credit.problems.join('; ') : '' }}</p>
        @for (c of a.currencies; track c.currency) {
          <div class="cards">
            <div><small>Invoiced</small><strong>{{ c.currency }} {{ amt(c.invoiced) }}</strong></div>
            <div><small>Paid</small><strong>{{ amt(c.collected) }}</strong></div>
            <div><small>Open</small><strong>{{ amt(c.open) }}</strong></div>
            <div><small>Overdue</small><strong>{{ amt(c.overdue) }}</strong></div>
            <div><small>Your credit with us</small><strong>{{ amt(c.unapplied) }}</strong></div>
          </div>
          <div class="scroll">
            <table class="t" [attr.aria-label]="'Aging in ' + c.currency">
              <thead><tr>@for (l of a.agingLabels; track l) { <th class="num">{{ l }}</th> }</tr></thead>
              <tbody><tr>@for (v of c.aging; track $index) { <td class="num">{{ amt(v) }}</td> }</tr></tbody>
            </table>
          </div>
        } @empty {
          <p class="lead">Nothing invoiced yet.</p>
        }
      </section>

      <section>
        <h2>Your export orders</h2>
        <div class="scroll">
          <table class="t" aria-label="Export orders">
            <thead><tr><th>Order</th><th>Product</th><th class="num">Invoice</th><th class="num">Open</th><th>Shipping</th><th>Batch</th></tr></thead>
            <tbody>
              @for (o of a.orders; track o.id) {
                <tr>
                  <td>{{ o.refNo }}<small>{{ o.shipDate ? 'shipped ' + date(o.shipDate) : 'quoted ' + date(o.date) }}</small></td>
                  <td>{{ o.product.sku }}<small>{{ o.cartons }} bundles · {{ o.incoterm }} {{ o.port ?? '' }}</small></td>
                  <td class="num">{{ o.currency }} {{ amt(o.revenueForeign) }}</td>
                  <td class="num">{{ o.status === 'Shipped' ? amt(o.due) : '-' }}<small>{{ o.dueDate ? (o.overdue ? 'overdue since ' : 'due ') + date(o.dueDate) : '' }}</small></td>
                  <td>
                    <app-tag [tone]="o.status === 'Quote' ? 'info' : o.shippingStatus === 'Delivered' ? 'success' : 'warning'">{{ o.status === 'Quote' ? 'Being prepared' : o.shippingStatus ?? 'Shipped' }}</app-tag>
                    <small>{{ o.blNo ? 'BL ' + o.blNo : '' }}{{ o.vessel ? ' · ' + o.vessel : '' }}{{ o.eta ? ' · ETA ' + date(o.eta) : '' }}</small>
                  </td>
                  <td>{{ o.batchRef ?? '' }}<small>{{ o.expiryDate ? 'best before ' + date(o.expiryDate) : '' }}</small></td>
                </tr>
              } @empty {
                <tr><td colspan="6">No orders yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Claims &amp; returns</h2>
        <div class="scroll">
          <table class="t" aria-label="Claims">
            <thead><tr><th>Claim</th><th>Order</th><th>What</th><th>Decision</th></tr></thead>
            <tbody>
              @for (c of a.claims; track c.id) {
                <tr>
                  <td>{{ c.refNo }}<small>{{ date(c.date) }}</small></td>
                  <td>{{ c.shipment.refNo }}</td>
                  <td>{{ c.kind }} · {{ c.quantity }} bundle(s)</td>
                  <td>
                    <app-tag [tone]="c.status === 'Approved' ? 'success' : c.status === 'Rejected' ? 'danger' : 'warning'">{{ c.status }}</app-tag>
                    <small>{{ c.creditNoteRef ? c.creditNoteRef + ' · ' + c.shipment.currency + ' ' + amt(c.creditAmount) : c.resolution ?? '' }}{{ c.decisionNote ? ' · ' + c.decisionNote : '' }}</small>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4">No claims.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (canClaim() && shipped().length) {
          <form class="card grid" [formGroup]="claim" (ngSubmit)="raise()" style="margin-block-start: var(--space-3)">
            <app-field label="Order" [required]="true">
              <select formControlName="shipmentId">
                @for (o of shipped(); track o.id) {
                  <option [value]="o.id">{{ o.refNo }} · {{ o.product.sku }}</option>
                }
              </select>
            </app-field>
            <app-field label="Kind">
              <select formControlName="kind">
                @for (k of kinds; track k) { <option [value]="k">{{ k }}</option> }
              </select>
            </app-field>
            <app-field label="Bundles" [required]="true"><input type="number" formControlName="quantity" min="1" step="1" /></app-field>
            <app-field label="Date"><input type="date" formControlName="date" [max]="todayIso" /></app-field>
            <app-field label="What happened" [required]="true" [wide]="true"><input type="text" formControlName="description" maxlength="2000" /></app-field>
            <app-field label="Photos" [wide]="true"><app-files-input formControlName="photos" /></app-field>
            <div><button appBtn type="submit" variant="primary" size="sm" [loading]="busy()">Raise claim</button></div>
          </form>
        }
      </section>

      <section>
        <h2>Payments</h2>
        <div class="scroll">
          <table class="t" aria-label="Payments">
            <thead><tr><th>Ref</th><th>Date</th><th class="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              @for (r of a.remittances; track r.id) {
                <tr><td>{{ r.refNo }}</td><td>{{ date(r.date) }}</td><td class="num">{{ r.currency }} {{ amt(r.amount) }}</td>
                  <td><app-tag tone="success">Received</app-tag><small>{{ r.unapplied > 0.004 ? amt(r.unapplied) + ' kept as your credit' : '' }}</small></td></tr>
              }
              @for (v of a.advices; track v.id) {
                <tr><td>{{ v.refNo }}</td><td>{{ date(v.date) }}</td><td class="num">{{ v.currency }} {{ amt(v.amount) }}</td>
                  <td><app-tag [tone]="v.status === 'Recorded' ? 'success' : v.status === 'Rejected' ? 'danger' : 'warning'">{{ v.status === 'Submitted' ? 'Advice sent' : v.status }}</app-tag><small>{{ v.reviewNote ?? '' }}</small></td></tr>
              }
              @if (!a.remittances.length && !a.advices.length) {
                <tr><td colspan="4">No payments yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (canPay()) {
          <form class="card grid" [formGroup]="advice" (ngSubmit)="advise()" style="margin-block-start: var(--space-3)">
            <app-field label="Date paid" [required]="true"><input type="date" formControlName="date" [max]="todayIso" /></app-field>
            <app-field label="Currency"><input type="text" formControlName="currency" maxlength="3" /></app-field>
            <app-field label="Amount" [required]="true"><input type="number" formControlName="amount" min="0" step="any" /></app-field>
            <app-field label="Bank reference"><input type="text" formControlName="bankRef" maxlength="80" placeholder="MT103 / LC no." /></app-field>
            <app-field label="For invoices" [wide]="true"><input type="text" formControlName="forInvoices" maxlength="300" placeholder="EXP-001, EXP-002" /></app-field>
            <app-field label="Proof of payment" [required]="true" [wide]="true"><app-file-input formControlName="proof" label="Upload the bank copy" /></app-field>
            <div><button appBtn type="submit" variant="primary" size="sm" [loading]="busy()">Send payment advice</button></div>
          </form>
        }
      </section>

      <section>
        <h2>Your prices</h2>
        <div class="scroll">
          <table class="t" aria-label="Agreed prices">
            <thead><tr><th>SKU</th><th>Unit</th><th class="num">Price</th><th>Valid</th><th class="num">Minimum / multiple</th></tr></thead>
            <tbody>
              @for (p of prices.value() ?? []; track $index) {
                <tr>
                  <td>{{ p.sku }}<small>{{ p.name }}{{ p.promo ? ' · promotion' : '' }}</small></td>
                  <td>{{ p.unit }}<small>{{ p.packsPerUnit }} packs</small></td>
                  <td class="num">{{ p.currency }} {{ amt(p.price) }}<small>{{ p.discountPct ? '−' + p.discountPct + '%' : '' }}</small></td>
                  <td>{{ date(p.effectiveFrom) }}<small>{{ p.effectiveTo ? 'to ' + date(p.effectiveTo) : 'until changed' }}</small></td>
                  <td class="num">{{ p.moq || '-' }} / {{ p.increment || '-' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5">No prices agreed yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Statement</h2>
        <div class="scroll">
          <table class="t" aria-label="Statement">
            <thead><tr><th>Date</th><th>Ref</th><th>Detail</th><th class="num">Invoiced</th><th class="num">Paid / credited</th><th class="num">Balance</th></tr></thead>
            <tbody>
              @for (l of a.statement; track $index) {
                <tr><td>{{ date(l.date) }}</td><td>{{ l.ref }}</td><td>{{ l.text }}</td>
                  <td class="num">{{ l.debit ? amt(l.debit) : '' }}</td><td class="num">{{ l.credit ? amt(l.credit) : '' }}</td><td class="num">{{ l.currency }} {{ amt(l.balance) }}</td></tr>
              } @empty {
                <tr><td colspan="6">Nothing yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (acc.error()) {
      <p class="lead">Your account could not be loaded.</p>
    }
  `,
})
export class IntlPortal {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);

  private tick = signal(0);
  protected acc = rxResource({ params: () => this.tick(), stream: () => this.api.get<PortalAccount>('portal/intl/account') });
  protected prices = rxResource({ params: () => this.tick(), stream: () => this.api.get<PortalPrice[]>('portal/intl/prices') });
  protected notes = rxResource({ params: () => this.tick(), stream: () => this.api.get<PortalNote[]>('portal/intl/notifications') });
  protected busy = signal(false);
  protected todayIso = today();
  protected kinds = ['Damage', 'Shortage', 'Quality', 'Return'];

  private portalRole = computed(() => this.auth.user()?.portalRole ?? 'Owner');
  protected canClaim = computed(() => ['Owner', 'Sales', 'Warehouse'].includes(this.portalRole()));
  protected canPay = computed(() => ['Owner', 'Finance'].includes(this.portalRole()));
  protected shipped = computed(() => (this.acc.value()?.orders ?? []).filter((o) => o.status === 'Shipped'));

  protected amt = (v: number) => fmtAmount2(v);
  protected date = (d: string) => fmtDate(d);

  protected claim = this.fb.nonNullable.group({
    shipmentId: [''], kind: ['Damage'], quantity: [1], date: [today()], description: [''], photos: [[] as AttachmentMeta[]],
  });
  protected advice = this.fb.nonNullable.group({
    date: [today()], currency: ['USD'], amount: [null as number | null], bankRef: [''], forInvoices: [''], proof: [null as AttachmentMeta | null],
  });

  constructor() {
    // payments default to the currency the distributor is invoiced in
    effect(() => {
      const cur = this.acc.value()?.orders?.[0]?.currency ?? this.prices.value()?.[0]?.currency;
      if (cur && !this.advice.dirty) this.advice.controls.currency.setValue(cur);
    });
  }

  protected raise() {
    const v = this.claim.getRawValue();
    const id = v.shipmentId || this.shipped()[0]?.id;
    if (!id || !v.description.trim()) {
      this.toast.error('Choose the order and say what happened.');
      return;
    }
    this.run(this.api.post(`portal/intl/shipments/${id}/claims`, {
      date: v.date, kind: v.kind, quantity: Number(v.quantity) || 1, description: v.description.trim(), photos: v.photos,
    }), 'Claim sent. Zen Foods will review it.', () => this.claim.patchValue({ description: '', photos: [], quantity: 1 }));
  }

  protected advise() {
    const v = this.advice.getRawValue();
    if (!v.amount || !v.proof) {
      this.toast.error('Enter the amount and upload the proof of payment.');
      return;
    }
    this.run(this.api.post('portal/intl/advices', {
      date: v.date, currency: v.currency.toUpperCase(), amount: Number(v.amount), bankRef: v.bankRef.trim() || undefined,
      forInvoices: v.forInvoices.trim() || undefined, proof: v.proof,
    }), 'Payment advice sent. Zen Foods will match it with the bank.', () => this.advice.patchValue({ amount: null, bankRef: '', forInvoices: '', proof: null }));
  }

  private run(req: import('rxjs').Observable<unknown>, ok: string, after: () => void) {
    this.busy.set(true);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(ok);
        after();
        this.tick.update((n) => n + 1);
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
