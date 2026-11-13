import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AttachmentMeta } from '../../core/attachments.api';
import { SettingsStore } from '../../core/settings.store';
import { countryOptions } from '../../shared/countries';
import { Btn, Field, FileInput, MultiSelect, Select, SelectOption } from '../../ui';
import { Distributor, Product } from '../ops/models';

/** the kinds of address a distributor keeps (the client's spec) */
export const ADDRESS_TYPES = ['Registered', 'Billing', 'Warehouse', 'Consignee', 'Delivery'] as const;
/** where an agreement stands */
export const AGREEMENT_STATUSES = ['Draft', 'Under review', 'Signed', 'Expired', 'Terminated'] as const;
export const PAYMENT_TERM_TYPES = ['Advance', 'Credit days', 'On shipment', 'On documents', 'Custom schedule'] as const;
export const PAYMENT_TRIGGERS = ['On order', 'Before shipment', 'On shipment', 'On documents', 'On arrival', 'After invoice'] as const;
export const BANK_CHARGES = ['Sender', 'Receiver', 'Shared'] as const;

/** the international part of the distributor form, as its own form group */
export function intlGroup(fb: FormBuilder) {
  return fb.nonNullable.group({
    legalName: [''],
    website: [''],
    classification: [''],
    country: [''],
    registrationNo: [''],
    registrationAuthority: [''],
    registrationExpiry: [''],
    taxTreatment: [''],
    licenceNo: [''],
    licenceAuthority: [''],
    licenceIssued: [''],
    licenceExpiry: [''],
    accountManager: [''],
    salesTeam: [''],
    salesChannel: [''],
    contacts: fb.array<FormGroup>([]),
    addresses: fb.array<FormGroup>([]),
    kycDocs: fb.array<FormGroup>([]),
    agreementStart: [''],
    agreementEnd: [''],
    renewalNoticeDays: [null as number | null],
    noticePeriodDays: [null as number | null],
    agreementVersion: [''],
    agreementStatus: ['Draft'],
    agreementFile: [null as AttachmentMeta | null],
    moq: [''],
    quarterlyTarget: [0],
    annualTarget: [0],
    approvedProductIds: [[] as string[]],
    invoiceCurrency: [''],
    incoterm: [''],
    incotermPlace: [''],
    incotermVersion: ['Incoterms 2020'],
    paymentTermType: [''],
    paymentPlan: fb.array<FormGroup>([]),
    settlementMethods: [[] as string[]],
    bankCharges: [''],
    minMarginPct: [10],
    bankAccounts: fb.array<FormGroup>([]),
    originPort: [''], dischargePort: [''], finalDestination: [''], shippingMode: [''], containerPreference: [''],
    importerOfRecord: [''], notifyParty: [''], freightConfirmed: [false], forwarderName: [''], forwarderContact: [''], forwarderRef: [''],
    recallContactName: [''], recallContactEmail: [''], recallContactPhone: [''], recallSopFile: [null as AttachmentMeta | null],
  });
}
export type IntlGroup = ReturnType<typeof intlGroup>;

const contactGroup = (fb: FormBuilder, c?: Partial<NonNullable<Distributor['contacts']>[number]>) => fb.nonNullable.group({
  name: [c?.name ?? ''], role: [c?.role ?? ''], email: [c?.email ?? ''], phoneCode: [c?.phoneCode ?? ''],
  mobile: [c?.mobile ?? ''], whatsapp: [c?.whatsapp ?? ''], isPrimary: [c?.isPrimary ?? false],
});
const addressGroup = (fb: FormBuilder, a?: Partial<NonNullable<Distributor['addresses']>[number]>) => fb.nonNullable.group({
  type: [a?.type ?? 'Registered'], line: [a?.line ?? ''], city: [a?.city ?? ''], region: [a?.region ?? ''],
  postalCode: [a?.postalCode ?? ''], country: [a?.country ?? ''], isDefault: [a?.isDefault ?? false],
});
const kycGroup = (fb: FormBuilder, k?: Partial<NonNullable<Distributor['kycDocs']>[number]>) => fb.nonNullable.group({
  type: [k?.type ?? ''], file: [(k?.file ?? null) as AttachmentMeta | null], expiry: [k?.expiry ?? ''],
});

const milestoneGroup = (fb: FormBuilder, m?: Partial<NonNullable<Distributor['paymentPlan']>[number]>) => fb.nonNullable.group({
  label: [m?.label ?? ''], pct: [m?.pct ?? 0], trigger: [m?.trigger ?? 'On order'], days: [m?.days ?? 0],
});
const bankGroup = (fb: FormBuilder, b?: Partial<NonNullable<Distributor['bankAccounts']>[number]>) => fb.nonNullable.group({
  beneficiary: [b?.beneficiary ?? ''], bankName: [b?.bankName ?? ''], account: [b?.account ?? ''], iban: [b?.iban ?? ''],
  swift: [b?.swift ?? ''], currency: [b?.currency ?? ''], isDefault: [b?.isDefault ?? false],
  /** shown only; the server keeps or clears it */
  verified: [b?.verifiedAt ? `Verified by ${b.verifiedBy ?? 'Finance'}` : ''],
});

/** fills the international group from a distributor (or empties it) */
export function intlReset(fb: FormBuilder, g: IntlGroup, d: Distributor | null) {
  const arr = (name: 'contacts' | 'addresses' | 'kycDocs' | 'paymentPlan' | 'bankAccounts') => g.controls[name] as FormArray<FormGroup>;
  arr('contacts').clear();
  arr('addresses').clear();
  arr('kycDocs').clear();
  arr('paymentPlan').clear();
  arr('bankAccounts').clear();
  for (const m of d?.paymentPlan ?? []) arr('paymentPlan').push(milestoneGroup(fb, m));
  for (const b of d?.bankAccounts ?? []) arr('bankAccounts').push(bankGroup(fb, b));
  for (const c of d?.contacts ?? []) arr('contacts').push(contactGroup(fb, c));
  for (const a of d?.addresses ?? []) arr('addresses').push(addressGroup(fb, a));
  for (const k of d?.kycDocs ?? []) arr('kycDocs').push(kycGroup(fb, k));
  g.reset({
    legalName: d?.legalName ?? '', website: d?.website ?? '', classification: d?.classification ?? '', country: d?.country ?? '',
    registrationNo: d?.registrationNo ?? '', registrationAuthority: d?.registrationAuthority ?? '', registrationExpiry: d?.registrationExpiry ?? '',
    taxTreatment: d?.taxTreatment ?? '', licenceNo: d?.licenceNo ?? '', licenceAuthority: d?.licenceAuthority ?? '',
    licenceIssued: d?.licenceIssued ?? '', licenceExpiry: d?.licenceExpiry ?? '', accountManager: d?.accountManager ?? '',
    salesTeam: d?.salesTeam ?? '', salesChannel: d?.salesChannel ?? '', agreementStart: d?.agreementStart ?? '', agreementEnd: d?.agreementEnd ?? '',
    renewalNoticeDays: d?.renewalNoticeDays ?? null, noticePeriodDays: d?.noticePeriodDays ?? null, agreementVersion: d?.agreementVersion ?? '',
    agreementStatus: d?.agreementStatus ?? 'Draft', agreementFile: d?.agreementFile ?? null, moq: d?.moq ?? '',
    quarterlyTarget: Number(d?.quarterlyTarget ?? 0), annualTarget: Number(d?.annualTarget ?? 0), approvedProductIds: d?.approvedProductIds ?? [],
    invoiceCurrency: d?.invoiceCurrency ?? '', incoterm: d?.incoterm ?? '', incotermPlace: d?.incotermPlace ?? '',
    incotermVersion: d?.incotermVersion ?? 'Incoterms 2020', paymentTermType: d?.paymentTermType ?? '', settlementMethods: d?.settlementMethods ?? [],
    bankCharges: d?.bankCharges ?? '', minMarginPct: Number(d?.minMarginPct ?? 10),
    originPort: d?.originPort ?? '', dischargePort: d?.dischargePort ?? '', finalDestination: d?.finalDestination ?? '',
    shippingMode: d?.shippingMode ?? '', containerPreference: d?.containerPreference ?? '', importerOfRecord: d?.importerOfRecord ?? '',
    notifyParty: d?.notifyParty ?? '', freightConfirmed: !!d?.freightConfirmed, forwarderName: d?.forwarderName ?? '',
    forwarderContact: d?.forwarderContact ?? '', forwarderRef: d?.forwarderRef ?? '', recallContactName: d?.recallContactName ?? '',
    recallContactEmail: d?.recallContactEmail ?? '', recallContactPhone: d?.recallContactPhone ?? '', recallSopFile: d?.recallSopFile ?? null,
  });
  (d?.paymentPlan ?? []).forEach((m, i) => arr('paymentPlan').at(i).reset({ ...milestoneGroup(fb, m).getRawValue() }));
  (d?.bankAccounts ?? []).forEach((b, i) => arr('bankAccounts').at(i).reset({ ...bankGroup(fb, b).getRawValue() }));
  // reset() above puts the rows back to their first values; set them again
  (d?.contacts ?? []).forEach((c, i) => arr('contacts').at(i).reset({ ...contactGroup(fb, c).getRawValue() }));
  (d?.addresses ?? []).forEach((a, i) => arr('addresses').at(i).reset({ ...addressGroup(fb, a).getRawValue() }));
  (d?.kycDocs ?? []).forEach((k, i) => arr('kycDocs').at(i).reset({ ...kycGroup(fb, k).getRawValue() }));
}

/** the international group as the API wants it (empty text -> null, empty rows dropped) */
export function intlValue(g: IntlGroup) {
  const v = g.getRawValue();
  const t = (s: string) => s.trim() || null;
  const n = (x: number | null) => (x === null || (x as unknown) === '' ? null : Number(x));
  return {
    legalName: t(v.legalName), website: t(v.website), classification: t(v.classification), country: t(v.country),
    registrationNo: t(v.registrationNo), registrationAuthority: t(v.registrationAuthority), registrationExpiry: t(v.registrationExpiry),
    taxTreatment: t(v.taxTreatment), licenceNo: t(v.licenceNo), licenceAuthority: t(v.licenceAuthority),
    licenceIssued: t(v.licenceIssued), licenceExpiry: t(v.licenceExpiry), accountManager: t(v.accountManager), salesTeam: t(v.salesTeam),
    salesChannel: t(v.salesChannel),
    contacts: (v.contacts as Record<string, string | boolean>[]).filter((c) => String(c['name']).trim()).map((c) => ({
      name: String(c['name']).trim(), role: t(String(c['role'])) ?? undefined, email: t(String(c['email'])) ?? undefined,
      phoneCode: t(String(c['phoneCode'])) ?? undefined, mobile: t(String(c['mobile'])) ?? undefined, whatsapp: t(String(c['whatsapp'])) ?? undefined,
      isPrimary: !!c['isPrimary'],
    })),
    addresses: (v.addresses as Record<string, string | boolean>[]).filter((a) => String(a['line']).trim() && String(a['country']).trim()).map((a) => ({
      type: a['type'], line: String(a['line']).trim(), city: t(String(a['city'])) ?? undefined, region: t(String(a['region'])) ?? undefined,
      postalCode: t(String(a['postalCode'])) ?? undefined, country: String(a['country']).trim(), isDefault: !!a['isDefault'],
    })),
    kycDocs: (v.kycDocs as { type: string; file: AttachmentMeta | null; expiry: string }[]).filter((k) => k.type && k.file).map((k) => ({
      type: k.type, file: k.file, expiry: k.expiry || null,
    })),
    agreementStart: t(v.agreementStart), agreementEnd: t(v.agreementEnd), renewalNoticeDays: n(v.renewalNoticeDays),
    noticePeriodDays: n(v.noticePeriodDays), agreementVersion: t(v.agreementVersion), agreementStatus: v.agreementStatus,
    agreementFile: v.agreementFile, moq: t(v.moq), quarterlyTarget: Number(v.quarterlyTarget) || 0, annualTarget: Number(v.annualTarget) || 0,
    approvedProductIds: v.approvedProductIds,
    invoiceCurrency: t(v.invoiceCurrency), incoterm: t(v.incoterm), incotermPlace: t(v.incotermPlace),
    incotermVersion: v.incotermVersion.trim() || 'Incoterms 2020', paymentTermType: t(v.paymentTermType),
    paymentPlan: (v.paymentPlan as { label: string; pct: number; trigger: string; days: number }[])
      .filter((m) => m.label.trim() && Number(m.pct) > 0)
      .map((m) => ({ label: m.label.trim(), pct: Number(m.pct), trigger: m.trigger, days: Number(m.days) || 0 })),
    settlementMethods: v.settlementMethods, bankCharges: t(v.bankCharges), minMarginPct: Number(v.minMarginPct) || 0,
    bankAccounts: (v.bankAccounts as Record<string, string | boolean>[])
      .filter((b) => String(b['beneficiary']).trim() && String(b['bankName']).trim() && String(b['account']).trim())
      .map((b) => ({
        beneficiary: String(b['beneficiary']).trim(), bankName: String(b['bankName']).trim(), account: String(b['account']).trim(),
        iban: t(String(b['iban'])), swift: t(String(b['swift'])), currency: t(String(b['currency'])), isDefault: !!b['isDefault'],
      })),
    originPort: t(v.originPort), dischargePort: t(v.dischargePort), finalDestination: t(v.finalDestination), shippingMode: t(v.shippingMode),
    containerPreference: t(v.containerPreference), importerOfRecord: t(v.importerOfRecord), notifyParty: t(v.notifyParty),
    freightConfirmed: v.freightConfirmed, forwarderName: t(v.forwarderName), forwarderContact: t(v.forwarderContact), forwarderRef: t(v.forwarderRef),
    recallContactName: t(v.recallContactName), recallContactEmail: t(v.recallContactEmail), recallContactPhone: t(v.recallContactPhone),
    recallSopFile: v.recallSopFile,
  };
}

/**
 * The international set-up of a distributor (the client's spec, sections 1 and 2): company identity and licences,
 * contacts, addresses, KYC documents, the agreement and the approved products. Lives inside the distributor form.
 */
@Component({
  selector: 'app-intl-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Field, Btn, Select, MultiSelect, FileInput],
  styles: `
    :host {
      display: contents;
    }

    .form-section {
      grid-column: 1 / -1;
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    .rows {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
      align-items: end;
      gap: var(--space-2);
      padding-block-end: var(--space-3);
      border-block-end: 1px solid var(--border);
    }

    .warn {
      margin: 0;
      color: var(--danger);
      font-size: var(--text-sm);
    }

    /* a payment instalment: everything on one line */
    .row--plan {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr) auto;
    }

    /* a KYC document: type, expiry and remove on one line, the file below at full width */
    .row--doc {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;

      & .row__file {
        grid-column: 1 / -1;
      }
    }

    .row__end {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      block-size: var(--control-h);
      font-size: var(--text-sm);
      white-space: nowrap;
    }
  `,
  template: `
    <ng-container [formGroup]="group()">
      <h4 class="form-section">Company identity {{ code() ? '· ' + code() : '' }}</h4>
      <app-field label="Legal company name" [wide]="true" hint="Exactly as registered; used on invoices and export documents">
        <input type="text" formControlName="legalName" maxlength="200" />
      </app-field>
      <app-field label="Website"><input type="text" formControlName="website" maxlength="200" placeholder="https://" /></app-field>
      <app-field label="Classification">
        <app-select formControlName="classification" [options]="classifications()" placeholder="Importer, wholesaler ..." />
      </app-field>
      <app-field label="Country of registration">
        <app-select formControlName="country" [options]="countries" placeholder="Choose a country" />
      </app-field>
      <app-field label="Business registration no."><input type="text" formControlName="registrationNo" maxlength="80" /></app-field>
      <app-field label="Issuing authority"><input type="text" formControlName="registrationAuthority" maxlength="150" /></app-field>
      <app-field label="Registration expiry"><input type="date" formControlName="registrationExpiry" /></app-field>
      <app-field label="Tax treatment" hint="VAT registered, exempt ... (the tax number is above)"><input type="text" formControlName="taxTreatment" maxlength="150" /></app-field>
      <app-field label="Import / food licence no."><input type="text" formControlName="licenceNo" maxlength="80" /></app-field>
      <app-field label="Licence authority"><input type="text" formControlName="licenceAuthority" maxlength="150" /></app-field>
      <app-field label="Licence issued"><input type="date" formControlName="licenceIssued" /></app-field>
      <app-field label="Licence expiry"><input type="date" formControlName="licenceExpiry" /></app-field>
      <app-field label="Account manager" hint="Zen Foods relationship manager"><input type="text" formControlName="accountManager" maxlength="120" /></app-field>
      <app-field label="Sales team"><input type="text" formControlName="salesTeam" maxlength="120" /></app-field>
      <app-field label="Sales channel" hint="Modern trade, general trade, online"><input type="text" formControlName="salesChannel" maxlength="120" /></app-field>

      <h4 class="form-section">Contacts</h4>
      <div class="rows" formArrayName="contacts">
        @for (c of contacts.controls; track c; let i = $index) {
          <div class="row" [formGroupName]="i">
            <app-field label="Name" [required]="true"><input type="text" formControlName="name" maxlength="120" /></app-field>
            <app-field label="Role"><input type="text" formControlName="role" maxlength="80" /></app-field>
            <app-field label="Email"><input type="email" formControlName="email" maxlength="150" /></app-field>
            <app-field label="Code"><input type="text" formControlName="phoneCode" maxlength="8" placeholder="+971" /></app-field>
            <app-field label="Mobile"><input type="text" formControlName="mobile" maxlength="30" /></app-field>
            <app-field label="WhatsApp"><input type="text" formControlName="whatsapp" maxlength="30" /></app-field>
            <span class="row__end">
              <label><input type="radio" name="primary-contact" [checked]="c.value.isPrimary" (change)="only(contacts, i, 'isPrimary')" /> Primary</label>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(contacts, i)" [attr.aria-label]="'Remove contact ' + (i + 1)"></button>
            </span>
          </div>
        }
        <div><button appBtn type="button" size="sm" icon="plus" (click)="addContact()">Add contact</button></div>
      </div>

      <h4 class="form-section">Addresses</h4>
      <div class="rows" formArrayName="addresses">
        @for (a of addresses.controls; track a; let i = $index) {
          <div class="row" [formGroupName]="i">
            <app-field label="Type">
              <select formControlName="type">
                @for (t of addressTypes; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </app-field>
            <app-field label="Address" [required]="true"><input type="text" formControlName="line" maxlength="300" /></app-field>
            <app-field label="City"><input type="text" formControlName="city" maxlength="80" /></app-field>
            <app-field label="Region"><input type="text" formControlName="region" maxlength="80" /></app-field>
            <app-field label="Postal code"><input type="text" formControlName="postalCode" maxlength="20" /></app-field>
            <app-field label="Country" [required]="true"><app-select formControlName="country" [options]="countries" placeholder="Country" [clearable]="false" /></app-field>
            <span class="row__end">
              <label><input type="checkbox" formControlName="isDefault" /> Default</label>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(addresses, i)" [attr.aria-label]="'Remove address ' + (i + 1)"></button>
            </span>
          </div>
        }
        <div><button appBtn type="button" size="sm" icon="plus" (click)="addAddress()">Add address</button></div>
      </div>

      <h4 class="form-section">KYC documents</h4>
      <div class="rows" formArrayName="kycDocs">
        @for (k of kycDocs.controls; track k; let i = $index) {
          <div class="row row--doc" [formGroupName]="i">
            <app-field label="Document" [required]="true">
              <select formControlName="type">
                <option value="">Choose a type</option>
                @for (t of kycTypes(); track t.code) {
                  <option [value]="t.code">{{ t.code }}{{ t.required ? ' (required)' : '' }}</option>
                }
              </select>
            </app-field>
            <app-field label="Expiry"><input type="date" formControlName="expiry" /></app-field>
            <span class="row__end">
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(kycDocs, i)" [attr.aria-label]="'Remove document ' + (i + 1)"></button>
            </span>
            <app-field class="row__file" label="File" [required]="true"><app-file-input formControlName="file" /></app-field>
          </div>
        }
        <div><button appBtn type="button" size="sm" icon="plus" (click)="addKyc()">Add document</button></div>
      </div>

      <h4 class="form-section">Distribution agreement</h4>
      <app-field label="Start"><input type="date" formControlName="agreementStart" /></app-field>
      <app-field label="End"><input type="date" formControlName="agreementEnd" /></app-field>
      <app-field label="Status">
        <select formControlName="agreementStatus">
          @for (s of agreementStatuses; track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
      </app-field>
      <app-field label="Renewal notice (days)" hint="Before the end date"><input type="number" formControlName="renewalNoticeDays" min="0" step="1" /></app-field>
      <app-field label="Notice period (days)" hint="To terminate"><input type="number" formControlName="noticePeriodDays" min="0" step="1" /></app-field>
      <app-field label="Version"><input type="text" formControlName="agreementVersion" maxlength="40" /></app-field>
      <app-field label="Signed agreement" [wide]="true"><app-file-input formControlName="agreementFile" label="Upload the signed copy" /></app-field>
      <app-field label="Minimum order" [wide]="true" hint="By SKU, carton, pallet or container"><input type="text" formControlName="moq" maxlength="300" /></app-field>
      <app-field label="Quarterly target (PKR)"><input type="number" formControlName="quarterlyTarget" min="0" step="1" /></app-field>
      <app-field label="Annual target (PKR)"><input type="number" formControlName="annualTarget" min="0" step="1" /></app-field>
      <app-field label="Approved products" [wide]="true" hint="SKUs this distributor may sell abroad; each gets its price under Credit & prices">
        <app-multi-select formControlName="approvedProductIds" [options]="productOptions()" placeholder="Add a product" />
      </app-field>

      <h4 class="form-section">Currency, Incoterms &amp; payment terms</h4>
      <app-field label="Invoice currency" hint="PKR stays the reporting currency">
        <app-select formControlName="invoiceCurrency" [options]="currencyOptions()" placeholder="USD, AED, EUR ..." />
      </app-field>
      <app-field label="Incoterm"><app-select formControlName="incoterm" [options]="incoterms()" placeholder="FOB, CIF ..." /></app-field>
      <app-field label="Named port / place"><input type="text" formControlName="incotermPlace" maxlength="120" placeholder="Jebel Ali, Dubai" /></app-field>
      <app-field label="Incoterms version"><input type="text" formControlName="incotermVersion" maxlength="20" /></app-field>
      <app-field label="Payment terms">
        <select formControlName="paymentTermType">
          <option value="">Choose terms</option>
          @for (t of termTypes; track t) {
            <option [value]="t">{{ t }}</option>
          }
        </select>
      </app-field>
      <app-field label="Bank charges" hint="Who bears them">
        <select formControlName="bankCharges">
          <option value="">Not agreed yet</option>
          @for (c of bankChargeOptions; track c) {
            <option [value]="c">{{ c }}</option>
          }
        </select>
      </app-field>
      <app-field label="Remittance methods" [wide]="true">
        <app-multi-select formControlName="settlementMethods" [options]="remittanceMethods()" placeholder="Bank transfer, LC ..." />
      </app-field>
      <app-field label="Minimum margin (%)" hint="A price under it waits for Finance. 0 = no check">
        <input type="number" formControlName="minMarginPct" min="0" max="100" step="0.5" />
      </app-field>

      <h4 class="form-section">Payment plan {{ planTotal() ? '· ' + planTotal() + '%' : '' }}</h4>
      <div class="rows" formArrayName="paymentPlan">
        @if (paymentPlan.length && planTotal() !== 100) {
          <p class="warn">The instalments add up to {{ planTotal() }}%; they must make 100%.</p>
        }
        @for (m of paymentPlan.controls; track m; let i = $index) {
          <div class="row row--plan" [formGroupName]="i">
            <app-field label="Instalment" [required]="true"><input type="text" formControlName="label" maxlength="80" placeholder="Advance" /></app-field>
            <app-field label="Share (%)" [required]="true"><input type="number" formControlName="pct" min="0" max="100" step="1" /></app-field>
            <app-field label="Due">
              <select formControlName="trigger">
                @for (t of triggers; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </app-field>
            <app-field label="Days after"><input type="number" formControlName="days" min="0" max="365" step="1" /></app-field>
            <span class="row__end">
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(paymentPlan, i)" [attr.aria-label]="'Remove instalment ' + (i + 1)"></button>
            </span>
          </div>
        }
        <div><button appBtn type="button" size="sm" icon="plus" (click)="addMilestone()">Add instalment</button></div>
      </div>

      <h4 class="form-section">Distributor bank accounts</h4>
      <div class="rows" formArrayName="bankAccounts">
        @for (b of bankAccounts.controls; track b; let i = $index) {
          <div class="row" [formGroupName]="i">
            <app-field label="Beneficiary" [required]="true"><input type="text" formControlName="beneficiary" maxlength="150" /></app-field>
            <app-field label="Bank" [required]="true"><input type="text" formControlName="bankName" maxlength="120" /></app-field>
            <app-field label="Account no." [required]="true"><input type="text" formControlName="account" maxlength="40" /></app-field>
            <app-field label="IBAN"><input type="text" formControlName="iban" maxlength="40" /></app-field>
            <app-field label="SWIFT / BIC"><input type="text" formControlName="swift" maxlength="11" /></app-field>
            <app-field label="Currency"><app-select formControlName="currency" [options]="currencyOptions()" placeholder="Currency" /></app-field>
            <span class="row__end">
              <label><input type="radio" name="default-bank" [checked]="b.value.isDefault" (change)="only(bankAccounts, i, 'isDefault')" /> Default</label>
              <small class="muted">{{ b.value.verified || 'Not verified' }}</small>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(bankAccounts, i)" [attr.aria-label]="'Remove bank account ' + (i + 1)"></button>
            </span>
          </div>
        }
        <p class="muted">Finance verifies each account under Credit &amp; prices. Changing an account's details clears its verification.</p>
        <div><button appBtn type="button" size="sm" icon="plus" (click)="addBank()">Add bank account</button></div>
      </div>

      <h4 class="form-section">Logistics preferences</h4>
      <app-field label="Origin port"><input type="text" formControlName="originPort" maxlength="120" placeholder="Karachi" /></app-field>
      <app-field label="Discharge port"><input type="text" formControlName="dischargePort" maxlength="120" /></app-field>
      <app-field label="Final destination"><input type="text" formControlName="finalDestination" maxlength="120" /></app-field>
      <app-field label="Shipping mode">
        <select formControlName="shippingMode"><option value="">-</option><option>Sea</option><option>Air</option><option>Road</option></select>
      </app-field>
      <app-field label="Container preference" [wide]="true" hint="20GP, 40HC, LCL ... and any weight limits"><input type="text" formControlName="containerPreference" maxlength="200" /></app-field>
      <app-field label="Importer of record"><input type="text" formControlName="importerOfRecord" maxlength="200" /></app-field>
      <app-field label="Notify party"><input type="text" formControlName="notifyParty" maxlength="200" /></app-field>
      <app-field label="Freight & insurance payer" hint="Follows the Incoterm"><label><input type="checkbox" formControlName="freightConfirmed" /> Confirmed with the distributor</label></app-field>
      <app-field label="Forwarder / clearing agent"><input type="text" formControlName="forwarderName" maxlength="150" /></app-field>
      <app-field label="Agent contact"><input type="text" formControlName="forwarderContact" maxlength="200" /></app-field>
      <app-field label="Agreed reference"><input type="text" formControlName="forwarderRef" maxlength="80" /></app-field>

      <h4 class="form-section">Recall contact (needed to activate)</h4>
      <app-field label="Name"><input type="text" formControlName="recallContactName" maxlength="120" /></app-field>
      <app-field label="Email"><input type="email" formControlName="recallContactEmail" maxlength="150" /></app-field>
      <app-field label="Phone"><input type="text" formControlName="recallContactPhone" maxlength="40" /></app-field>
      <app-field label="Recall procedure (SOP)" [wide]="true"><app-file-input formControlName="recallSopFile" label="Upload the SOP" /></app-field>
    </ng-container>
  `,
})
export class IntlFields {
  private fb = inject(FormBuilder);
  private store = inject(SettingsStore);

  readonly group = input.required<IntlGroup>();
  readonly products = input<Product[]>([]);
  /** the distributor ID, once it has one */
  readonly code = input<string | null>(null);

  protected countries = countryOptions();
  protected addressTypes = ADDRESS_TYPES;
  protected agreementStatuses = AGREEMENT_STATUSES;
  protected classifications = computed<SelectOption<string>[]>(() => this.store.options('DIST_CLASSIFICATION').map((c) => ({ value: c, label: c })));
  protected kycTypes = computed(() => this.store.lookups().filter((l) => l.list === 'KYC_DOC_TYPE' && l.active).map((l) => ({ code: l.code, required: !!l.flags?.['required'] })));
  protected termTypes = PAYMENT_TERM_TYPES;
  protected triggers = PAYMENT_TRIGGERS;
  protected bankChargeOptions = BANK_CHARGES;
  protected currencyOptions = computed<SelectOption<string>[]>(() => this.store.currencies().map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })));
  protected incoterms = computed<SelectOption<string>[]>(() => this.store.options('INCOTERM').map((c) => ({ value: c, label: c })));
  protected remittanceMethods = computed<SelectOption<string>[]>(() => this.store.options('REMITTANCE_METHOD').map((c) => ({ value: c, label: c })));
  /** the plan's total, kept current as the rows change */
  protected planTotal = signal(0);
  protected productOptions = computed<SelectOption<string>[]>(() =>
    this.products().map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}`, sub: p.packetSize ?? undefined })));

  protected get contacts() {
    return this.group().controls.contacts as FormArray<FormGroup>;
  }
  protected get addresses() {
    return this.group().controls.addresses as FormArray<FormGroup>;
  }
  protected get kycDocs() {
    return this.group().controls.kycDocs as FormArray<FormGroup>;
  }
  protected get paymentPlan() {
    return this.group().controls.paymentPlan as FormArray<FormGroup>;
  }
  protected get bankAccounts() {
    return this.group().controls.bankAccounts as FormArray<FormGroup>;
  }

  constructor() {
    // the plan total follows the rows (the group itself can be swapped)
    effect((onCleanup) => {
      const plan = this.group().controls.paymentPlan as FormArray<FormGroup>;
      const sum = () => this.planTotal.set(Math.round((plan.getRawValue() as { pct: number }[]).reduce((s, m) => s + (Number(m.pct) || 0), 0) * 100) / 100);
      sum();
      const sub = plan.valueChanges.subscribe(sum);
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected addMilestone() {
    const left = Math.max(0, 100 - this.planTotal());
    this.paymentPlan.push(milestoneGroup(this.fb, { label: this.paymentPlan.length ? 'Balance' : 'Advance', pct: left, trigger: this.paymentPlan.length ? 'On documents' : 'On order' }));
    this.group().markAsDirty();
  }
  protected addBank() {
    this.bankAccounts.push(bankGroup(this.fb, { beneficiary: this.group().controls.legalName.value, currency: this.group().controls.invoiceCurrency.value, isDefault: this.bankAccounts.length === 0 }));
    this.group().markAsDirty();
  }

  protected addContact() {
    this.contacts.push(contactGroup(this.fb, { isPrimary: this.contacts.length === 0 }));
    this.group().markAsDirty();
  }
  protected addAddress() {
    this.addresses.push(addressGroup(this.fb, { type: this.addresses.length ? 'Delivery' : 'Registered', country: this.group().controls.country.value, isDefault: true }));
    this.group().markAsDirty();
  }
  protected addKyc() {
    const have = new Set((this.kycDocs.value as { type: string }[]).map((k) => k.type));
    this.kycDocs.push(kycGroup(this.fb, { type: this.kycTypes().find((t) => !have.has(t.code))?.code ?? '' }));
    this.group().markAsDirty();
  }
  protected remove(arr: FormArray<FormGroup>, i: number) {
    arr.removeAt(i);
    this.group().markAsDirty();
  }
  /** one row of the list has the flag (primary contact) */
  protected only(arr: FormArray<FormGroup>, i: number, flag: string) {
    arr.controls.forEach((g, j) => g.patchValue({ [flag]: j === i }));
    this.group().markAsDirty();
  }
}
