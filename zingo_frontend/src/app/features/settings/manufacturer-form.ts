import { AttachmentMeta } from '../../core/attachments.api';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { Btn, Field, FilesInput, MoneyInput, MultiSelect, Offcanvas, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Manufacturer, PartnerBankAccount } from '../ops/models';
import { SettingsApi } from './settings.api';

/**
 * Add or change a contract manufacturer: who makes the goods, the payment terms (advance % on every order,
 * days to pay the balance, currency), the bank accounts its payment invoices go to (one default),
 * and the contract.
 */
@Component({
  selector: 'app-manufacturer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilesInput, ReactiveFormsModule, Offcanvas, Field, Btn, Select, MultiSelect, MoneyInput],
  styles: `
    .form-section {
      grid-column: 1 / -1;
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    .banks {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .bank {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1fr) auto auto;
      align-items: end;
      gap: var(--space-2);
      padding-block-end: var(--space-3);
      border-block-end: 1px solid var(--border);

      @media (max-width: 760px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .bank__default {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      block-size: var(--control-h);
      font-size: var(--text-sm);
      white-space: nowrap;
    }

    .banks__empty {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--text-3);
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="manufacturer() ? 'Edit manufacturer' : 'Add manufacturer'"
               subtitle="The factory that makes the goods for Zen Foods." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Name" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
          <input type="text" formControlName="name" maxlength="150" />
        </app-field>
        <app-field label="Contact" [wide]="true"><input type="text" formControlName="contact" maxlength="200" /></app-field>

        <h4 class="form-section">Payment terms</h4>
        <app-field label="Terms" [wide]="true" hint="Pick one or both" [error]="noTerm() ? 'Choose at least one term' : null">
          <app-multi-select formControlName="paymentTerms" [options]="termOptions" placeholder="Add a term" />
        </app-field>
        @if (has('Advance')) {
          <app-field label="Advance on order (%)" hint="Paid when an order is placed" [required]="true"
                     [error]="invalid('advancePct') ? '0 to 100' : null">
            <input type="number" formControlName="advancePct" min="0" max="100" step="1" />
          </app-field>
        }
        @if (has('Credit line')) {
          <app-field label="Credit limit" hint="Most Zen Foods may owe. 0 = no limit">
            <app-money-input formControlName="creditLimit" />
          </app-field>
          <app-field label="Days to clear" hint="After delivery. 0 = no limit" [required]="true" [error]="invalid('paymentDays') ? '0 to 365 days' : null">
            <input type="number" formControlName="paymentDays" min="0" max="365" step="1" />
          </app-field>
        }
        <app-field label="Currency">
          <select formControlName="currency">
            @for (c of currencies(); track c.code) {
              <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </app-field>

        <h4 class="form-section">Bank accounts</h4>
        <div class="banks" formArrayName="bankAccounts">
          @for (g of banks.controls; track g; let i = $index) {
            <div class="bank" [formGroupName]="i">
              <app-field label="Bank" [required]="true" [error]="bankInvalid(i, 'bank') ? 'Choose a bank' : null">
                <app-select formControlName="bank" [options]="bankOptions(g.value.bank)" placeholder="Choose a bank" [clearable]="false" />
              </app-field>
              <app-field label="Account title" [required]="true" [error]="bankInvalid(i, 'title') ? 'Enter the title' : null">
                <input type="text" formControlName="title" maxlength="150" />
              </app-field>
              <app-field label="Account no. / IBAN" [required]="true" [error]="bankInvalid(i, 'account') ? 'Enter the account' : null">
                <input type="text" formControlName="account" maxlength="40" />
              </app-field>
              <app-field label="Branch"><input type="text" formControlName="branch" maxlength="150" /></app-field>
              <label class="bank__default">
                <input type="radio" name="bank-default" [checked]="g.value.isDefault" (change)="makeDefault(i)" /> Default
              </label>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="removeBank(i)" [attr.aria-label]="'Remove bank account ' + (i + 1)"></button>
            </div>
          } @empty {
            <p class="banks__empty">No bank account yet. Payment invoices need at least one.</p>
          }
          <div><button appBtn type="button" size="sm" icon="plus" (click)="addBank()">Add bank account</button></div>
        </div>

        <h4 class="form-section">Contract</h4>
        <app-field label="Point of contact" hint="Who to speak to: name, phone or email"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Contract" hint="Contract number or title"><input type="text" formControlName="contract" maxlength="150" /></app-field>
        <app-field label="Terms" [wide]="true"><textarea formControlName="terms" maxlength="5000" placeholder="What was agreed: rates, payment, delivery, exclusivity"></textarea></app-field>
        <app-field label="Uploads" [wide]="true" hint="Signed contract, licences, pictures. Several files at once"><app-files-input formControlName="files" label="Upload files" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ manufacturer() ? 'Save changes' : 'Add manufacturer' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ManufacturerForm extends FormModal {
  readonly manufacturer = input<Manufacturer | null>(null);
  readonly formId = 'form-manufacturer';
  private store = inject(SettingsStore);
  protected currencies = this.store.currencies;
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    contact: [''],
    paymentTerms: [['Advance'] as string[]],
    advancePct: [30, [Validators.required, Validators.min(0), Validators.max(100)]],
    creditLimit: [0, Validators.min(0)],
    paymentDays: [30, [Validators.required, Validators.min(0), Validators.max(365)]],
    currency: ['PKR'],
    bankAccounts: this.fb.array<FormGroup>([]),
    poc: [''],
    contract: [''],
    terms: [''],
    files: [[] as AttachmentMeta[]],
  });

  /** the two ways a manufacturer can be paid */
  protected termOptions: SelectOption<string>[] = [
    { value: 'Advance', label: 'Advance on order', sub: '% of each order, paid up front' },
    { value: 'Credit line', label: 'Credit line', sub: 'Pay later, up to a limit, within days' },
  ];
  private terms = toSignal(this.form.controls.paymentTerms.valueChanges, { initialValue: this.form.controls.paymentTerms.value });
  protected has = (t: string) => (this.terms() ?? []).includes(t);
  protected noTerm = computed(() => !(this.terms() ?? []).length);

  protected get banks() {
    return this.form.controls.bankAccounts as FormArray<FormGroup>;
  }

  private activeBanks = computed(() => this.store.options('BANK'));

  /** the active banks, plus the one already on this row if it was switched off since */
  protected bankOptions(current: string | null): SelectOption<string>[] {
    const list = this.activeBanks();
    return [...list, ...(current && !list.includes(current) ? [current] : [])].map((b) => ({ value: b, label: b }));
  }

  private bankGroup(a?: Partial<PartnerBankAccount>) {
    return this.fb.nonNullable.group({
      bank: [a?.bank ?? '', Validators.required],
      title: [a?.title ?? this.form?.controls.name.value ?? '', Validators.required],
      account: [a?.account ?? '', Validators.required],
      branch: [a?.branch ?? ''],
      isDefault: [a?.isDefault ?? false],
    });
  }

  protected addBank() {
    this.banks.push(this.bankGroup({ isDefault: this.banks.length === 0 }));
    this.form.markAsDirty();
  }

  protected removeBank(i: number) {
    const wasDefault = this.banks.at(i).value.isDefault;
    this.banks.removeAt(i);
    if (wasDefault && this.banks.length) this.banks.at(0).patchValue({ isDefault: true });
    this.form.markAsDirty();
  }

  protected makeDefault(i: number) {
    this.banks.controls.forEach((g, j) => g.patchValue({ isDefault: j === i }));
    this.form.markAsDirty();
  }

  protected bankInvalid(i: number, name: string) {
    const c = this.banks.at(i)?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected reset() {
    const m = this.manufacturer();
    this.banks.clear();
    for (const a of m?.bankAccounts ?? []) this.banks.push(this.bankGroup(a));
    this.form.reset({
      name: m?.name ?? '', contact: m?.contact ?? '', paymentTerms: m?.paymentTerms?.length ? [...m.paymentTerms] : ['Advance'],
      advancePct: m ? Number(m.advancePct ?? 0) : Number(this.store.settings()?.defaultAdvancePct ?? 30),
      creditLimit: Number(m?.creditLimit ?? 0), paymentDays: m?.paymentDays ?? 30, currency: m?.currency ?? 'PKR', poc: m?.poc ?? '', contract: m?.contract ?? '',
      terms: m?.terms ?? '', files: m?.files ?? [],
    });
    // reset() above would clear the bank rows' values: put them back
    (m?.bankAccounts ?? []).forEach((a, i) => this.banks.at(i).reset({ ...a, branch: a.branch ?? '' }));
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.settingsApi.saveManufacturer(this.manufacturer()?.id ?? null, {
      ...v, paymentDays: Number(v.paymentDays), advancePct: Number(v.advancePct), creditLimit: Number(v.creditLimit),
      bankAccounts: (v.bankAccounts as PartnerBankAccount[]).map((a) => ({ ...a, branch: a.branch?.trim() || undefined })),
    });
  }

  protected successMessage() {
    return this.manufacturer() ? 'Manufacturer updated.' : 'Manufacturer added.';
  }
}
