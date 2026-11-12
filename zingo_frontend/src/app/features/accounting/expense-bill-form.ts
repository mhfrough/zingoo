import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AttachmentMeta } from '../../core/attachments.api';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtMoney } from '../../shared/format';
import { Btn, Field, FileInput, MoneyInput, Offcanvas, Tag } from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountingDoc, Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** the extra fields each standard bill type asks for (a bill type added in Settings has none) */
const TYPE_FIELDS: Record<string, string[]> = {
  'Supplier / Manufacturing': ['Purchase order / GRN', 'SKU / batch reference', 'Quantity / weight'],
  'Internal Expense': ['Employee / department', 'Expense claim ID', 'Reimbursement reason'],
  'Marketing Expense': ['Campaign name', 'Channel / platform', 'Campaign period'],
  'Operating Expense': ['Operating cost category', 'Service period', 'Branch / location'],
  'Distribution Expense': ['Vehicle / route', 'Shipment / dispatch ID', 'Destination'],
  'Export Expense': ['Shipment / container', 'Incoterm', 'Destination country'],
  'Asset Purchase': ['Asset category', 'Asset tag / serial', 'Useful life'],
  'Prepaid Expense': ['Service start date', 'Service end date', 'Amortization period'],
};

/** what the payee is called for a bill type */
const payeeLabel = (t: string) =>
  /internal/i.test(t) ? 'Employee / payee' : /marketing/i.test(t) ? 'Agency / vendor / payee' : /operating/i.test(t) ? 'Service provider / payee'
  : /distribution/i.test(t) ? 'Transporter / payee' : 'Supplier / payee';

/** the treatment and stream a bill type suggests (both can be changed) */
const suggestTreatment = (t: string) => (/asset/i.test(t) ? /fixed asset/i : /prepaid/i.test(t) ? /prepaid/i : /supplier|manufactur/i.test(t) ? /inventory/i : /operating expense/i);
const suggestStream = (t: string) =>
  /marketing/i.test(t) ? /marketing/i : /distribution/i.test(t) ? /distribution/i : /export/i.test(t) ? /export/i : /operating/i.test(t) ? /operation/i
  : /internal/i.test(t) ? /admin/i : /manufactur/i;

type Basis = 'amount' | 'pct';
const allocGroup = (fb: NonNullableFormBuilder, stream = '', amount = 0, pct = 100, by: Basis = 'pct') =>
  fb.group({ stream: [stream, Validators.required], amount: [amount], pct: [pct], by: [by] });
type AllocForm = ReturnType<typeof allocGroup>;

/**
 * Record a bill or expense, as in the client's universal bill design: 1 classification and party (with the fields
 * of the bill type), 2 allocation across one or several streams, 3 how it will be paid, 4 approval and documents.
 * A bill is paid only after approval (the signatures), from the documents list. The treatment is a label for now.
 */
@Component({
  selector: 'app-expense-bill-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, MoneyInput, Btn, Tag, FileInput],
  styles: `
    .sections {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);

      & + .block {
        padding-block-start: var(--space-5);
        border-block-start: 1px solid var(--border);
      }

      & > header h3 {
        margin: 0;
        font-size: var(--text-md);
      }

      & > header p {
        margin: var(--space-1) 0 0;
        font-size: var(--text-xs);
        color: var(--text-3);
      }
    }

    .grid-4 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
      gap: var(--space-3) var(--space-4);
    }

    .wide {
      grid-column: 1 / -1;
    }

    .sub {
      margin: 0;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    .alloc {
      container-type: inline-size;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-sunken);
    }

    .alloc__row {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(8rem, 1fr) minmax(5rem, 0.6fr) var(--btn-h-sm);
      gap: var(--space-2);
      align-items: center;
    }

    @container (max-width: 30rem) {
      .alloc__row {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--btn-h-sm);

        & > :first-child {
          grid-column: 1 / -1;
        }
      }
    }

    .alloc__bar {
      block-size: 0.375rem;
      border-radius: 999px;
      background: var(--border);
      overflow: hidden;

      & > span {
        display: block;
        block-size: 100%;
        background: var(--accent);
      }
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      font-size: var(--text-sm);
      color: var(--text-2);

      & strong {
        font-family: var(--font-mono);
        color: var(--text);
      }

      & [data-bad] strong {
        color: var(--danger);
      }
    }

    .add-row {
      display: flex;
      gap: var(--space-2);
    }

    .foot-status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin-inline-end: auto;
      font-size: var(--text-sm);
      color: var(--text-2);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="doc() ? 'Edit bill ' + doc()!.refNo : 'Record new bill / expense'"
                   subtitle="Supplier, internal, marketing, operating, distribution and export bills." size="xl" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="create()" class="sections" novalidate>
        <section class="block">
          <header><h3>1. Bill classification & party</h3></header>
          <div class="grid-4">
            <app-field label="Bill type" [required]="true" hint="From Settings">
              <select formControlName="billType" (change)="onType()">
                @for (t of billTypes(); track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </app-field>
            <app-field label="Bill date" [required]="true"><input type="date" formControlName="date" /></app-field>
            <app-field label="Invoice / voucher number" hint="Blank: the document number is used">
              <input type="text" formControlName="invoiceNo" maxlength="60" [placeholder]="doc()?.refNo ?? 'Supplier invoice no.'" />
            </app-field>
            <app-field [label]="payee()" [required]="true" [error]="invalid('party') ? 'Enter who is paid' : null">
              <input type="text" formControlName="party" maxlength="150" />
            </app-field>
            <app-field label="Expense account" [required]="true" hint="The expense category it posts to">
              <select formControlName="category">
                @for (c of categories(); track c) {
                  <option [value]="c">{{ c }}</option>
                }
              </select>
            </app-field>
            <app-field label="Currency">
              <select formControlName="currency">
                @for (c of currencies(); track c.code) {
                  <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
                }
              </select>
            </app-field>
            <app-field label="Exchange rate (PKR per unit)"><input type="number" formControlName="fxRate" min="0" step="any" /></app-field>
            <app-field label="Gross bill amount" [required]="true" [error]="invalid('grossAmount') ? 'Enter an amount above zero' : null">
              <app-money-input formControlName="grossAmount" [currency]="cur()" (input)="refreshAlloc()" />
            </app-field>
            <app-field label="Sales tax / other tax"><app-money-input formControlName="billTax" [currency]="cur()" /></app-field>
            <app-field label="Withholding deducted" hint="Kept back from the payee, owed to the tax authority">
              <app-money-input formControlName="billWht" [currency]="cur()" />
            </app-field>
            <app-field label="Payment terms">
              <select formControlName="paymentDays">
                <option [ngValue]="0">Immediate</option>
                @for (d of cycles(); track d) {
                  <option [ngValue]="d">{{ d }} days</option>
                }
              </select>
            </app-field>
            <app-field label="Due date"><input type="date" formControlName="dueDate" /></app-field>
            <app-field label="Accounting treatment" hint="A label for now: the bill posts as an expense">
              <select formControlName="treatment">
                <option value="">Choose</option>
                @for (t of treatments(); track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </app-field>
            <app-field label="Description / reason" [required]="true" [wide]="true" [error]="invalid('note') ? 'Say what the bill is for' : null">
              <textarea formControlName="note" placeholder="What was bought or paid for, and why"></textarea>
            </app-field>
            @if (typeFields().length) {
              <h4 class="sub wide">{{ value().billType }} details</h4>
              <ng-container formGroupName="details">
                @for (f of typeFields(); track f; let i = $index) {
                  <app-field [label]="f"><input type="text" [formControlName]="'f' + i" maxlength="150" /></app-field>
                }
              </ng-container>
            }
          </div>
        </section>

        <section class="block">
          <header><h3>2. Allocate this bill across one or more streams</h3><p>Edit the amount or the percentage. The total must equal the gross bill amount.</p></header>
          <div class="grid-4">
            <app-field label="Allocation mode">
              <select formControlName="mode" (change)="onMode()">
                <option value="single">Single stream</option>
                <option value="split">Split allocation</option>
              </select>
            </app-field>
          </div>
          <div class="alloc" formArrayName="allocations">
            @for (a of allocs.controls; track a; let i = $index) {
              <div class="alloc__row" [formGroupName]="i">
                <div class="field"><div class="field__control">
                  <select formControlName="stream" [attr.aria-label]="'Stream, line ' + (i + 1)">
                    <option value="">Choose a stream</option>
                    @for (s of streams(); track s) {
                      <option [value]="s" [disabled]="usedElsewhere(a, s)">{{ s }}</option>
                    }
                  </select>
                </div></div>
                <div class="field"><div class="field__control">
                  <app-money-input formControlName="amount" currency="" (input)="onAllocAmount(a)" [ariaLabel]="'Amount, line ' + (i + 1)" />
                </div></div>
                <div class="field"><div class="field__control">
                  <app-money-input formControlName="pct" currency="" [decimals]="2" [max]="100" (input)="onAllocPct(a)" [ariaLabel]="'Percent, line ' + (i + 1)" />
                </div></div>
                <button appBtn type="button" size="sm" variant="ghost" icon="x" [disabled]="allocs.length <= 1" [attr.aria-label]="'Remove line ' + (i + 1)" (click)="removeAlloc(i)"></button>
              </div>
            }
            @if (!single()) {
              <div class="add-row">
                <button appBtn type="button" size="sm" icon="plus" [disabled]="allocs.length >= 12" (click)="addAlloc()">Add allocation</button>
                <button appBtn type="button" size="sm" [disabled]="!allocGap()" (click)="fillRemainder()">Allocate remainder</button>
              </div>
            }
            <div class="chips">
              <span>Allocated <strong>{{ money(allocSum() * fx()) }}</strong></span>
              <span [attr.data-bad]="allocGap() ? '' : null">Remaining <strong>{{ money(allocGap() * fx()) }}</strong></span>
              <span>Allocation <strong>{{ allocPct() }}%</strong></span>
            </div>
            <div class="alloc__bar" aria-hidden="true"><span [style.width.%]="allocPct() > 100 ? 100 : allocPct()"></span></div>
          </div>
        </section>

        <section class="block">
          <header><h3>3. Payment & settlement</h3><p>A bill is paid once it is approved, from the documents list (Pay).</p></header>
          <div class="grid-4">
            <app-field label="Payment account" hint="From Settings">
              <select formControlName="receivingAccount">
                <option value="">Choose</option>
                @for (b of bankAccounts(); track b) {
                  <option [value]="b">{{ b }}</option>
                }
              </select>
            </app-field>
            <app-field label="Payment method">
              <select formControlName="paymentMethod">
                <option value="">Choose</option>
                @for (m of methods(); track m) {
                  <option [value]="m">{{ m }}</option>
                }
              </select>
            </app-field>
          </div>
          <div class="chips">
            <span>Bill total <strong>{{ money(totals().totalPkr) }}</strong></span>
            <span>Paid <strong>{{ money(doc()?.paid ?? 0) }}</strong></span>
            <span>Outstanding <strong>{{ money(totals().totalPkr - (doc()?.paid ?? 0)) }}</strong></span>
            @if (totals().whtPkr > 0) {
              <span>Withholding to the tax authority <strong>{{ money(totals().whtPkr) }}</strong></span>
            }
          </div>
        </section>

        <section class="block">
          <header><h3>4. Approval, documents & accounting</h3></header>
          <div class="grid-4">
            <app-field label="Approval status">
              <input type="text" [value]="approvalText()" readonly />
            </app-field>
            <app-field label="Approved by" hint="From Settings. The signatures still decide">
              <select formControlName="approver">
                <option value="">Select approver</option>
                @for (a of approvers(); track a) {
                  <option [value]="a">{{ a }}</option>
                }
              </select>
            </app-field>
            <app-field label="Cost center / department">
              <select formControlName="costCenter">
                <option value="">Choose</option>
                @for (s of streams(); track s) {
                  <option [value]="s">{{ s }}</option>
                }
              </select>
            </app-field>
            <app-field label="Project / campaign reference"><input type="text" formControlName="projectRef" maxlength="100" /></app-field>
            <app-field label="Created by"><input type="text" formControlName="createdBy" maxlength="120" /></app-field>
            <app-field label="Supporting bill / receipt" [wide]="true"><app-file-input formControlName="attachment" label="Attach bill" /></app-field>
          </div>
          <div class="notice">
            <span>Posts when approved: debit <strong>Expense · {{ value().category }}</strong> {{ money(totals().grossPkr + totals().taxPkr) }},
              credit Accounts Payable {{ money(totals().totalPkr) }}{{ totals().whtPkr > 0 ? ' and Withholding Tax Payable ' + money(totals().whtPkr) : '' }}.
              Payments reduce the payable and cash.</span>
          </div>
        </section>
      </form>
      <ng-container offcanvasFooter>
        <span class="foot-status">
          <app-tag [tone]="doc() && doc()!.status !== 'Draft' ? 'warning' : 'neutral'">{{ doc() ? doc()!.status : 'New draft' }}</app-tag>
        </span>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        @if (!doc() || doc()!.status === 'Draft') {
          <button appBtn type="button" [loading]="busy() && draft()" [disabled]="busy()" (click)="saveDraft()">Save draft</button>
        }
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy() && !draft()" [disabled]="busy()">
          {{ doc() && doc()!.status !== 'Draft' ? 'Save bill' : 'Create bill' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ExpenseBillForm extends FormModal {
  readonly doc = input<AccountingDoc | null>(null);
  /** expense categories (the accounts a bill posts to) */
  readonly categories = input<string[]>([]);
  readonly currencies = input<Currency[]>([]);
  readonly formId = 'form-expense-bill';
  protected money = fmtMoney;
  protected draft = signal(false);

  private fin = inject(FinanceApi);
  private store = inject(SettingsStore);
  private auth = inject(AuthService);
  private nfb = inject(NonNullableFormBuilder);
  protected billTypes = computed(() => this.store.options('BILL_TYPE'));
  protected treatments = computed(() => this.store.options('BILL_TREATMENT'));
  protected approvers = computed(() => this.store.options('APPROVER'));
  protected bankAccounts = this.store.bankAccounts;
  protected methods = this.store.paymentMethods;
  protected cycles = computed(() => this.store.settings()?.paymentCycles ?? [15, 30, 45, 60]);
  private streamsRes = rxResource({ params: () => this.open() || null, stream: () => this.fin.categories('COST_CENTER') });
  protected streams = computed(() => (this.streamsRes.value() ?? []).map((c) => c.name));

  readonly form = this.nfb.group({
    billType: ['', Validators.required],
    date: [today(), Validators.required],
    invoiceNo: [''],
    party: ['', Validators.required],
    category: ['', Validators.required],
    currency: ['PKR'],
    fxRate: [1, [Validators.required, Validators.min(0.000001)]],
    grossAmount: [0, [Validators.required, Validators.min(0.01)]],
    billTax: [0],
    billWht: [0],
    paymentDays: [30],
    dueDate: [today()],
    treatment: [''],
    note: ['', Validators.required],
    details: this.nfb.group({ f0: [''], f1: [''], f2: [''] }),
    mode: ['single' as 'single' | 'split'],
    allocations: this.nfb.array<AllocForm>([]),
    receivingAccount: [''],
    paymentMethod: [''],
    approver: [''],
    costCenter: [''],
    projectRef: [''],
    createdBy: [''],
    attachment: [null as AttachmentMeta | null],
  });

  protected get allocs() {
    return this.form.controls.allocations;
  }

  protected value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected cur = computed(() => this.value().currency ?? 'PKR');
  protected fx = computed(() => {
    this.value();
    return Number(this.form.controls.fxRate.value) || 0;
  });
  protected single = computed(() => this.value().mode === 'single');
  protected payee = computed(() => payeeLabel(this.value().billType ?? ''));
  protected typeFields = computed(() => TYPE_FIELDS[this.value().billType ?? ''] ?? []);
  protected totals = computed(() => {
    const v = this.value();
    const fx = this.fx();
    const gross = Number(v.grossAmount) || 0;
    const tax = Number(v.billTax) || 0;
    const wht = Number(v.billWht) || 0;
    return { grossPkr: round2(gross * fx), taxPkr: round2(tax * fx), whtPkr: round2(wht * fx), totalPkr: round2((gross + tax - wht) * fx) };
  });
  protected allocSum = computed(() => {
    this.value();
    return round2(this.allocs.controls.reduce((n, a) => n + (Number(a.controls.amount.value) || 0), 0));
  });
  /** gross not on a stream yet (negative = too much); 0 when it adds up */
  protected allocGap = computed(() => {
    const gap = round2((Number(this.value().grossAmount) || 0) - this.allocSum());
    return Math.abs(gap) > 0.02 ? gap : 0;
  });
  protected allocPct = computed(() => {
    const g = Number(this.value().grossAmount) || 0;
    return g > 0 ? Math.round((this.allocSum() / g) * 1000) / 10 : 0;
  });
  protected approvalText = computed(() => {
    const d = this.doc();
    if (!d || d.status === 'Draft') return 'Pending approval (after it is created)';
    if (d.approved) return 'Approved';
    return `Pending · ${d.signatures.length} of ${d.requiredSignatures} signatures`;
  });

  constructor() {
    super();
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      const rate = this.currencies().find((c) => c.code === code)?.rate;
      this.form.controls.fxRate.setValue(code === 'PKR' ? 1 : Number(rate ?? 1));
      this.lockRate();
    });
    const followTerms = () => {
      const v = this.form.getRawValue();
      if (v.date) this.form.controls.dueDate.setValue(addDays(v.date, Number(v.paymentDays) || 0));
    };
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(followTerms);
    this.form.controls.paymentDays.valueChanges.pipe(takeUntilDestroyed()).subscribe(followTerms);
    // the streams load after the panel opens: an empty single line then gets the stream the bill type suggests
    effect(() => {
      const streams = this.streams();
      untracked(() => {
        const first = this.allocs.at(0);
        if (streams.length && this.allocs.length === 1 && first && !first.controls.stream.value) {
          first.controls.stream.setValue(this.pick(streams, suggestStream(this.form.controls.billType.value)), { emitEvent: false });
        }
      });
    });
  }

  private lockRate() {
    if (this.form.controls.currency.value === 'PKR') this.form.controls.fxRate.disable({ emitEvent: false });
    else this.form.controls.fxRate.enable({ emitEvent: false });
  }

  protected reset() {
    const d = this.doc();
    this.draft.set(false);
    this.allocs.clear({ emitEvent: false });
    const type = d?.billType || this.billTypes()[0] || '';
    const fields = TYPE_FIELDS[type] ?? [];
    const days = d?.paymentDays ?? 30;
    const gross = Number(d?.grossAmount) > 0 ? Number(d!.grossAmount) : Number(d?.foreignAmount ?? 0);
    this.form.reset({
      billType: type, date: d?.date ?? today(), invoiceNo: d?.invoiceNo && d.invoiceNo !== d.refNo ? d.invoiceNo : '', party: d?.party ?? '',
      category: d?.category ?? this.categories()[0] ?? '', currency: d?.currency ?? 'PKR', fxRate: Number(d?.fxRate ?? 1), grossAmount: gross,
      billTax: Number(d?.billTax ?? 0), billWht: Number(d?.billWht ?? 0), paymentDays: days, dueDate: d?.dueDate ?? addDays(today(), days),
      treatment: d?.treatment ?? this.pick(this.treatments(), suggestTreatment(type)), note: d?.note ?? '',
      details: { f0: d?.billDetails?.[fields[0]] ?? '', f1: d?.billDetails?.[fields[1]] ?? '', f2: d?.billDetails?.[fields[2]] ?? '' },
      mode: (d?.allocations?.length ?? 0) > 1 ? 'split' : 'single', receivingAccount: d?.receivingAccount ?? '', paymentMethod: d?.paymentMethod ?? '',
      approver: d?.approver ?? '', costCenter: d?.costCenter ?? '', projectRef: d?.projectRef ?? '', createdBy: d?.createdBy || this.auth.user()?.name || '',
      attachment: null,
    }, { emitEvent: false });
    const saved = d?.allocations ?? [];
    if (saved.length) for (const a of saved) this.allocs.push(allocGroup(this.nfb, a.stream, Number(a.amount), gross > 0 ? round3((a.amount / gross) * 100) : 0, 'amount'), { emitEvent: false });
    else this.allocs.push(allocGroup(this.nfb, this.pick(this.streams(), suggestStream(type)), gross, 100, 'pct'), { emitEvent: false });
    this.lockRate();
    this.form.markAsPristine();
    this.form.updateValueAndValidity();
  }

  private pick(list: string[], re: RegExp) {
    return list.find((x) => re.test(x)) ?? list[0] ?? '';
  }

  /** a bill type suggests its treatment and, with one stream, the stream */
  protected onType() {
    const t = this.form.controls.billType.value;
    this.form.controls.treatment.setValue(this.pick(this.treatments(), suggestTreatment(t)));
    this.form.controls.details.reset({ f0: '', f1: '', f2: '' });
    if (this.allocs.length === 1) this.allocs.at(0).controls.stream.setValue(this.pick(this.streams(), suggestStream(t)));
  }

  // ───────────── allocation ─────────────

  protected onMode() {
    if (this.single()) {
      while (this.allocs.length > 1) this.allocs.removeAt(this.allocs.length - 1);
      this.allocs.at(0).controls.by.setValue('pct');
      this.allocs.at(0).controls.pct.setValue(100);
    }
    this.refreshAlloc();
  }

  /** the gross changed: each line keeps whichever of amount / percent was typed last */
  protected refreshAlloc() {
    const g = Number(this.form.controls.grossAmount.value) || 0;
    for (const a of this.allocs.controls) {
      if (a.controls.by.value === 'pct') a.controls.amount.setValue(round2((g * (Number(a.controls.pct.value) || 0)) / 100));
      else a.controls.pct.setValue(g > 0 ? round3(((Number(a.controls.amount.value) || 0) / g) * 100) : 0);
    }
  }

  protected onAllocAmount(a: AllocForm) {
    a.controls.by.setValue('amount');
    const g = Number(this.form.controls.grossAmount.value) || 0;
    a.controls.pct.setValue(g > 0 ? round3(((Number(a.controls.amount.value) || 0) / g) * 100) : 0);
  }

  protected onAllocPct(a: AllocForm) {
    a.controls.by.setValue('pct');
    a.controls.amount.setValue(round2(((Number(this.form.controls.grossAmount.value) || 0) * (Number(a.controls.pct.value) || 0)) / 100));
  }

  protected addAlloc() {
    const g = Number(this.form.controls.grossAmount.value) || 0;
    const left = Math.max(0, round2(g - this.allocSum()));
    const unused = this.streams().find((s) => !this.allocs.controls.some((a) => a.controls.stream.value === s)) ?? '';
    this.allocs.push(allocGroup(this.nfb, unused, left, g > 0 ? round3((left / g) * 100) : 0, 'amount'));
    this.form.markAsDirty();
  }

  protected removeAlloc(i: number) {
    this.allocs.removeAt(i);
    this.form.markAsDirty();
  }

  protected fillRemainder() {
    const gap = this.allocGap();
    const last = this.allocs.at(this.allocs.length - 1);
    if (!gap || !last) return;
    last.controls.amount.setValue(Math.max(0, round2((Number(last.controls.amount.value) || 0) + gap)));
    this.onAllocAmount(last);
    this.form.markAsDirty();
  }

  protected usedElsewhere(current: AllocForm, s: string) {
    return this.allocs.controls.some((a) => a !== current && a.controls.stream.value === s);
  }

  // ───────────── save ─────────────

  protected saveDraft() {
    this.draft.set(true);
    const c = this.form.controls;
    for (const k of ['party', 'category', 'billType', 'date'] as const) c[k].markAsTouched();
    if (c.party.invalid || c.category.invalid || c.billType.invalid || c.date.invalid) {
      this.error.set('A draft needs at least the bill type, the payee, the expense account and the date.');
      return;
    }
    this.send();
  }

  protected create() {
    this.draft.set(false);
    this.form.markAllAsTouched();
    const p = this.problem();
    if (p) {
      this.error.set(p);
      return;
    }
    this.send();
  }

  private problem(): string | null {
    const c = this.form.controls;
    if (c.billType.invalid || c.party.invalid || c.category.invalid || c.date.invalid || c.fxRate.invalid) return 'Fill in the fields marked with *.';
    if (c.grossAmount.invalid) return 'Enter a gross bill amount above zero.';
    if (c.note.invalid) return 'Enter the description / reason.';
    if ((Number(c.billWht.value) || 0) > (Number(c.grossAmount.value) || 0) + (Number(c.billTax.value) || 0)) return 'The withholding cannot be more than the gross amount plus tax.';
    if (this.allocs.controls.some((a) => !a.controls.stream.value)) return 'Choose a stream on every allocation line.';
    if (this.allocGap()) return `The allocation must equal the gross bill amount (${fmtMoney(Math.abs(this.allocGap()))} ${this.allocGap() > 0 ? 'left' : 'too much'}).`;
    if (c.dueDate.value && c.dueDate.value < c.date.value) return 'The due date cannot be before the bill date.';
    return null;
  }

  private send() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.request().subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(this.successMessage());
        this.open.set(false);
        this.saved.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
      },
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    const fields = TYPE_FIELDS[v.billType] ?? [];
    const details = Object.fromEntries(fields.map((f, i) => [f, (v.details as Record<string, string>)[`f${i}`]?.trim() ?? '']).filter(([, x]) => x));
    const body = {
      kind: 'Expense', billType: v.billType, date: v.date, invoiceNo: v.invoiceNo.trim(), party: v.party.trim(), category: v.category,
      currency: v.currency, fxRate: Number(v.fxRate), grossAmount: Number(v.grossAmount) || 0, billTax: Number(v.billTax) || 0, billWht: Number(v.billWht) || 0,
      paymentDays: Number(v.paymentDays) || 0, dueDate: v.dueDate || v.date, treatment: v.treatment, note: v.note.trim(), billDetails: details,
      allocations: v.allocations.filter((a) => a.stream).map((a) => ({ stream: a.stream, amount: Number(a.amount) || 0 })),
      receivingAccount: v.receivingAccount, paymentMethod: v.paymentMethod, approver: v.approver, costCenter: v.costCenter,
      projectRef: v.projectRef.trim(), createdBy: v.createdBy.trim(), ...(v.attachment ? { attachmentId: v.attachment.id } : {}),
      ...(this.doc() && this.doc()!.status !== 'Draft' ? {} : { status: this.draft() ? 'Draft' : 'Issued' }),
    };
    const id = this.doc()?.id ?? null;
    if (id) {
      const { kind: _k, ...patch } = body;
      return this.fin.saveDoc(id, patch);
    }
    return this.fin.saveDoc(null, body);
  }

  protected successMessage() {
    return this.draft() ? 'Draft saved. Nothing is posted until you create the bill.' : 'Bill created. It needs approval before it can be paid.';
  }
}
