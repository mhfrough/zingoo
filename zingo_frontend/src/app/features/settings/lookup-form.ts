import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Lookup, LookupList } from '../../core/settings.store';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { SettingsApi } from './settings.api';

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
  PAY_METHOD: { word: 'payment method', use: 'Offered in every payment form.', code: 'Name', meaning: 'Meaning' },
  INCOTERM: { word: 'Incoterm', use: 'Which cost lines the seller carries drives the export costing.', code: 'Code', meaning: 'Meaning' },
  CAPITAL_SOURCE: { word: 'capital source', use: 'Offered on every capital injection as its type of funding. A loan or advance is booked as money to pay back, equity as owner capital.', code: 'Name', meaning: 'Meaning' },
  STREAM_TYPE: { word: 'stream type', use: 'The type of an investment stream. A depreciable type carries a depreciation rate.', code: 'Name', meaning: 'Meaning' },
  PERSON: { word: 'investor account', use: 'An investor, a business owner, or both. Each one gets a separate account in the books.', code: 'Name', meaning: 'Notes' },
  LOAN_TENURE: { word: 'loan tenure', use: 'Offered on every loan.', code: 'Name', meaning: 'Meaning' },
  REPAY_PLAN: { word: 'repayment plan', use: 'Offered on every loan.', code: 'Name', meaning: 'Meaning' },
  REPAY_FREQUENCY: { word: 'repayment frequency', use: 'Offered on a loan that is repaid in installments.', code: 'Name', meaning: 'Meaning' },
  ADVANCE_PURPOSE: { word: 'advance purpose', use: 'Offered on every advance.', code: 'Name', meaning: 'Meaning' },
  SETTLEMENT_METHOD: { word: 'settlement method', use: 'How an advance is expected to be settled. Offered on every advance.', code: 'Name', meaning: 'Meaning' },
  BILL_TYPE: { word: 'bill type', use: 'The first choice on every bill / expense. The standard types ask for their own extra fields.', code: 'Name', meaning: 'Meaning' },
  BILL_TREATMENT: { word: 'accounting treatment', use: 'How a bill is treated (expense, inventory, asset, prepaid). A label for now.', code: 'Name', meaning: 'Meaning' },
  APPROVER: { word: 'approver', use: 'Offered as "Approved by" on every bill. The two signatures still decide.', code: 'Name', meaning: 'Role or contact' },
  DELIVERY_STATUS: { word: 'delivery status', use: 'Offered on every income invoice: where the goods are (dispatched, delivered, accepted ...).', code: 'Name', meaning: 'Meaning' },
  FLAVOUR: { word: 'flavour', use: 'Offered on every product / SKU.', code: 'Name', meaning: 'Meaning' },
  PACKET_SIZE: { word: 'packet size', use: 'Offered on every product / SKU (weight or price tier).', code: 'Name', meaning: 'Meaning' },
  BANK: { word: 'bank', use: 'Offered on every manufacturer bank account. Payment invoices go to that bank.', code: 'Name', meaning: 'Meaning' },
  BANK_ACCOUNT: { word: 'bank or cash account', use: 'The account that took or paid the money. It is recorded on the entry; the books keep one Cash & Bank account.', code: 'Name', meaning: 'Details' },
};

/**
 * Add or change an entry of a pick-list: a payment method, an Incoterm, a capital source or a stream type.
 * The name is stored on documents, so it cannot change once the entry exists; the text, the seller's cost lines
 * (Incoterms) and the on/off switch can. A switched-off entry is no longer offered in new forms.
 */
@Component({
  selector: 'app-lookup-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
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
          <select formControlName="active">
            <option value="true">Active</option>
            <option value="false">Switched off</option>
          </select>
        </app-field>
        @if (list() !== 'PAY_METHOD') {
          <app-field [label]="text().meaning" [wide]="true"><input type="text" formControlName="description" maxlength="250" /></app-field>
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
  private settingsApi = inject(SettingsApi);

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
    investor: [true],
    owner: [false],
    company: [''],
    poc: [''],
  });

  private liabilityOn = toSignal(this.form.controls.liability.valueChanges, { initialValue: false });
  protected liability = computed(() => this.liabilityOn());

  protected reset() {
    const e = this.entry();
    this.form.reset({
      code: e?.code ?? '', description: e?.description ?? '', active: String(e?.active ?? true),
      origin: !!e?.flags?.['origin'], ocean: !!e?.flags?.['ocean'], insurance: !!e?.flags?.['insurance'],
      destination: !!e?.flags?.['destination'], duty: !!e?.flags?.['duty'],
      liability: !!e?.flags?.['liability'], advance: !!e?.flags?.['advance'], depreciable: !!e?.flags?.['depreciable'],
      investor: e ? !!e.flags?.['investor'] : true, owner: !!e?.flags?.['owner'],
      company: e?.meta?.['company'] ?? '', poc: e?.meta?.['poc'] ?? '',
    });
    if (e) this.form.controls.code.disable({ emitEvent: false });
    else this.form.controls.code.enable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const list = this.entry()?.list ?? this.list();
    const flags: Record<string, boolean> =
      list === 'INCOTERM' ? { origin: v.origin, ocean: v.ocean, insurance: v.insurance, destination: v.destination, duty: v.duty }
      : list === 'CAPITAL_SOURCE' ? { liability: v.liability, advance: v.liability && v.advance }
      : list === 'STREAM_TYPE' ? { depreciable: v.depreciable }
      : list === 'PERSON' ? { investor: v.investor, owner: v.owner }
      : {};
    const meta = list === 'PERSON' ? { company: v.company, poc: v.poc } : undefined;
    const e = this.entry();
    return e
      ? this.settingsApi.updateLookup(e.id, { description: v.description, flags, meta, active: v.active === 'true' })
      : this.settingsApi.addLookup({ list: this.list(), code: v.code, description: v.description, flags, meta });
  }

  protected override submit() {
    const v = this.form.getRawValue();
    if ((this.entry()?.list ?? this.list()) === 'PERSON' && !v.investor && !v.owner) {
      this.error.set('Tick investor, business owner, or both.');
      return;
    }
    super.submit();
  }

  protected successMessage() {
    return this.entry() ? 'Entry saved.' : 'Entry added.';
  }
}
