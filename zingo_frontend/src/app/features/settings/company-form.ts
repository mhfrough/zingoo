import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { PlacesService } from '../../core/places.service';
import { SettingsStore } from '../../core/settings.store';
import { countryOptions } from '../../shared/countries';
import { Btn, Field, MoneyInput, Offcanvas, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Company, SettingsApi } from './settings.api';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** world regions an international company can be in (geography, not a business list) */
export const WORLD_REGIONS = ['Middle East', 'South Asia', 'Central Asia', 'East Asia', 'South-East Asia', 'Europe', 'Africa', 'North America', 'South America', 'Oceania'];

/**
 * Add or change a company of the group: who it is, where it is (local or international), its financial year and
 * currency, and optionally its own money and approvals. Operations and document numbers stay on Settings > General.
 */
@Component({
  selector: 'app-company-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select, MoneyInput],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="company() ? 'Edit company' : 'Add company'"
                   subtitle="A company of the group. The primary one names the business on every page." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <h4 class="form-section">Company</h4>
        <app-field label="Name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
          <input type="text" formControlName="name" maxlength="150" />
        </app-field>
        <app-field label="Legal name"><input type="text" formControlName="legalName" maxlength="200" /></app-field>
        <app-field label="Tax number (NTN)"><input type="text" formControlName="taxNo" maxlength="40" /></app-field>
        <app-field label="Point of contact"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Phone"><input type="tel" formControlName="phone" maxlength="60" /></app-field>
        <app-field label="Email"><input type="email" formControlName="email" maxlength="120" /></app-field>
        <app-field label="Address" [wide]="true"><input type="text" formControlName="address" maxlength="250" /></app-field>

        <h4 class="form-section">Location and money</h4>
        <div class="choice" role="radiogroup" aria-label="Where the company is">
          <label><input type="radio" formControlName="market" value="Local" /> <span><strong>Local</strong> · in Pakistan</span></label>
          <label><input type="radio" formControlName="market" value="International" /> <span><strong>International</strong> · outside Pakistan</span></label>
        </div>
        @if (international()) {
          <app-field label="Region">
            <select formControlName="region">
              <option value="">Choose</option>
              @for (r of regions; track r) {
                <option [value]="r">{{ r }}</option>
              }
            </select>
          </app-field>
          <app-field label="Country" [required]="true" [error]="noCountry() ? 'Choose the country' : null">
            <app-select formControlName="country" [options]="countries" placeholder="Search countries" />
          </app-field>
          <app-field label="State / province"><input type="text" formControlName="state" maxlength="80" /></app-field>
          <app-field label="City"><input type="text" formControlName="city" maxlength="80" /></app-field>
        } @else {
          <app-field label="Province">
            <app-select formControlName="state" [options]="places.provinces()" placeholder="Choose" />
          </app-field>
          <app-field label="City">
            <app-select formControlName="city" [options]="cities()" placeholder="Search cities" />
          </app-field>
        }
        <app-field label="Financial year starts in">
          <select formControlName="fiscalMonth">
            @for (m of months; track m; let i = $index) {
              <option [value]="i + 1">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Currency" hint="The list is on Settings & Data">
          <app-select formControlName="currency" [options]="currencies()" [clearable]="false" />
        </app-field>

        <h4 class="form-section">Money and approvals <small>(optional)</small></h4>
        <app-field label="Two signatures from" hint="Empty = not set for this company">
          <app-money-input formControlName="approvalThreshold" />
        </app-field>
        <app-field label="Signatory A"><input type="text" formControlName="signatoryA" maxlength="120" /></app-field>
        <app-field label="Signatory B"><input type="text" formControlName="signatoryB" maxlength="120" /></app-field>
        <app-field label="Capital target" hint="What this company plans to raise. Empty = not set">
          <app-money-input formControlName="capitalTarget" />
        </app-field>

        @if (!company()?.primary) {
          <h4 class="form-section">Status</h4>
          <app-field label="Status">
            <select formControlName="active">
              <option value="true">Active</option>
              <option value="false">Switched off</option>
            </select>
          </app-field>
          <label class="check field--wide"><input type="checkbox" formControlName="primary" /> Primary company (names the business on every page)</label>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ company() ? 'Save changes' : 'Add company' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
  styles: `
    .form-section small {
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
    }

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
  `,
})
export class CompanyForm extends FormModal {
  readonly company = input<Company | null>(null);
  readonly formId = 'form-company';
  private settingsApi = inject(SettingsApi);
  private store = inject(SettingsStore);
  protected places = inject(PlacesService);
  protected months = MONTHS;
  protected regions = WORLD_REGIONS;
  protected countries = countryOptions();

  readonly form = this.fb.group({
    name: this.fb.nonNullable.control('', Validators.required),
    legalName: this.fb.nonNullable.control(''),
    taxNo: this.fb.nonNullable.control(''),
    poc: this.fb.nonNullable.control(''),
    phone: this.fb.nonNullable.control(''),
    email: this.fb.nonNullable.control(''),
    address: this.fb.nonNullable.control(''),
    market: this.fb.nonNullable.control<'Local' | 'International'>('Local'),
    region: this.fb.nonNullable.control(''),
    country: this.fb.control<string | null>(null),
    state: this.fb.control<string | null>(null),
    city: this.fb.control<string | null>(null),
    fiscalMonth: this.fb.nonNullable.control('7'),
    currency: this.fb.nonNullable.control('PKR'),
    approvalThreshold: this.fb.control<number | null>(null),
    signatoryA: this.fb.nonNullable.control(''),
    signatoryB: this.fb.nonNullable.control(''),
    capitalTarget: this.fb.control<number | null>(null),
    primary: this.fb.nonNullable.control(false),
    active: this.fb.nonNullable.control('true'),
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected international = computed(() => this.value().market === 'International');
  /** Save was pressed: the country check shows from then on */
  private tried = signal(false);
  protected noCountry = computed(() => this.international() && this.tried() && !this.value().country);
  protected cities = computed<SelectOption<string>[]>(() => this.places.cities(this.value().state || null));
  protected currencies = computed<SelectOption<string>[]>(() => this.store.currencies().map((c) => ({ value: c.code, label: c.code, sub: c.name })));

  constructor() {
    super();
    this.places.load();
    // a new province clears a city of another province
    this.form.controls.state.valueChanges.subscribe(() => {
      const v = this.form.getRawValue();
      if (v.market === 'Local' && v.city && !this.places.cities(v.state || null).some((c) => c.value === v.city)) this.form.controls.city.setValue(null);
    });
    // switching between local and international starts the place afresh
    this.form.controls.market.valueChanges.subscribe(() => this.form.patchValue({ region: '', country: null, state: null, city: null }, { emitEvent: true }));
  }

  protected reset() {
    this.tried.set(false);
    const c = this.company();
    const local = (c?.market ?? 'Local') !== 'International';
    this.form.reset({
      name: c?.name ?? '', legalName: c?.legalName ?? '', taxNo: c?.taxNo ?? '', poc: c?.poc ?? '', phone: c?.phone ?? '',
      email: c?.email ?? '', address: c?.address ?? '',
      market: local ? 'Local' : 'International', region: c?.region ?? '', country: local ? null : c?.country || null,
      state: c?.state || null, city: c?.city || null,
      fiscalMonth: String(c?.fiscalMonth ?? this.store.settings()?.fiscalMonth ?? 7), currency: c?.currency ?? 'PKR',
      approvalThreshold: c?.approvalThreshold ?? null, signatoryA: c?.signatoryA ?? '', signatoryB: c?.signatoryB ?? '', capitalTarget: c?.capitalTarget ?? null,
      primary: !!c?.primary, active: String(c?.active ?? true),
    }, { emitEvent: false });
    this.form.updateValueAndValidity();
  }

  protected override submit() {
    const v = this.form.getRawValue();
    if (v.market === 'International' && !v.country) {
      this.tried.set(true);
      this.error.set('Choose the country of an international company.');
      return;
    }
    super.submit();
  }

  protected request() {
    const v = this.form.getRawValue();
    const c = this.company();
    const primary = !!c?.primary || v.primary;
    const local = v.market === 'Local';
    return this.settingsApi.saveCompany(c?.id ?? null, {
      name: v.name.trim(), legalName: v.legalName, taxNo: v.taxNo, poc: v.poc, phone: v.phone, email: v.email, address: v.address,
      market: v.market, region: local ? '' : v.region, country: local ? 'Pakistan' : v.country ?? '', state: v.state ?? '', city: v.city ?? '',
      fiscalMonth: Number(v.fiscalMonth), currency: v.currency,
      approvalThreshold: v.approvalThreshold === null || (v.approvalThreshold as unknown) === '' ? null : Number(v.approvalThreshold),
      signatoryA: v.signatoryA.trim(), signatoryB: v.signatoryB.trim(),
      capitalTarget: v.capitalTarget === null || (v.capitalTarget as unknown) === '' ? null : Number(v.capitalTarget),
      primary, active: primary || v.active === 'true',
    });
  }

  protected successMessage() {
    return this.company() ? 'Company updated.' : 'Company added.';
  }
}
