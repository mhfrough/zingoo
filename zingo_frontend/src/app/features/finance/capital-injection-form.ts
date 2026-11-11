import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { AttachmentMeta } from '../../core/attachments.api';
import { fmtMoney } from '../../shared/format';
import { isChequeMethod } from '../../shared/payments';
import { Btn, Field, FileInput, MoneyInput, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
/** the largest gap between two amounts that still counts as equal (rounding of percentages) */
const SLACK = 0.05;

type Basis = 'amount' | 'pct';

/** One stream an investor's money goes against; the last edited of amount / percent is the one that is kept exact. */
const streamGroup = (fb: NonNullableFormBuilder, stream = '', amount = 0, pct = 100, by: Basis = 'pct') =>
  fb.group({ stream: [stream, Validators.required], amount: [amount], pct: [pct], by: [by] });

/** One investor with everything about their payment. */
const investorGroup = (fb: NonNullableFormBuilder, stream: string, funding: string) =>
  fb.group({
    party: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    pct: [0],
    by: ['amount' as Basis],
    funding: [funding],
    date: [today(), Validators.required],
    paymentSource: ['Bank Transfer'],
    paymentReference: [''],
    paymentAgainst: [''],
    paidBy: [''],
    receivedBy: [''],
    issueDate: [''],
    expectedReturnDate: [''],
    chequeNo: [''],
    clearanceDate: [''],
    proof: [null as AttachmentMeta | null],
    streams: fb.array([streamGroup(fb, stream, 0, 100, 'pct')]),
  });

type InvestorForm = ReturnType<typeof investorGroup>;
type StreamForm = ReturnType<typeof streamGroup>;

/**
 * Capital injection: one investor, or several investing together. Each investor has their own amount (and share of
 * the total), payment details, cheque and proof, and says which streams the money is invested against, by amount or
 * by percent. The terms and the agreement are shared. One finance entry is created per investor.
 */
@Component({
  selector: 'app-capital-injection-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, MoneyInput, FileInput],
  styles: `
    .investors {
      display: contents;
    }

    .sum--line {
      grid-column: 1 / -1;
    }

    .investor {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-sunken);
    }

    .investor__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);

      & h3 {
        margin: 0;
        font-size: var(--text-md);
      }
    }

    .investor__section {
      grid-column: 1 / -1;
      margin: 0;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    /* streams: stream, amount, percent, remove. On a narrow panel the stream takes its own line. */
    .streams {
      grid-column: 1 / -1;
      container-type: inline-size;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      align-items: flex-start;

      & .streams__head,
      & .stream-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(9.5rem, 13rem) minmax(5rem, 6.5rem) var(--btn-h-sm);
        gap: var(--space-2);
        inline-size: 100%;
        align-items: center;
      }

      & .streams__head {
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
      }

      & .cell {
        min-inline-size: 0;
      }

      & .cell__cap {
        display: none;
        margin-block-end: var(--space-1);
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
      }
    }

    @container (max-width: 36rem) {
      .streams .streams__head {
        display: none;
      }

      .streams .stream-row {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--btn-h-sm);
        align-items: end;
      }

      .streams .cell--stream {
        grid-column: 1 / -1;
      }

      .streams .cell__cap {
        display: block;
      }
    }

    .add-row {
      grid-column: 1 / -1;
      display: flex;
      gap: var(--space-2);
    }

    .sum {
      font-size: var(--text-xs);
      color: var(--text-3);

      &[data-bad] {
        color: var(--danger);
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" title="New capital injection" subtitle="One investor or several. Amounts are in PKR."
                   size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Investment type" [required]="true">
          <select formControlName="mode" (change)="onMode()">
            <option value="solo">Solo investor</option>
            <option value="shared">Shared investment</option>
          </select>
        </app-field>
        @if (shared()) {
          <app-field label="Total amount" [required]="true" hint="All investors together">
            <app-money-input formControlName="total" (input)="onTotal()" />
          </app-field>
        }

        <div class="investors" formArrayName="investors">
          @for (inv of investors.controls; track inv; let i = $index) {
            <div class="investor" [formGroupName]="i">
              <div class="investor__head">
                <h3>{{ shared() ? 'Investor ' + (i + 1) : 'Investor' }}</h3>
                @if (shared() && investors.length > 2) {
                  <button appBtn type="button" size="sm" variant="ghost" icon="x" (click)="removeInvestor(i)">Remove</button>
                }
              </div>
              <div class="form-grid">
                <app-field label="Investor name" [required]="true" [error]="bad(inv, 'party') ? 'Enter the investor name' : null">
                  <input type="text" formControlName="party" placeholder="Name" />
                </app-field>
                <app-field label="Amount invested" [required]="true" [error]="bad(inv, 'amount') ? 'Enter an amount above zero' : null">
                  <app-money-input formControlName="amount" [max]="investorMax()" (input)="onAmount(inv)" />
                </app-field>
                @if (shared()) {
                  <app-field label="Share of total" hint="Type a % instead of the amount">
                    <app-money-input formControlName="pct" currency="" [decimals]="2" [max]="100" (input)="onPct(inv)" />
                  </app-field>
                }
                <app-field label="Capital source">
                  <select formControlName="funding">
                    @for (c of sources(); track c) {
                      <option [value]="c">{{ c }}</option>
                    }
                  </select>
                </app-field>
                <app-field label="Investment date" [required]="true"><input type="date" formControlName="date" /></app-field>
                <app-field label="Payment source">
                  <select formControlName="paymentSource">
                    @for (m of methods(); track m) {
                      <option [value]="m">{{ m }}</option>
                    }
                  </select>
                </app-field>

                <h4 class="investor__section">Invested against</h4>
                <div class="streams" formArrayName="streams">
                  <span class="sum" [attr.data-bad]="streamGap(inv) ? '' : null">{{ streamText(inv) }}</span>
                  <div class="streams__head" aria-hidden="true"><span>Stream</span><span>Amount (PKR)</span><span>%</span><span></span></div>
                  @for (s of inv.controls.streams.controls; track s; let si = $index) {
                    <div class="stream-row" [formGroupName]="si">
                      <div class="cell cell--stream">
                        <span class="cell__cap" aria-hidden="true">Stream</span>
                        <div class="field"><div class="field__control">
                          <select formControlName="stream" [attr.aria-label]="'Stream, investor ' + (i + 1) + ', line ' + (si + 1)">
                            <option value="">Choose a stream</option>
                            @for (o of streamOptions(); track o.name) {
                              <option [value]="o.name" [disabled]="usedElsewhere(inv, s, o.name)">{{ o.name }}{{ o.type ? ' · ' + o.type : '' }}</option>
                            }
                          </select>
                        </div></div>
                      </div>
                      <div class="cell">
                        <span class="cell__cap" aria-hidden="true">Amount (PKR)</span>
                        <div class="field"><div class="field__control">
                          <app-money-input formControlName="amount" currency="" [max]="amountMax(inv)" (input)="onStreamAmount(inv, s)"
                            [ariaLabel]="'Stream amount, investor ' + (i + 1) + ', line ' + (si + 1)" />
                        </div></div>
                      </div>
                      <div class="cell">
                        <span class="cell__cap" aria-hidden="true">%</span>
                        <div class="field"><div class="field__control">
                          <app-money-input formControlName="pct" currency="" [decimals]="2" [max]="100" (input)="onStreamPct(inv, s)"
                            [ariaLabel]="'Stream percent, investor ' + (i + 1) + ', line ' + (si + 1)" />
                        </div></div>
                      </div>
                      <button appBtn type="button" size="sm" variant="ghost" icon="x" [disabled]="inv.controls.streams.length <= 1"
                              [attr.aria-label]="'Remove stream line ' + (si + 1)" (click)="removeStream(inv, si)"></button>
                    </div>
                  }
                  <div class="add-row">
                    <button appBtn type="button" size="sm" icon="plus" (click)="addStream(inv)">Add a stream</button>
                  </div>
                </div>

                <h4 class="investor__section">Payment details</h4>
                <app-field label="Payment reference"><input type="text" formControlName="paymentReference" placeholder="Transfer or receipt no." /></app-field>
                <app-field label="Payment against"><input type="text" formControlName="paymentAgainst" placeholder="Agreement or invoice no." /></app-field>
                <app-field label="Payment issued on"><input type="date" formControlName="issueDate" /></app-field>
                <app-field label="Paid by"><input type="text" formControlName="paidBy" /></app-field>
                <app-field label="Received by"><input type="text" formControlName="receivedBy" /></app-field>
                <app-field label="Expected return date" hint="Optional. A reminder, nothing posts"><input type="date" formControlName="expectedReturnDate" /></app-field>
                @if (isCheque(inv)) {
                  <app-field label="Cheque number" [required]="true" [error]="chequeGap(inv, 'chequeNo') ? 'Enter the cheque number' : null">
                    <input type="text" formControlName="chequeNo" />
                  </app-field>
                  <app-field label="Clearance date" [required]="true" hint="Counts as cash once it clears"
                             [error]="chequeGap(inv, 'clearanceDate') ? 'Enter the clearance date' : null">
                    <input type="date" formControlName="clearanceDate" />
                  </app-field>
                }
                <app-field label="Payment proof" [wide]="true"><app-file-input formControlName="proof" label="Attach proof" /></app-field>
              </div>
            </div>
          }
        </div>

        @if (shared()) {
          <div class="add-row">
            <button appBtn type="button" size="sm" icon="plus" [disabled]="investors.length >= 20" (click)="addInvestor()">Add another investor</button>
            <span class="sum" [attr.data-bad]="totalGap() ? '' : null">{{ totalText() }}</span>
          </div>
        } @else {
          <span class="sum sum--line">Total {{ money(summary().allocated) }}</span>
        }

        <app-field label="Terms" [wide]="true"><textarea formControlName="note" placeholder="Optional. Return, profit share, repayment"></textarea></app-field>
        <app-field label="Agreement" [wide]="true" hint="Optional. One agreement serves every investor">
          <app-file-input formControlName="agreement" label="Upload agreement" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Record capital</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CapitalInjectionForm extends FormModal {
  /** the streams offered as "invested against", with their type */
  readonly streams = input<{ name: string; type: string }[]>([]);
  readonly formId = 'form-capital-injection';
  protected money = fmtMoney;
  private store = inject(SettingsStore);
  protected methods = this.store.paymentMethods;
  /** capital sources from Settings (Equity, Shareholder Loan, Partner Advance ...) */
  protected sources = this.store.capitalSources;
  protected streamOptions = computed(() => this.streams());
  protected streamNames = computed(() => this.streams().map((s) => s.name));
  private fin = inject(FinanceApi);
  private nfb = this.fb.nonNullable;

  readonly form = this.nfb.group({
    mode: ['solo' as 'solo' | 'shared'],
    total: [0],
    note: [''],
    agreement: [null as AttachmentMeta | null],
    investors: this.nfb.array<InvestorForm>([]),
  });

  protected get investors() {
    return this.form.controls.investors;
  }

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected shared = computed(() => this.value().mode === 'shared');
  protected summary = computed(() => {
    const v = this.value();
    const allocated = round2((v.investors ?? []).reduce((n, i) => n + (Number(i?.amount) || 0), 0));
    return { allocated, total: this.shared() ? round2(Number(v.total) || 0) : allocated };
  });
  /** shared: how much of the total is not placed on an investor yet (negative = too much) */
  protected totalGap = computed(() => {
    const s = this.summary();
    const gap = round2(s.total - s.allocated);
    return Math.abs(gap) > SLACK ? gap : 0;
  });

  protected reset() {
    this.form.reset({ mode: 'solo', total: 0, note: '', agreement: null });
    this.investors.clear();
    this.addInvestor();
  }

  // ───────────── investors ─────────────

  protected addInvestor() {
    const sources = this.sources();
    this.investors.push(investorGroup(this.nfb, this.streamNames()[0] ?? '', sources.includes('Equity') ? 'Equity' : sources[0] ?? 'Equity'));
    this.form.markAsDirty();
  }

  protected removeInvestor(i: number) {
    this.investors.removeAt(i);
    this.form.markAsDirty();
  }

  /** solo has one investor; shared starts with two */
  protected onMode() {
    if (this.form.controls.mode.value === 'solo') {
      while (this.investors.length > 1) this.investors.removeAt(this.investors.length - 1);
      const inv = this.investors.at(0);
      inv.controls.by.setValue('amount');
    } else {
      while (this.investors.length < 2) this.addInvestor();
    }
  }

  protected bad(inv: InvestorForm, name: 'party' | 'amount') {
    const c = inv.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected isCheque(inv: InvestorForm) {
    return isChequeMethod(inv.controls.paymentSource.value);
  }

  protected chequeGap(inv: InvestorForm, name: 'chequeNo' | 'clearanceDate') {
    const c = inv.controls[name];
    return this.isCheque(inv) && !c.value.trim() && (c.touched || c.dirty || this.form.touched);
  }

  // ───────────── amount <-> percent ─────────────
  // The shared total is what percents are of. Whichever of amount / percent was typed last is kept exact;
  // the other is worked out from it, also when the total or the investor's amount changes.

  protected onTotal() {
    const total = Number(this.form.controls.total.value) || 0;
    for (const inv of this.investors.controls) this.fromBasis(inv, total);
  }

  protected onAmount(inv: InvestorForm) {
    inv.controls.by.setValue('amount');
    this.fromBasis(inv, Number(this.form.controls.total.value) || 0);
  }

  protected onPct(inv: InvestorForm) {
    inv.controls.by.setValue('pct');
    this.fromBasis(inv, Number(this.form.controls.total.value) || 0);
  }

  private fromBasis(inv: InvestorForm, total: number) {
    if (this.shared()) {
      if (inv.controls.by.value === 'pct') inv.controls.amount.setValue(round2((total * (Number(inv.controls.pct.value) || 0)) / 100));
      else inv.controls.pct.setValue(total > 0 ? round3(((Number(inv.controls.amount.value) || 0) / total) * 100) : 0);
    }
    this.refreshStreams(inv);
  }

  // ───────────── streams ─────────────

  protected addStream(inv: InvestorForm) {
    const base = Number(inv.controls.amount.value) || 0;
    const left = Math.max(0, round2(base - this.streamSum(inv)));
    const unused = this.streamNames().find((n) => !inv.controls.streams.controls.some((s) => s.controls.stream.value === n)) ?? '';
    inv.controls.streams.push(streamGroup(this.nfb, unused, left, base > 0 ? round3((left / base) * 100) : 0, 'amount'));
  }

  protected removeStream(inv: InvestorForm, i: number) {
    inv.controls.streams.removeAt(i);
    this.form.updateValueAndValidity();
  }

  protected onStreamAmount(inv: InvestorForm, s: StreamForm) {
    s.controls.by.setValue('amount');
    const base = Number(inv.controls.amount.value) || 0;
    s.controls.pct.setValue(base > 0 ? round3(((Number(s.controls.amount.value) || 0) / base) * 100) : 0);
  }

  protected onStreamPct(inv: InvestorForm, s: StreamForm) {
    s.controls.by.setValue('pct');
    s.controls.amount.setValue(round2(((Number(inv.controls.amount.value) || 0) * (Number(s.controls.pct.value) || 0)) / 100));
  }

  /** the investor's amount changed: keep each stream's own basis exact and recompute the other number */
  private refreshStreams(inv: InvestorForm) {
    const base = Number(inv.controls.amount.value) || 0;
    for (const s of inv.controls.streams.controls) {
      if (s.controls.by.value === 'pct') s.controls.amount.setValue(round2((base * (Number(s.controls.pct.value) || 0)) / 100));
      else s.controls.pct.setValue(base > 0 ? round3(((Number(s.controls.amount.value) || 0) / base) * 100) : 0);
    }
  }

  private streamSum(inv: InvestorForm) {
    return round2(inv.controls.streams.controls.reduce((n, s) => n + (Number(s.controls.amount.value) || 0), 0));
  }

  /** amount of the investment not placed on a stream yet (negative = too much); 0 when it adds up */
  protected streamGap(inv: InvestorForm) {
    this.value(); // re-read on every change of the form
    const gap = round2((Number(inv.controls.amount.value) || 0) - this.streamSum(inv));
    return Math.abs(gap) > SLACK ? gap : 0;
  }

  /** a stream amount never goes over the investor's amount (no cap while that is still empty) */
  protected amountMax(inv: InvestorForm): number | null {
    const base = Number(inv.controls.amount.value) || 0;
    return base > 0 ? base : null;
  }

  /** an investor never puts in more than the total of a shared investment */
  protected investorMax(): number | null {
    const total = Number(this.form.controls.total.value) || 0;
    return this.shared() && total > 0 ? total : null;
  }

  protected streamText(inv: InvestorForm): string {
    const gap = this.streamGap(inv);
    return gap ? `${fmtMoney(Math.abs(gap))} ${gap > 0 ? 'left to place' : 'too much'}` : 'Fully placed.';
  }

  protected totalText(): string {
    const gap = this.totalGap();
    const s = this.summary();
    return `Added up ${fmtMoney(s.allocated)} of ${fmtMoney(s.total)}` + (gap ? ` · ${fmtMoney(Math.abs(gap))} ${gap > 0 ? 'left to place' : 'too much'}` : ' · matches.');
  }

  protected usedElsewhere(inv: InvestorForm, current: StreamForm, name: string) {
    return inv.controls.streams.controls.some((s) => s !== current && s.controls.stream.value === name);
  }

  // ───────────── save ─────────────

  /** the first thing wrong that the field rules cannot show, or null */
  private problem(): string | null {
    const v = this.form.getRawValue();
    if (v.mode === 'shared') {
      if (v.investors.length < 2) return 'Add at least two investors for a shared investment.';
      if (!(Number(v.total) > 0)) return 'Enter the total amount of the shared investment.';
      if (this.totalGap()) return `The investors add up to ${fmtMoney(this.summary().allocated)} but the total is ${fmtMoney(this.summary().total)}.`;
    }
    for (const [n, inv] of this.investors.controls.entries()) {
      const say = (msg: string) => (v.mode === 'shared' ? `Investor ${n + 1}: ${msg}` : msg);
      if (this.streamGap(inv)) return say(`The streams must add up to ${fmtMoney(Number(inv.controls.amount.value))} (${fmtMoney(Math.abs(this.streamGap(inv)))} ${this.streamGap(inv) > 0 ? 'left to place' : 'too much'}).`);
      if (inv.controls.streams.controls.some((s) => !s.controls.stream.value)) return say('Choose a stream on every line.');
      if (this.isCheque(inv)) {
        if (!inv.controls.chequeNo.value.trim()) return say('Enter the cheque number.');
        if (!inv.controls.clearanceDate.value) return say('Enter the cheque clearance date.');
        if (inv.controls.clearanceDate.value < inv.controls.date.value) return say('The cheque cannot clear before the investment date.');
      }
      const back = inv.controls.expectedReturnDate.value;
      if (back && back < inv.controls.date.value) return say('The expected return date cannot be before the investment date.');
    }
    return null;
  }

  protected override submit() {
    this.form.markAllAsTouched();
    const p = this.problem();
    if (p) {
      this.error.set(p);
      return;
    }
    super.submit();
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.fin.saveCapital({
      note: v.note.trim() || undefined,
      investors: v.investors.map((i) => {
        const cheque = isChequeMethod(i.paymentSource);
        return {
          party: i.party.trim(), amount: i.amount, date: i.date, funding: i.funding, paymentSource: i.paymentSource,
          paymentReference: i.paymentReference, paymentAgainst: i.paymentAgainst, paidBy: i.paidBy, receivedBy: i.receivedBy,
          issueDate: i.issueDate || undefined, expectedReturnDate: i.expectedReturnDate || undefined,
          chequeNo: cheque ? i.chequeNo : undefined, clearanceDate: cheque ? i.clearanceDate : undefined,
          proofId: i.proof?.id, agreementId: v.agreement?.id,
          streams: i.streams.map((s) => ({ stream: s.stream, amount: s.amount })),
        };
      }),
    });
  }

  protected successMessage() {
    const v = this.form.getRawValue();
    const cheques = v.investors.filter((i) => isChequeMethod(i.paymentSource)).length;
    const base = v.investors.length > 1 ? `Shared investment recorded for ${v.investors.length} investors.` : 'Capital injection recorded.';
    return cheques ? `${base} ${cheques > 1 ? 'Cheques count' : 'The cheque counts'} as cash once cleared.` : `${base} Cash is updated.`;
  }
}
