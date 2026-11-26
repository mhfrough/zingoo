import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { of } from 'rxjs';
import { AttachmentMeta } from '../../core/attachments.api';
import { Lookup, LookupList, SettingsStore } from '../../core/settings.store';
import { Btn, Field, FileInput, Offcanvas, RichText, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { OpsApi } from '../ops/ops.api';
import { SettingsApi } from './settings.api';

/** the lists whose description is written in the rich-text editor (kept in notes) */
const RICH_LISTS: LookupList[] = ['LOAN_TENURE', 'REPAY_PLAN', 'REPAY_FREQUENCY', 'CERT_TYPE'];
/** loan lengths offered as one click; anything else is Custom */
const TENURE_MONTHS = ['3', '4', '6', '12', '18', '24', '36', '60'];
/** months between instalments */
export const FREQUENCY_PERIODS: [string, string][] = [['1', 'Monthly'], ['3', 'Quarterly'], ['6', 'Half-yearly'], ['12', 'Yearly']];
/** who a bank or cash account can belong to */
export const ACCOUNT_OWNERS = ['Company', 'Investor', 'Distributor', 'Manufacturer'] as const;

/** "12 months", "Every 3 months", "Open" ... the months of a loan list entry in words */
export function monthsText(l: Lookup): string | null {
  const m = Number(l.meta?.['months']);
  if (l.list === 'LOAN_TENURE') return m > 0 ? `${m} ${m === 1 ? 'month' : 'months'}` : 'Open (no fixed end)';
  if (l.list === 'REPAY_FREQUENCY') return m > 0 ? (FREQUENCY_PERIODS.find((p) => +p[0] === m)?.[1] ?? `Every ${m} months`) : 'Agreed per loan';
  return null;
}

/** the cost lines an Incoterm can put on the seller (bank charges and other costs always are) */
export const SELLER_LINES: [string, string][] = [
  ['origin', 'Origin costs (inland, handling, documents)'],
  ['ocean', 'Ocean freight'],
  ['insurance', 'Marine insurance'],
  ['destination', 'Destination charges'],
  ['duty', 'Import duty'],
];

/** how each list names its entries and what it is used for */
const LIST_TEXT: Record<LookupList, { word: string; use: string; code: string; meaning: string }> = {
  PAY_METHOD: { word: 'payment method', use: 'Offered in every payment form.', code: 'Name', meaning: 'Description' },
  INCOTERM: { word: 'Incoterm', use: 'Which cost lines the seller carries drives the export costing.', code: 'Code', meaning: 'Description' },
  CAPITAL_SOURCE: { word: 'capital source', use: 'Offered on every capital injection as its type of funding. A loan or advance is booked as money to pay back, equity as owner capital.', code: 'Name', meaning: 'Description' },
  STREAM_TYPE: { word: 'stream type', use: 'The type of an investment stream. A depreciable type carries a depreciation rate.', code: 'Name', meaning: 'Description' },
  PERSON: { word: 'investor account', use: 'An investor, a business owner, or both. Each one gets a separate account in the books.', code: 'Name', meaning: 'Notes' },
  LOAN_TENURE: { word: 'loan tenure', use: 'Offered on every loan.', code: 'Name', meaning: 'Description' },
  REPAY_PLAN: { word: 'repayment plan', use: 'Offered on every loan.', code: 'Name', meaning: 'Description' },
  REPAY_FREQUENCY: { word: 'repayment frequency', use: 'Offered on a loan that is repaid in installments.', code: 'Name', meaning: 'Description' },
  ADVANCE_PURPOSE: { word: 'advance purpose', use: 'Offered on every advance.', code: 'Name', meaning: 'Description' },
  SETTLEMENT_METHOD: { word: 'settlement method', use: 'How an advance is expected to be settled. Offered on every advance.', code: 'Name', meaning: 'Description' },
  BILL_TYPE: { word: 'bill type', use: 'The first choice on every bill / expense. The standard types ask for their own extra fields.', code: 'Name', meaning: 'Description' },
  BILL_TREATMENT: { word: 'accounting treatment', use: 'How a bill is treated (expense, inventory, asset, prepaid). A label for now.', code: 'Name', meaning: 'Description' },
  APPROVER: { word: 'approver', use: 'Offered as "Approved by" on every bill. The two signatures still decide.', code: 'Name', meaning: 'Role or contact' },
  DELIVERY_STATUS: { word: 'delivery status', use: 'Offered on every income invoice: where the goods are (dispatched, delivered, accepted ...).', code: 'Name', meaning: 'Description' },
  FLAVOUR: { word: 'flavour', use: 'Offered on every product / SKU.', code: 'Name', meaning: 'Description' },
  PACKET_SIZE: { word: 'packet size', use: 'Offered on every product / SKU (weight or price tier).', code: 'Name', meaning: 'Description' },
  TRANSPORT_UNIT: { word: 'transport unit', use: 'What a full load is called (Truck, Container 20 ft). Each packaging template says how many containers fill one.', code: 'Name', meaning: 'Description' },
  CONTAINER_UNIT: { word: 'container unit', use: 'What a container of a product is called (Carton, Bora). Shown in brackets wherever containers are counted.', code: 'Name', meaning: 'Description' },
  DIST_CLASSIFICATION: { word: 'distributor classification', use: 'Offered on every international distributor: importer, master distributor, wholesaler ...', code: 'Name', meaning: 'Description' },
  CERT_TYPE: { word: 'certificate type', use: 'Certificates a market can ask for on a product: halal, health, laboratory ...', code: 'Name', meaning: 'Description' },
  EXPORT_DOC_TYPE: { word: 'export document type', use: 'Documents kept on an export shipment: commercial invoice, packing list, bill of lading ...', code: 'Name', meaning: 'Description' },
  REMITTANCE_METHOD: { word: 'remittance method', use: 'How an international distributor may pay: bank transfer, SWIFT, documentary collection, letter of credit ...', code: 'Name', meaning: 'Description' },
  KYC_DOC_TYPE: { word: 'KYC document type', use: 'The documents an international distributor gives. A required one must be uploaded before its documents can be submitted.', code: 'Name', meaning: 'Description' },
  ORDER_STAGE: { word: 'production stage', use: 'The steps a manufacturer reports on an order, in this order. Steps only move forward.', code: 'Name', meaning: 'Description' },
  BANK: { word: 'bank', use: 'Offered on every manufacturer bank account. Payment invoices go to that bank.', code: 'Name', meaning: 'Description' },
  BANK_ACCOUNT: { word: 'bank or cash account', use: 'A bank account or cash counter of the company, an investor, a distributor or a manufacturer. Only the company\'s own are offered when money moves.', code: 'Name', meaning: 'Details' },
};

/**
 * Add or change an entry of a pick-list: a payment method, an Incoterm, a capital source or a stream type.
 * The name is stored on documents, so it cannot change once the entry exists; the text, the seller's cost lines
 * (Incoterms) and the on/off switch can. A switched-off entry is no longer offered in new forms.
 */
@Component({
  selector: 'app-lookup-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, FileInput, Select],
  template: `
    <app-offcanvas #oc [(open)]="open"
               [title]="(entry() ? 'Edit ' : 'Add ') + text().word"
               [subtitle]="text().use" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field [label]="text().code" [required]="true" [error]="invalid('code') ? 'Enter a name' : null"
                   [hint]="entry() ? 'Stored on documents, so it cannot change' : ''">
          <input type="text" formControlName="code" maxlength="40" />
        </app-field>
        <app-field label="Status">
          <app-select formControlName="active">
            <option value="true">Active</option>
            <option value="false">Switched off</option>
          </app-select>
        </app-field>
        @if (current() === 'LOAN_TENURE') {
          <app-field label="Length" hint="Months the loan runs">
            <app-select formControlName="lengthPick">
              @for (m of tenureMonths; track m) {
                <option [value]="m">{{ m }} months</option>
              }
              <option value="custom">Custom</option>
              <option value="">Open (no fixed end)</option>
            </app-select>
          </app-field>
          @if (v().lengthPick === 'custom') {
            <app-field label="Months" [required]="true" [error]="badMonths() ? '1 to 600 months' : null">
              <input type="number" formControlName="months" min="1" max="600" step="1" />
            </app-field>
          }
        }
        @if (current() === 'REPAY_FREQUENCY') {
          <app-field label="Period" hint="How often an instalment is due">
            <app-select formControlName="lengthPick">
              @for (p of periods; track p[0]) {
                <option [value]="p[0]">{{ p[1] }}</option>
              }
              <option value="custom">Every … months</option>
              <option value="">Agreed per loan</option>
            </app-select>
          </app-field>
          @if (v().lengthPick === 'custom') {
            <app-field label="Every (months)" [required]="true" [error]="badMonths() ? '1 to 600 months' : null">
              <input type="number" formControlName="months" min="1" max="600" step="1" />
            </app-field>
          }
        }
        @if (current() === 'BANK_ACCOUNT') {
          <h4 class="form-section">Whose account</h4>
          <div class="choice" role="radiogroup" aria-label="Kind of account">
            <label><input type="radio" formControlName="kind" value="Bank" /> <span><strong>Bank account</strong></span></label>
            <label><input type="radio" formControlName="kind" value="Cash" /> <span><strong>Cash counter</strong> · cash in hand, no bank</span></label>
          </div>
          <app-field label="Belongs to" help="Only the company's own accounts are offered when money is paid or received. The others are kept for reference.">
            <app-select formControlName="ownerType">
              @for (o of owners; track o) {
                <option [value]="o">{{ o }}</option>
              }
            </app-select>
          </app-field>
          @if (v().ownerType !== 'Company') {
            <app-field [label]="v().ownerType ?? ''" [required]="true" [error]="noOwner() ? 'Choose who it belongs to' : null">
              <app-select formControlName="ownerId" [options]="ownerOptions()" placeholder="Search" />
            </app-field>
          }
          @if (v().kind === 'Bank') {
            <h4 class="form-section">Bank details</h4>
            <app-field label="Bank" [required]="true" [error]="missing('bank') ? 'Choose the bank' : null" hint="The list of banks is on Settings & Data">
              <app-select formControlName="bank" [options]="banks()" placeholder="Search banks" />
            </app-field>
            <app-field label="Account title"><input type="text" formControlName="title" maxlength="150" /></app-field>
            <app-field label="Account no. / IBAN" [required]="true" [error]="missing('account') ? 'Enter the account' : null">
              <input type="text" formControlName="account" maxlength="150" />
            </app-field>
            <app-field label="Branch"><input type="text" formControlName="branch" maxlength="150" /></app-field>
          }
        }
        @if (list() !== 'PAY_METHOD') {
          <app-field [label]="rich() ? 'Description' : text().meaning" [wide]="true">
            <app-rich-text formControlName="notes" [max]="2000" [storeMax]="20000" placeholder="What it means, when it is used" />
          </app-field>
        }
        @if (current() === 'CERT_TYPE') {
          <app-field label="Picture" [wide]="true" hint="A sample of the certificate: PNG, JPG, GIF or WebP, 5 MB at most">
            <app-file-input formControlName="picture" />
          </app-field>
        }
        @if (list() === 'CAPITAL_SOURCE') {
          <label class="check field--wide"><input type="checkbox" formControlName="liability" /> A loan or advance (money to pay back), not owner equity</label>
          @if (liability()) {
            <label class="check field--wide"><input type="checkbox" formControlName="advance" /> An advance (temporary funding): asks for purpose, settlement method and direction instead of loan terms</label>
          }
        }
        @if (list() === 'PERSON') {
          <app-field label="Company"><input type="text" formControlName="company" maxlength="150" /></app-field>
          <app-field label="Point of contact" hint="Who to speak to: name, phone or email"><input type="text" formControlName="poc" maxlength="150" /></app-field>
          <div class="field field--wide" role="group" aria-label="Role">
            <span class="field__label">Role <span aria-hidden="true">*</span></span>
            <div class="seller-lines">
              <label class="check"><input type="checkbox" formControlName="investor" /> Investor</label>
              <label class="check"><input type="checkbox" formControlName="owner" /> Business owner</label>
            </div>
          </div>
        }
        @if (list() === 'KYC_DOC_TYPE') {
          <label class="check field--wide"><input type="checkbox" formControlName="required" /> Required before an international distributor's documents are submitted</label>
        }
        @if (list() === 'STREAM_TYPE') {
          <label class="check field--wide"><input type="checkbox" formControlName="depreciable" /> Loses value over time (the stream carries a depreciation rate)</label>
        }
        @if (list() === 'INCOTERM') {
          <div class="field field--wide" role="group" aria-label="Seller carries">
            <span class="field__label">The seller carries</span>
            <div class="seller-lines">
              @for (l of lines; track l[0]) {
                <label class="check"><input type="checkbox" [formControlName]="l[0]" /> {{ l[1] }}</label>
              }
            </div>
          </div>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ entry() ? 'Save changes' : 'Add entry' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
  styles: `
    .choice {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);

      & label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
        font-size: var(--text-sm);

        &:has(input:checked) {
          border-color: var(--accent);
          background: var(--accent-soft);
        }
      }
    }

    .seller-lines {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
      gap: var(--space-2) var(--space-4);
    }
  `,
})
export class LookupForm extends FormModal {
  readonly list = input<LookupList>('PAY_METHOD');
  protected text = computed(() => LIST_TEXT[this.list()]);
  readonly entry = input<Lookup | null>(null);
  readonly formId = 'form-lookup';
  protected lines = SELLER_LINES;
  protected tenureMonths = TENURE_MONTHS;
  protected periods = FREQUENCY_PERIODS;
  protected owners = ACCOUNT_OWNERS;
  private settingsApi = inject(SettingsApi);
  private store = inject(SettingsStore);
  private ops = inject(OpsApi);
  /** the list being edited */
  protected current = computed(() => this.entry()?.list ?? this.list());
  protected rich = computed(() => RICH_LISTS.includes(this.current()));
  /** partners an account can belong to: loaded only for the bank and cash accounts */
  private partners = rxResource({
    params: () => (this.open() && this.current() === 'BANK_ACCOUNT' ? true : undefined),
    stream: ({ params }) => (params ? this.ops.manufacturers() : of([])),
  });
  private dists = rxResource({
    params: () => (this.open() && this.current() === 'BANK_ACCOUNT' ? true : undefined),
    stream: ({ params }) => (params ? this.ops.distributors() : of([])),
  });
  protected banks = computed<SelectOption<string>[]>(() => {
    const own = this.store.options('BANK').map((b) => ({ value: b, label: b }));
    const now = this.v().bank;
    return now && !own.some((o) => o.value === now) ? [...own, { value: now, label: now }] : own;
  });

  readonly form = this.fb.nonNullable.group({
    code: ['', Validators.required],
    description: [''],
    active: ['true'],
    origin: [false],
    ocean: [false],
    insurance: [false],
    destination: [false],
    duty: [false],
    liability: [false],
    advance: [false],
    depreciable: [false],
    required: [false],
    investor: [true],
    owner: [false],
    company: [''],
    poc: [''],
    notes: [''],
    // loan tenure length / months between instalments: a preset, 'custom' (months below) or '' (open)
    lengthPick: [''],
    months: [''],
    picture: this.fb.control<AttachmentMeta | null>(null),
    kind: ['Bank' as 'Bank' | 'Cash'],
    ownerType: ['Company' as string],
    ownerId: this.fb.control<string | null>(null),
    bank: this.fb.control<string | null>(null),
    title: [''],
    account: [''],
    branch: [''],
  });

  protected v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** Save was pressed: the checks below show their messages from then on */
  private tried = signal(false);
  protected ownerOptions = computed<SelectOption<string>[]>(() => {
    const t = this.v().ownerType;
    if (t === 'Investor') return this.store.lookups().filter((l) => l.list === 'PERSON' && l.active).map((l) => ({ value: l.id, label: l.code, sub: l.meta?.['company'] || undefined }));
    if (t === 'Distributor') return (this.dists.value() ?? []).map((d) => ({ value: d.id, label: d.name }));
    if (t === 'Manufacturer') return (this.partners.value() ?? []).map((m) => ({ value: m.id, label: m.name }));
    return [];
  });
  protected badMonths = computed(() => {
    const v = this.v();
    if (v.lengthPick !== 'custom' || !this.tried()) return false;
    const m = Number(v.months);
    return !(Number.isInteger(m) && m >= 1 && m <= 600);
  });
  protected noOwner = computed(() => this.tried() && this.v().ownerType !== 'Company' && !this.v().ownerId);
  protected missing = (k: 'bank' | 'account') => this.tried() && this.v().kind === 'Bank' && !String(this.v()[k] ?? '').trim();

  private liabilityOn = toSignal(this.form.controls.liability.valueChanges, { initialValue: false });
  protected liability = computed(() => this.liabilityOn());

  protected reset() {
    this.tried.set(false);
    const e = this.entry();
    this.form.reset({
      code: e?.code ?? '', description: e?.description ?? '', active: String(e?.active ?? true),
      origin: !!e?.flags?.['origin'], ocean: !!e?.flags?.['ocean'], insurance: !!e?.flags?.['insurance'],
      destination: !!e?.flags?.['destination'], duty: !!e?.flags?.['duty'],
      liability: !!e?.flags?.['liability'], advance: !!e?.flags?.['advance'], depreciable: !!e?.flags?.['depreciable'], required: !!e?.flags?.['required'],
      investor: e ? !!e.flags?.['investor'] : true, owner: !!e?.flags?.['owner'],
      company: e?.meta?.['company'] ?? '', poc: e?.meta?.['poc'] ?? '',
      notes: e?.notes || e?.description || '',
      ...this.pickOf(e),
      picture: e?.meta?.['pictureId'] ? { id: e.meta['pictureId'], name: e.meta['pictureName'] || 'Picture', mime: 'image/*', size: 0 } : null,
      kind: e?.meta?.['kind'] === 'Cash' ? 'Cash' : 'Bank', ownerType: e?.meta?.['ownerType'] || 'Company', ownerId: e?.meta?.['ownerId'] || null,
      bank: e?.meta?.['bank'] || null, title: e?.meta?.['title'] ?? '', account: e?.meta?.['account'] ?? '', branch: e?.meta?.['branch'] ?? '',
    });
    if (e) this.form.controls.code.disable({ emitEvent: false });
    else this.form.controls.code.enable({ emitEvent: false });
  }

  /** the preset / custom months of a loan tenure or repayment frequency */
  private pickOf(e: Lookup | null): { lengthPick: string; months: string } {
    const list = e?.list ?? this.list();
    const m = e ? e.meta?.['months'] ?? '' : list === 'LOAN_TENURE' ? '12' : list === 'REPAY_FREQUENCY' ? '1' : '';
    const presets = list === 'LOAN_TENURE' ? TENURE_MONTHS : FREQUENCY_PERIODS.map((p) => p[0]);
    if (!m) return { lengthPick: '', months: '' };
    return presets.includes(m) ? { lengthPick: m, months: '' } : { lengthPick: 'custom', months: m };
  }

  /** the extra fields each list keeps */
  private metaOf(list: LookupList, v: ReturnType<LookupForm['form']['getRawValue']>): Record<string, string> | undefined {
    if (list === 'PERSON') return { company: v.company, poc: v.poc };
    if (list === 'LOAN_TENURE' || list === 'REPAY_FREQUENCY') return { months: v.lengthPick === 'custom' ? String(Number(v.months) || '') : v.lengthPick };
    if (list === 'CERT_TYPE') return { pictureId: v.picture?.id ?? '', pictureName: v.picture?.name ?? '' };
    if (list === 'BANK_ACCOUNT') {
      return {
        kind: v.kind, ownerType: v.ownerType, ownerId: v.ownerType === 'Company' ? '' : v.ownerId ?? '',
        bank: v.kind === 'Bank' ? v.bank ?? '' : '', title: v.title.trim(), account: v.kind === 'Bank' ? v.account.trim() : '', branch: v.kind === 'Bank' ? v.branch.trim() : '',
      };
    }
    return undefined;
  }

  protected request() {
    const v = this.form.getRawValue();
    const list = this.entry()?.list ?? this.list();
    const flags: Record<string, boolean> =
      list === 'INCOTERM' ? { origin: v.origin, ocean: v.ocean, insurance: v.insurance, destination: v.destination, duty: v.duty }
      : list === 'CAPITAL_SOURCE' ? { liability: v.liability, advance: v.liability && v.advance }
      : list === 'STREAM_TYPE' ? { depreciable: v.depreciable }
      : list === 'KYC_DOC_TYPE' ? { required: v.required }
      : list === 'PERSON' ? { investor: v.investor, owner: v.owner }
      : {};
    const meta = this.metaOf(list, v);
    const text = list === 'PAY_METHOD' ? {} : { notes: v.notes };
    const e = this.entry();
    return e
      ? this.settingsApi.updateLookup(e.id, { ...text, flags, meta, active: v.active === 'true' })
      : this.settingsApi.addLookup({ list: this.list(), code: v.code, ...text, flags, meta });
  }

  protected override submit() {
    const v = this.form.getRawValue();
    const list = this.entry()?.list ?? this.list();
    if (list === 'PERSON' && !v.investor && !v.owner) {
      this.error.set('Tick investor, business owner, or both.');
      return;
    }
    this.tried.set(true);
    if ((list === 'LOAN_TENURE' || list === 'REPAY_FREQUENCY') && this.badMonths()) return this.error.set('Enter the months: a whole number from 1 to 600.');
    if (list === 'BANK_ACCOUNT') {
      if (this.noOwner()) return this.error.set(`Choose the ${v.ownerType.toLowerCase()} this account belongs to.`);
      if (this.missing('bank') || this.missing('account')) return this.error.set('Choose the bank and enter the account number.');
    }
    super.submit();
  }

  protected successMessage() {
    return this.entry() ? 'Entry saved.' : 'Entry added.';
  }
}
