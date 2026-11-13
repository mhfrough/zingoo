import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Tone } from '../../shared/format';
import { Btn, Field, Offcanvas, Select, SelectOption, Tag, ToastService } from '../../ui';
import { Distributor, DistributorPrice, Product } from '../ops/models';

const UNITS = ['Pack', 'Dozen', 'Bundle', 'Container', 'Pallet', 'Metric tonne'] as const;
const STATUS_TONE: Record<string, Tone> = { Active: 'success', 'Pending approval': 'warning', Rejected: 'danger' };
const today = () => new Date().toISOString().slice(0, 10);

/** what one pack costs Zen Foods in PKR (mirrors the server) */
const costPerPack = (p: Product) =>
  Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate) + Number(p.outboundRate ?? 0);

/**
 * An international distributor's commercial set-up (the client's spec, sections 3 and 4): the credit Finance approves,
 * the bank accounts Finance verifies, and the price list per SKU (versions, currency, unit, discount, dates, margin
 * against the floor, approvals).
 */
@Component({
  selector: 'app-commercial-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Tag, Select],
  styles: `
    h3 {
      margin: var(--space-5) 0 var(--space-2);
      font-size: var(--text-md);

      &:first-child {
        margin-block-start: 0;
      }
    }

    p.lead {
      margin: 0 0 var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-2);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
      gap: var(--space-3);
      align-items: end;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-block-start: var(--space-3);
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

      & td:first-child,
      & td:nth-child(6) {
        white-space: nowrap;
      }
    }

    .bank {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-block-end: var(--space-2);
      font-size: var(--text-sm);

      & small {
        display: block;
        color: var(--text-3);
      }
    }

    .preview {
      grid-column: 1 / -1;
      margin: 0;
      font-size: var(--text-sm);
      color: var(--text-2);

      &[data-low] {
        color: var(--danger);
      }
    }

    .check {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      block-size: var(--control-h);
      font-size: var(--text-sm);
    }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="'Credit & prices · ' + (d()?.name ?? '')" [subtitle]="d()?.code ?? 'International distributor'" size="lg">
      @if (d(); as dist) {
        <h3>Credit</h3>
        <p class="lead">
          @if (dist.creditApprovedBy) {
            {{ dist.creditCurrency }} {{ num(dist.creditLimit) }}{{ dist.creditExpiry ? ' until ' + dist.creditExpiry : '' }} ·
            {{ dist.creditControl === 'Warn' ? 'warn' : 'block' }} when passed or overdue · approved by {{ dist.creditApprovedBy }}
            {{ dist.creditApprovedAt ? 'on ' + day(dist.creditApprovedAt) : '' }}
          } @else {
            No credit approved: advance only.
          }
        </p>
        @if (finance()) {
          <form class="grid" [formGroup]="credit" (ngSubmit)="saveCredit()">
            <app-field label="Credit limit" hint="0 = advance only"><input type="number" formControlName="creditLimit" min="0" step="1" /></app-field>
            <app-field label="Currency"><app-select formControlName="creditCurrency" [options]="currencyOptions()" [clearable]="false" /></app-field>
            <app-field label="Expires"><input type="date" formControlName="creditExpiry" /></app-field>
            <app-field label="When passed">
              <select formControlName="creditControl">
                <option value="Block">Block the order</option>
                <option value="Warn">Warn only</option>
              </select>
            </app-field>
            <div><button appBtn type="submit" variant="primary" size="sm" [loading]="busy()">Approve credit</button></div>
          </form>
        }

        <h3>Bank accounts</h3>
        @for (b of dist.bankAccounts ?? []; track $index; let i = $index) {
          <div class="bank">
            <div>
              <strong>{{ b.bankName }}{{ b.isDefault ? ' · default' : '' }}</strong>
              <small>{{ b.beneficiary }} · {{ b.iban || b.account }}{{ b.swift ? ' · ' + b.swift : '' }}{{ b.currency ? ' · ' + b.currency : '' }}</small>
            </div>
            @if (b.verifiedAt) {
              <app-tag tone="success">Verified by {{ b.verifiedBy }} · {{ day(b.verifiedAt) }}</app-tag>
            } @else if (finance()) {
              <button appBtn size="sm" [loading]="busy()" (click)="verify(i)">Mark verified</button>
            } @else {
              <app-tag tone="warning">Not verified</app-tag>
            }
          </div>
        } @empty {
          <p class="lead">No bank accounts yet. Add them in the distributor form.</p>
        }

        <h3>Price list</h3>
        <p class="lead">Prices are never overwritten: a new version closes the one before it. Under the {{ num(dist.minMarginPct ?? 0) }}% margin floor, or a promotional price, Finance approves.</p>
        <div class="scroll">
          <table class="t" aria-label="Price versions">
            <thead>
              <tr><th>SKU</th><th>Unit</th><th class="num">Price</th><th class="num">PKR / pack</th><th class="num">Margin</th><th>Dates</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              @for (r of prices(); track r.id) {
                <tr>
                  <td>{{ r.product.sku }} <small>v{{ r.version }}{{ r.promo ? ' · promo' : '' }}{{ r.current ? ' · applies today' : '' }}</small></td>
                  <td>{{ r.unit }} <small>{{ num(r.packsPerUnit) }} packs</small></td>
                  <td class="num">{{ r.currency }} {{ money(r.price) }}<small>{{ r.discountPct ? '−' + r.discountPct + '% = ' + money(r.netPerUnit) : '' }}</small></td>
                  <td class="num">{{ money(r.pkrPerPack) }}<small>cost {{ money(r.costPerPack) }}</small></td>
                  <td class="num">{{ r.marginPct }}%</td>
                  <td>{{ r.effectiveFrom }}<small>{{ r.effectiveTo ? 'to ' + r.effectiveTo : 'open' }}</small></td>
                  <td><app-tag [tone]="tone(r.status)">{{ r.status }}</app-tag>
                    <small>{{ r.createdBy }}{{ r.decidedBy ? ' · ' + r.decidedBy : '' }}{{ r.decisionNote ? ' · ' + r.decisionNote : '' }}</small></td>
                  <td>
                    @if (r.status === 'Pending approval' && finance()) {
                      <div class="actions">
                        <button appBtn size="sm" variant="primary" [loading]="busy()" (click)="decide(r, 'approve')">Approve</button>
                        <button appBtn size="sm" variant="danger" [loading]="busy()" [disabled]="!note().trim()" (click)="decide(r, 'reject')">Reject</button>
                      </div>
                    }
                    @if (r.status !== 'Active' && canPrice()) {
                      <button appBtn size="sm" variant="ghost" icon="trash" iconOnly [attr.aria-label]="'Delete version ' + r.version" (click)="remove(r)"></button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8">No prices yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (finance() && hasPending()) {
          <app-field label="Note for the approval or rejection" [wide]="true">
            <input type="text" [value]="note()" (input)="note.set($any($event.target).value)" maxlength="500" placeholder="Needed to reject" />
          </app-field>
        }

        @if (canPrice()) {
          <h3>New price version</h3>
          @if (!productOptions().length) {
            <p class="lead">Approve products for this distributor in its form first.</p>
          } @else {
            <form class="grid" [formGroup]="price" (ngSubmit)="addPrice()">
              <app-field label="Product" [required]="true"><app-select formControlName="productId" [options]="productOptions()" [clearable]="false" /></app-field>
              <app-field label="Unit">
                <select formControlName="unit">
                  @for (u of units; track u) {
                    <option [value]="u">{{ u }}</option>
                  }
                </select>
              </app-field>
              @if (needsFactor()) {
                <app-field label="Packs per unit" [required]="true"><input type="number" formControlName="packsPerUnit" min="1" step="1" /></app-field>
              }
              <app-field label="Currency"><app-select formControlName="currency" [options]="currencyOptions()" [clearable]="false" /></app-field>
              <app-field label="Price per unit" [required]="true"><input type="number" formControlName="price" min="0" step="any" /></app-field>
              <app-field label="Discount (%)"><input type="number" formControlName="discountPct" min="0" max="100" step="0.5" /></app-field>
              <app-field label="From" [required]="true"><input type="date" formControlName="effectiveFrom" /></app-field>
              <app-field label="To"><input type="date" formControlName="effectiveTo" /></app-field>
              <app-field label="Minimum order (units)"><input type="number" formControlName="moq" min="0" step="1" /></app-field>
              <app-field label="Order multiple"><input type="number" formControlName="increment" min="0" step="1" /></app-field>
              <label class="check"><input type="checkbox" formControlName="promo" /> Promotional / sample price</label>
              <app-field label="Note" [wide]="true"><input type="text" formControlName="note" maxlength="300" /></app-field>
              @if (preview(); as pv) {
                <p class="preview" [attr.data-low]="pv.low ? '' : null">
                  {{ pv.packs }} packs per unit · PKR {{ money(pv.pkrPerPack) }} a pack against a cost of {{ money(pv.cost) }} · margin {{ pv.margin }}%
                  {{ pv.low ? '· under the floor: Finance must approve' : '' }}
                </p>
              }
              <div><button appBtn type="submit" variant="primary" size="sm" icon="plus" [loading]="busy()">Add version</button></div>
            </form>
          }
        }
      }
    </app-offcanvas>
  `,
})
export class CommercialPanel {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private store = inject(SettingsStore);
  private fb = inject(FormBuilder);

  readonly open = model(false);
  readonly distributor = input<Distributor | null>(null);
  readonly products = input<Product[]>([]);
  /** the distributor or its prices changed */
  readonly changed = output<void>();

  /** the distributor as last saved here (credit and bank answers replace it) */
  protected d = signal<Distributor | null>(null);
  protected prices = signal<DistributorPrice[]>([]);
  protected busy = signal(false);
  protected note = signal('');
  protected units = UNITS;

  private role = computed(() => this.auth.user()?.role ?? '');
  protected finance = computed(() => ['Admin', 'Finance'].includes(this.role()));
  protected canPrice = computed(() => ['Admin', 'Distribution', 'Exports', 'Finance'].includes(this.role()));
  protected hasPending = computed(() => this.prices().some((p) => p.status === 'Pending approval'));
  protected tone = (s: string) => STATUS_TONE[s] ?? 'neutral';
  protected num = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString();
  protected money = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  protected day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

  protected currencyOptions = computed<SelectOption<string>[]>(() => this.store.currencies().map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })));
  protected productOptions = computed<SelectOption<string>[]>(() => {
    const ok = new Set(this.d()?.approvedProductIds ?? []);
    return this.products().filter((p) => ok.has(p.id)).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }));
  });

  protected credit = this.fb.nonNullable.group({ creditLimit: [0], creditCurrency: ['USD'], creditExpiry: [''], creditControl: ['Block'] });
  protected price = this.fb.nonNullable.group({
    productId: [''], unit: ['Bundle'], packsPerUnit: [null as number | null], currency: ['USD'], price: [null as number | null],
    discountPct: [0], effectiveFrom: [today()], effectiveTo: [''], moq: [0], increment: [0], promo: [false], note: [''],
  });
  private priceValue = toSignal(this.price.valueChanges, { initialValue: this.price.getRawValue() });
  protected needsFactor = computed(() => ['Pallet', 'Metric tonne'].includes(this.priceValue().unit ?? ''));

  /** packs per unit, PKR per pack, cost and margin of the price being typed */
  protected preview = computed(() => {
    const v = this.priceValue();
    const p = this.products().find((x) => x.id === v.productId);
    const cur = this.store.currencies().find((c) => c.code === v.currency);
    if (!p || !cur || !v.price) return null;
    const packs = v.unit === 'Pack' ? 1 : v.unit === 'Dozen' ? 12 : v.unit === 'Bundle' ? p.packsPerCarton
      : v.unit === 'Container' ? p.packsPerCarton * p.bundlesPerContainer : Number(v.packsPerUnit) || 0;
    if (!packs) return null;
    const pkrPerPack = (Number(v.price) * (1 - (Number(v.discountPct) || 0) / 100) * Number(cur.rate)) / packs;
    const cost = costPerPack(p);
    const margin = pkrPerPack > 0 ? Math.round(((pkrPerPack - cost) / pkrPerPack) * 10000) / 100 : -100;
    const floor = Number(this.d()?.minMarginPct ?? 0);
    return { packs, pkrPerPack, cost, margin, low: !!v.promo || (floor > 0 && margin < floor) };
  });

  constructor() {
    effect(() => {
      const dist = this.distributor();
      if (!this.open() || !dist) return;
      untracked(() => {
        this.d.set(dist);
        this.note.set('');
        const cur = dist.invoiceCurrency ?? 'USD';
        this.credit.reset({
          creditLimit: Number(dist.creditLimit ?? 0), creditCurrency: dist.creditCurrency ?? cur,
          creditExpiry: dist.creditExpiry ?? '', creditControl: dist.creditControl ?? 'Block',
        });
        this.price.reset({
          productId: dist.approvedProductIds?.[0] ?? '', unit: 'Bundle', packsPerUnit: null, currency: cur, price: null,
          discountPct: 0, effectiveFrom: today(), effectiveTo: '', moq: 0, increment: 0, promo: false, note: '',
        });
        this.loadPrices(dist.id);
      });
    });
  }

  private loadPrices(id: string) {
    this.api.get<DistributorPrice[]>(`distributors/${id}/prices`).subscribe({
      next: (rows) => this.prices.set(rows),
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected saveCredit() {
    const dist = this.d();
    if (!dist) return;
    const v = this.credit.getRawValue();
    this.run(this.api.put<Distributor>(`distributors/${dist.id}/credit`, {
      creditLimit: Number(v.creditLimit) || 0, creditCurrency: v.creditCurrency, creditExpiry: v.creditExpiry || null, creditControl: v.creditControl,
    }), (row) => {
      this.d.set(row);
      this.toast.success('Credit approved.');
    });
  }

  protected verify(index: number) {
    const dist = this.d();
    if (!dist) return;
    this.run(this.api.post<Distributor>(`distributors/${dist.id}/banks/${index}/verify`, {}), (row) => {
      this.d.set(row);
      this.toast.success('Bank account verified.');
    });
  }

  protected addPrice() {
    const dist = this.d();
    if (!dist) return;
    const v = this.price.getRawValue();
    if (!v.productId || !v.price) {
      this.toast.error('Choose a product and enter a price.');
      return;
    }
    this.run(this.api.post<DistributorPrice>(`distributors/${dist.id}/prices`, {
      productId: v.productId, unit: v.unit, packsPerUnit: this.needsFactor() ? Number(v.packsPerUnit) || undefined : undefined,
      currency: v.currency, price: Number(v.price), discountPct: Number(v.discountPct) || 0, effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo || null, moq: Number(v.moq) || 0, increment: Number(v.increment) || 0, promo: v.promo, note: v.note.trim() || null,
    }), (row) => {
      this.toast.success(row.status === 'Active' ? `Version ${row.version} is active.` : `Version ${row.version} waits for Finance (margin ${row.marginPct}%).`);
      this.price.patchValue({ price: null, note: '', promo: false, effectiveTo: '' });
      this.loadPrices(dist.id);
    });
  }

  protected decide(r: DistributorPrice, step: 'approve' | 'reject') {
    const dist = this.d();
    if (!dist) return;
    this.run(this.api.post<DistributorPrice>(`distributors/${dist.id}/prices/${r.id}/${step}`, { note: this.note().trim() || undefined }), (row) => {
      this.toast.success(`Version ${row.version}: ${row.status.toLowerCase()}.`);
      this.note.set('');
      this.loadPrices(dist.id);
    });
  }

  protected remove(r: DistributorPrice) {
    const dist = this.d();
    if (!dist) return;
    this.run(this.api.delete(`distributors/${dist.id}/prices/${r.id}`), () => {
      this.toast.success('Price removed.');
      this.loadPrices(dist.id);
    });
  }

  private run<T>(req: import('rxjs').Observable<T>, done: (row: T) => void) {
    this.busy.set(true);
    req.subscribe({
      next: (row) => {
        this.busy.set(false);
        done(row);
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
