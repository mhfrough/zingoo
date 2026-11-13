import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtAmount2, fmtDate, fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas, Tag, ToastService } from '../../ui';
import { ExportsApi } from './exports.api';
import { DistributorAccount, ExportRow, Remittance } from './models';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One international distributor's account (the client's spec, sections 4, 9 and 10): credit position, what it owes
 * per currency with aging and the PKR equivalent, its orders (with Finance's credit override on a quote), the money
 * it sent and where that money went, a running statement, and recording a new remittance applied to its invoices.
 */
@Component({
  selector: 'app-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Tag],
  styles: `
    h3 {
      margin: var(--space-5) 0 var(--space-2);
      font-size: var(--text-md);
    }

    .lead {
      margin: 0 0 var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-2);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
      gap: var(--space-2);

      & div {
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }

      & small {
        display: block;
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & strong {
        font-variant-numeric: tabular-nums;
      }
    }

    .problems {
      margin: var(--space-2) 0 0;
      color: var(--danger);
      font-size: var(--text-sm);
    }

    .scroll {
      overflow-x: auto;
    }

    .t {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);

      & th {
        padding: var(--space-2);
        text-align: start;
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
        border-block-end: 1px solid var(--border-strong);
        white-space: nowrap;
      }

      & td {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        vertical-align: top;
      }

      & .num {
        text-align: end;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      & small {
        display: block;
        color: var(--text-3);
      }
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
      gap: var(--space-3);
      align-items: end;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      margin-block-start: var(--space-2);
    }

    input.amt {
      inline-size: 8rem;
    }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="'Account · ' + (a()?.distributor?.name ?? '')" [subtitle]="a()?.distributor?.code ?? 'International distributor'" size="lg">
      @if (a(); as acc) {
        <h3>Credit</h3>
        <div class="cards">
          <div><small>Limit</small><strong>{{ acc.credit.currency }} {{ amt(acc.credit.limit) }}</strong>{{ acc.credit.expired ? ' (expired)' : '' }}</div>
          <div><small>Open invoices</small><strong>{{ amt(acc.credit.outstanding) }}</strong></div>
          <div><small>Money not applied</small><strong>{{ amt(acc.credit.unapplied) }}</strong></div>
          <div><small>Exposure</small><strong>{{ amt(acc.credit.exposure) }}</strong></div>
          <div><small>Available</small><strong>{{ amt(acc.credit.available) }}</strong></div>
          <div><small>When passed</small><strong>{{ acc.credit.control === 'Warn' ? 'Warn' : 'Block' }}</strong></div>
        </div>
        @if (acc.credit.problems.length) {
          <p class="problems">{{ acc.credit.problems.join('; ') }}.</p>
        }

        <h3>Owed per currency</h3>
        @for (c of acc.currencies; track c.currency) {
          <div class="cards">
            <div><small>Invoiced</small><strong>{{ c.currency }} {{ amt(c.invoiced) }}</strong></div>
            <div><small>Collected</small><strong>{{ amt(c.collected) }}</strong></div>
            <div><small>Open</small><strong>{{ amt(c.open) }}</strong><small>{{ pkr(c.openPKR) }}</small></div>
            <div><small>Overdue</small><strong>{{ amt(c.overdue) }}</strong></div>
            <div><small>Not applied</small><strong>{{ amt(c.unapplied) }}</strong><small>{{ pkr(c.unappliedPKR) }}</small></div>
            <div><small>Balance</small><strong>{{ amt(c.balance) }}</strong></div>
          </div>
          <div class="scroll">
            <table class="t" [attr.aria-label]="'Aging in ' + c.currency">
              <thead><tr>@for (l of acc.agingLabels; track l) { <th class="num">{{ l }}</th> }</tr></thead>
              <tbody><tr>@for (v of c.aging; track $index) { <td class="num">{{ amt(v) }}</td> }</tr></tbody>
            </table>
          </div>
        } @empty {
          <p class="lead">Nothing invoiced yet.</p>
        }

        <h3>Orders</h3>
        <div class="scroll">
          <table class="t" aria-label="Orders">
            <thead><tr><th>Order</th><th>SKU</th><th class="num">Invoice</th><th class="num">Due</th><th class="num">Margin</th><th>Status</th></tr></thead>
            <tbody>
              @for (o of acc.orders; track o.id) {
                <tr>
                  <td>{{ o.refNo }}<small>{{ o.shipDate ? 'shipped ' + date(o.shipDate) : 'quoted ' + date(o.date) }}</small></td>
                  <td>{{ o.product.sku }}<small>{{ o.cartons }} bundles · {{ o.incoterm }}</small></td>
                  <td class="num">{{ o.currency }} {{ amt(o.revenueForeign) }}</td>
                  <td class="num">{{ o.status === 'Shipped' ? amt(o.due) : '-' }}<small>{{ o.dueDate ? (o.overdue ? 'overdue since ' : 'by ') + date(o.dueDate) : '' }}</small></td>
                  <td class="num">{{ o.margin.toFixed(1) }}%</td>
                  <td>
                    <app-tag [tone]="o.status === 'Quote' ? 'info' : o.overdue ? 'danger' : o.due > 0.004 ? 'warning' : 'success'">
                      {{ o.status === 'Quote' ? 'Quote' : o.overdue ? 'Overdue' : o.due > 0.004 ? 'Open' : 'Paid' }}
                    </app-tag>
                    @if (o.creditOverrideAt) {
                      <small>Override by {{ o.creditOverrideBy }}: {{ o.creditOverrideReason }}</small>
                    }
                    @if (o.creditNote) {
                      <small>{{ o.creditNote }}</small>
                    }
                    @if (o.status === 'Quote' && finance() && !o.creditOverrideAt) {
                      <div class="row">
                        <input type="text" [value]="reasons()[o.id] ?? ''" (input)="setReason(o.id, $any($event.target).value)" maxlength="500"
                               placeholder="Reason to override the credit check" [attr.aria-label]="'Override reason for ' + o.refNo" />
                        <button appBtn size="sm" [loading]="busy()" [disabled]="!(reasons()[o.id] ?? '').trim()" (click)="override(o)">Override credit</button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6">No orders yet. Make one on Export Containers.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <h3>Money received</h3>
        @for (r of acc.remittances; track r.id) {
          <div class="cards">
            <div>
              <small>{{ r.refNo }} · {{ date(r.date) }} · {{ r.method }}{{ r.bankRef ? ' · ' + r.bankRef : '' }}</small>
              <strong>{{ r.currency }} {{ amt(r.amount) }}</strong> at {{ r.fxRate }}{{ r.fees ? ' · fees ' + amt(r.fees) : '' }}
              <small>{{ r.fromBank ?? '' }}{{ r.allocations.length ? ' · applied to ' + allocText(r) : ' · not applied yet' }}</small>
              @if (r.unapplied > 0.004) {
                <small>{{ r.currency }} {{ amt(r.unapplied) }} not applied</small>
                @if (canWrite() && openIn(r.currency).length) {
                  <div class="row">
                    <select [value]="applyTo()[r.id] ?? ''" (change)="setApplyTo(r.id, $any($event.target).value)" [attr.aria-label]="'Invoice for ' + r.refNo">
                      <option value="">Choose an invoice</option>
                      @for (o of openIn(r.currency); track o.id) {
                        <option [value]="o.id">{{ o.refNo }} · {{ amt(o.due) }} open</option>
                      }
                    </select>
                    <input class="amt" type="number" min="0" step="any" [value]="applyAmt()[r.id] ?? ''" (input)="setApplyAmt(r.id, $any($event.target).value)"
                           [attr.aria-label]="'Amount to apply from ' + r.refNo" />
                    <button appBtn size="sm" [loading]="busy()" (click)="apply(r)">Apply</button>
                  </div>
                }
              }
            </div>
          </div>
        } @empty {
          <p class="lead">No money received yet.</p>
        }

        @if (canWrite()) {
          <h3>Record money received</h3>
          <form class="grid" [formGroup]="rem" (ngSubmit)="remit()">
            <app-field label="Date" [required]="true"><input type="date" formControlName="date" [max]="todayIso" /></app-field>
            <app-field label="Currency">
              <select formControlName="currency">
                @for (c of store.currencies(); track c.code) {
                  <option [value]="c.code">{{ c.code }}</option>
                }
              </select>
            </app-field>
            <app-field label="Amount sent" [required]="true"><input type="number" formControlName="amount" min="0" step="any" /></app-field>
            <app-field label="Bank fees deducted"><input type="number" formControlName="fees" min="0" step="any" /></app-field>
            <app-field label="Rate (PKR per 1)" [required]="true"><input type="number" formControlName="fxRate" min="0" step="any" /></app-field>
            <app-field label="Method" [required]="true">
              <select formControlName="method">
                @for (m of methods(); track m) {
                  <option [value]="m">{{ m }}</option>
                }
              </select>
            </app-field>
            <app-field label="Bank reference"><input type="text" formControlName="bankRef" maxlength="80" placeholder="MT103 / LC no." /></app-field>
            @if (acc.distributor.bankAccounts.length) {
              <app-field label="From account" [required]="true">
                <select formControlName="bankIndex">
                  @for (b of acc.distributor.bankAccounts; track b.index) {
                    <option [value]="b.index">{{ b.label }}{{ b.verified ? '' : ' (not verified)' }}</option>
                  }
                </select>
              </app-field>
            }
            <app-field label="Note" [wide]="true"><input type="text" formControlName="note" maxlength="1000" /></app-field>
            @if (openIn(rem.controls.currency.value).length) {
              <div style="grid-column: 1 / -1">
                <small class="lead">Apply to invoices (what is left stays as the distributor's credit)</small>
                @for (o of openIn(rem.controls.currency.value); track o.id) {
                  <div class="row">
                    <span>{{ o.refNo }} · {{ amt(o.due) }} open{{ o.overdue ? ' · overdue' : '' }}</span>
                    <input class="amt" type="number" min="0" step="any" [value]="alloc()[o.id] ?? ''" (input)="setAlloc(o.id, $any($event.target).value)"
                           [attr.aria-label]="'Apply to ' + o.refNo" />
                  </div>
                }
                <div class="row"><button appBtn type="button" size="sm" (click)="oldestFirst()">Apply oldest first</button></div>
              </div>
            }
            <div><button appBtn type="submit" variant="primary" size="sm" icon="check" [loading]="busy()">Record</button></div>
          </form>
        }

        <h3>Statement</h3>
        <div class="scroll">
          <table class="t" aria-label="Statement">
            <thead><tr><th>Date</th><th>Ref</th><th>Detail</th><th class="num">Invoiced</th><th class="num">Received</th><th class="num">Balance</th></tr></thead>
            <tbody>
              @for (l of acc.statement; track $index) {
                <tr>
                  <td>{{ date(l.date) }}</td><td>{{ l.ref }}</td><td>{{ l.text }}</td>
                  <td class="num">{{ l.debit ? l.currency + ' ' + amt(l.debit) : '' }}</td>
                  <td class="num">{{ l.credit ? l.currency + ' ' + amt(l.credit) : '' }}</td>
                  <td class="num">{{ l.currency }} {{ amt(l.balance) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6">Nothing yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-offcanvas>
  `,
})
export class AccountPanel {
  private api = inject(ExportsApi);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);
  protected store = inject(SettingsStore);

  readonly open = model(false);
  readonly distributorId = input<string | null>(null);
  readonly changed = output<void>();

  protected a = signal<DistributorAccount | null>(null);
  protected busy = signal(false);
  protected reasons = signal<Partial<Record<string, string>>>({});
  protected alloc = signal<Partial<Record<string, string>>>({});
  protected applyTo = signal<Partial<Record<string, string>>>({});
  protected applyAmt = signal<Partial<Record<string, string>>>({});
  protected todayIso = today();

  private role = computed(() => this.auth.user()?.role ?? '');
  protected finance = computed(() => ['Admin', 'Finance'].includes(this.role()));
  protected canWrite = computed(() => ['Admin', 'Finance', 'Exports'].includes(this.role()));
  /** the distributor's agreed methods, else every remittance method in Settings */
  protected methods = computed(() => {
    const agreed = this.a()?.distributor.settlementMethods ?? [];
    return agreed.length ? agreed : this.store.options('REMITTANCE_METHOD');
  });

  protected amt = (v: number) => fmtAmount2(v);
  protected pkr = (v: number) => fmtMoney(v);
  protected date = (d: string) => fmtDate(d);
  protected allocText = (r: Remittance) => r.allocations.map((x) => `${x.shipment} ${fmtAmount2(x.amount)}`).join(', ');
  /** shipped invoices still open in a currency, oldest first */
  protected openIn = (currency: string): ExportRow[] =>
    (this.a()?.orders ?? []).filter((o) => o.status === 'Shipped' && o.currency === currency && o.due > 0.004)
      .sort((x, y) => (x.dueDate ?? x.date).localeCompare(y.dueDate ?? y.date));

  protected rem = this.fb.nonNullable.group({
    date: [today()], currency: ['USD'], amount: [null as number | null], fees: [0], fxRate: [280], method: [''], bankRef: [''],
    bankIndex: ['0'], note: [''],
  });

  constructor() {
    effect(() => {
      const id = this.distributorId();
      if (!this.open() || !id) return;
      untracked(() => this.load(id, true));
    });
    // a currency fills today's rate
    this.rem.controls.currency.valueChanges.subscribe((c) => {
      const r = this.store.currencies().find((x) => x.code === c)?.rate;
      if (r) this.rem.controls.fxRate.setValue(Number(r));
      this.alloc.set({});
    });
  }

  private load(id: string, fresh = false) {
    this.api.account(id).subscribe({
      next: (acc) => {
        this.a.set(acc);
        if (fresh) this.resetForm(acc);
      },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  private resetForm(acc: DistributorAccount) {
    const cur = acc.distributor.invoiceCurrency ?? 'USD';
    this.rem.reset({
      date: today(), currency: cur, amount: null, fees: 0, fxRate: Number(this.store.currencies().find((c) => c.code === cur)?.rate ?? 1),
      method: (acc.distributor.settlementMethods[0] ?? this.store.options('REMITTANCE_METHOD')[0]) ?? '', bankRef: '',
      bankIndex: String(acc.distributor.bankAccounts.find((b) => b.verified)?.index ?? 0), note: '',
    });
    this.alloc.set({});
    this.reasons.set({});
    this.applyTo.set({});
    this.applyAmt.set({});
  }

  protected setReason(id: string, v: string) { this.reasons.update((m) => ({ ...m, [id]: v })); }
  protected setAlloc(id: string, v: string) { this.alloc.update((m) => ({ ...m, [id]: v })); }
  protected setApplyTo(id: string, v: string) { this.applyTo.update((m) => ({ ...m, [id]: v })); }
  protected setApplyAmt(id: string, v: string) { this.applyAmt.update((m) => ({ ...m, [id]: v })); }

  /** spread the amount over the open invoices, oldest first */
  protected oldestFirst() {
    let left = Number(this.rem.controls.amount.value) || 0;
    const out: Partial<Record<string, string>> = {};
    for (const o of this.openIn(this.rem.controls.currency.value)) {
      if (left <= 0) break;
      const take = Math.min(left, o.due);
      out[o.id] = String(Math.round(take * 100) / 100);
      left -= take;
    }
    this.alloc.set(out);
  }

  protected override(o: ExportRow) {
    const reason = (this.reasons()[o.id] ?? '').trim();
    this.run(this.api.creditOverride(o.id, reason), () => {
      this.toast.success(`${o.refNo} may ship over the credit check.`);
      this.load(this.distributorId()!);
    });
  }

  protected remit() {
    const acc = this.a();
    if (!acc) return;
    const v = this.rem.getRawValue();
    if (!v.amount) {
      this.toast.error('Enter the amount sent.');
      return;
    }
    const allocations = Object.entries(this.alloc()).map(([shipmentId, a]) => ({ shipmentId, amount: Number(a) })).filter((x) => x.amount > 0);
    this.run(this.api.remit(acc.distributor.id, {
      date: v.date, currency: v.currency, amount: Number(v.amount), fees: Number(v.fees) || 0, fxRate: Number(v.fxRate), method: v.method,
      bankRef: v.bankRef.trim() || undefined, note: v.note.trim() || undefined, allocations,
      ...(acc.distributor.bankAccounts.length ? { bankIndex: Number(v.bankIndex) } : {}),
    }), (next) => {
      this.toast.success('Money recorded.');
      this.a.set(next);
      this.resetForm(next);
    });
  }

  protected apply(r: Remittance) {
    const shipmentId = this.applyTo()[r.id];
    const amount = Number(this.applyAmt()[r.id]);
    if (!shipmentId || !(amount > 0)) {
      this.toast.error('Choose an invoice and an amount.');
      return;
    }
    this.run(this.api.allocate(this.distributorId()!, r.id, { allocations: [{ shipmentId, amount }] }), (next) => {
      this.toast.success(`Applied from ${r.refNo}.`);
      this.a.set(next);
      this.applyTo.update((m) => ({ ...m, [r.id]: '' }));
      this.applyAmt.update((m) => ({ ...m, [r.id]: '' }));
    });
  }

  private run<T>(req: import('rxjs').Observable<T>, done: (v: T) => void) {
    this.busy.set(true);
    req.subscribe({
      next: (v) => {
        this.busy.set(false);
        done(v);
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
