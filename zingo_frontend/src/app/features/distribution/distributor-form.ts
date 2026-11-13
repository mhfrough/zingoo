import { AttachmentMeta } from '../../core/attachments.api';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { PlacesService, placeKey, splitKey } from '../../core/places.service';
import { Area, areasOf, holds } from '../../shared/areas';
import { countryOptions } from '../../shared/countries';
import { Btn, Field, FilesInput, MoneyInput, MultiSelect, Offcanvas, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor } from '../ops/models';

/** the statuses a distributor can have, and what each means for its logins */
const STATUSES: { value: Distributor['status']; hint: string }[] = [
  { value: 'Active', hint: 'Works normally' },
  { value: 'Hold', hint: 'Its logins can sign in and look, but change nothing' },
  { value: 'Temporary suspend', hint: 'Its logins cannot sign in until the date below; no new orders go to it' },
  { value: 'Permanent suspend', hint: 'Its logins cannot sign in; no new orders go to it; its areas are freed' },
];

/**
 * Add or edit a distributor: local, international or both; the areas it covers (provinces, districts and cities,
 * each a multi-select that narrows the next one, or countries), whether those areas are exclusive, the trading
 * terms (0 always means no limit) and, when editing, its status.
 * Areas held exclusively by another distributor are not offered; an exclusive distributor is not offered areas
 * another distributor already covers.
 */
@Component({
  selector: 'app-distributor-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilesInput, MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn, MultiSelect],
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
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="distributor() ? 'Edit distributor' : 'Add distributor'"
               subtitle="Company details, areas and trading terms. 0 in any number means no limit." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <div class="choice" role="radiogroup" aria-label="Where the distributor sells">
          @for (m of markets; track m.value) {
            <label><input type="radio" formControlName="market" [value]="m.value" /> <span><strong>{{ m.value }}</strong> · {{ m.hint }}</span></label>
          }
        </div>

        <app-field label="Distributor / company" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter the company name' : null">
          <input type="text" formControlName="name" />
        </app-field>

        <h4 class="form-section">Areas</h4>
        @if (local()) {
          <app-field label="Provinces" hint="Pick one or more">
            <app-multi-select formControlName="provinces" [options]="provinceOptions()" placeholder="Add a province" />
          </app-field>
          <app-field label="Districts" hint="Only districts of the chosen provinces">
            <app-multi-select formControlName="districts" [options]="districtOptions()" placeholder="Add a district" />
          </app-field>
          <app-field label="Cities" hint="Only cities of the chosen districts (or provinces)">
            <app-multi-select formControlName="cities" [options]="cityOptions()" placeholder="Add a city" />
          </app-field>
        }
        @if (international()) {
          <app-field label="Countries" [wide]="true" hint="International markets. The full international set-up comes in a later phase">
            <app-multi-select formControlName="countries" [options]="countryList()" placeholder="Add a country" />
          </app-field>
        }
        @if (noArea()) {
          <p class="notice" data-tone="warning" style="grid-column: 1 / -1">Choose at least one area the distributor covers.</p>
        }
        <app-field label="Distribution rights" [wide]="true"
                   [hint]="form.controls.exclusive.value === 'true' ? 'No other distributor can be given these areas' : 'Other distributors may share these areas'">
          <select formControlName="exclusive">
            <option value="false">Non-exclusive</option>
            <option value="true">Exclusive</option>
          </select>
        </app-field>

        <h4 class="form-section">Contact</h4>
        <app-field label="Contact or phone"><input type="text" formControlName="contact" /></app-field>
        <app-field label="Tax number"><input type="text" formControlName="taxNo" /></app-field>
        <app-field label="Address"><input type="text" formControlName="address" /></app-field>

        <h4 class="form-section">Trading terms</h4>
        <app-field label="Payment terms" hint="Days after an invoice that payment is due">
          <select formControlName="paymentChoice">
            <option value="0">No limit</option>
            @for (d of paymentCycles(); track d) {
              <option [value]="'' + d">{{ d }} days</option>
            }
            <option value="custom">Custom…</option>
          </select>
        </app-field>
        @if (form.controls.paymentChoice.value === 'custom') {
          <app-field label="Custom payment days" [required]="true" [error]="invalid('paymentCustom') ? '0 to 365 days' : null" hint="0 = no limit">
            <input type="number" formControlName="paymentCustom" min="0" max="365" step="1" />
          </app-field>
        }
        <app-field label="Credit limit" hint="0 = no limit. Over the limit, dispatch is held for Finance">
          <app-money-input formControlName="creditLimit" />
        </app-field>
        <app-field label="Advance guide (%)" hint="Share of an order paid up front. 0 = none">
          <input type="number" formControlName="advancePct" min="0" max="100" step="1" />
        </app-field>
        <app-field label="Sell-out days" hint="Days to sell one container. 0 = no limit. A product can set its own"
                   [error]="invalid('selloutDays') ? '0 to 365 days' : null">
          <input type="number" formControlName="selloutDays" min="0" max="365" step="1" />
        </app-field>

        @if (distributor()) {
          <h4 class="form-section">Status</h4>
          <app-field label="Status" [hint]="statusHint()">
            <select formControlName="status">
              @for (s of statuses; track s.value) {
                <option [value]="s.value">{{ s.value }}</option>
              }
            </select>
          </app-field>
          @if (form.controls.status.value === 'Temporary suspend') {
            <app-field label="Suspended until" hint="Lifted on this date. Empty = until changed">
              <input type="date" formControlName="statusUntil" [min]="today" />
            </app-field>
          }
          @if (form.controls.status.value !== 'Active') {
            <app-field label="Reason" [wide]="true"><input type="text" formControlName="statusNote" maxlength="500" /></app-field>
          }
        }

        <h4 class="form-section">Contract</h4>
        <app-field label="Point of contact" hint="Who to speak to: name, phone or email"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Contract" hint="Contract number or title"><input type="text" formControlName="contract" maxlength="150" /></app-field>
        <app-field label="Terms" [wide]="true"><textarea formControlName="terms" maxlength="5000" placeholder="What was agreed: rates, payment, delivery, exclusivity"></textarea></app-field>
        <app-field label="Uploads" [wide]="true" hint="Signed contract, licences, pictures. Several files at once"><app-files-input formControlName="files" label="Upload files" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()" [disabled]="noArea()">
          {{ distributor() ? 'Save distributor' : 'Add distributor' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DistributorForm extends FormModal {
  readonly distributor = input<Distributor | null>(null);
  /** every distributor, to keep exclusive areas apart */
  readonly others = input<Distributor[]>([]);
  /** allowed payment terms, from Settings */
  readonly paymentCycles = input<number[]>([15, 30, 45, 60]);
  /** sell-out days for a new distributor (Settings) */
  readonly defaultSelloutDays = input(30);
  readonly formId = 'form-distributor';

  protected places = inject(PlacesService);
  protected markets: { value: Distributor['market']; hint: string }[] = [
    { value: 'Local', hint: 'Pakistan' },
    { value: 'International', hint: 'Other countries' },
    { value: 'Both', hint: 'Pakistan and abroad' },
  ];
  protected statuses = STATUSES;
  protected today = new Date().toISOString().slice(0, 10);

  readonly form = this.fb.nonNullable.group({
    market: ['Local' as Distributor['market']],
    name: ['', Validators.required],
    provinces: [[] as string[]],
    districts: [[] as string[]],
    cities: [[] as string[]],
    countries: [[] as string[]],
    exclusive: ['false'],
    contact: [''],
    address: [''],
    taxNo: [''],
    paymentChoice: ['30'],
    paymentCustom: [30, [Validators.min(0), Validators.max(365)]],
    creditLimit: [0, Validators.min(0)],
    advancePct: [0, [Validators.min(0), Validators.max(100)]],
    selloutDays: [30, [Validators.min(0), Validators.max(365)]],
    status: ['Active' as Distributor['status']],
    statusNote: [''],
    statusUntil: [''],
    poc: [''],
    contract: [''],
    terms: [''],
    files: [[] as AttachmentMeta[]],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected local = computed(() => this.value().market !== 'International');
  protected international = computed(() => this.value().market !== 'Local');
  protected noArea = computed(() => {
    const v = this.value();
    return !(v.provinces?.length || v.districts?.length || v.cities?.length || v.countries?.length);
  });
  protected statusHint = computed(() => STATUSES.find((s) => s.value === this.value().status)?.hint ?? '');

  /** areas other distributors hold that this one may not take */
  private blocked = computed<Area[]>(() => {
    const me = this.distributor()?.id;
    const exclusive = this.value().exclusive === 'true';
    return this.others()
      .filter((d) => d.id !== me && d.status !== 'Permanent suspend' && (exclusive || d.exclusive))
      .flatMap((d) => areasOf(d));
  });
  /** an option is hidden when another distributor's area already holds it (a wider option stays, to narrow down inside it) */
  private free = (a: Area) => !this.blocked().some((b) => holds(b, a));

  protected provinceOptions = computed<SelectOption<string>[]>(() =>
    this.places.provinces().filter((o) => this.free({ level: 'P', province: o.value, district: '', name: o.value })));
  protected districtOptions = computed<SelectOption<string>[]>(() =>
    this.places.districtsIn(this.value().provinces ?? []).filter((o) => {
      const k = splitKey(o.value);
      return this.free({ level: 'D', province: k.province, district: k.name, name: k.name });
    }));
  protected cityOptions = computed<SelectOption<string>[]>(() =>
    this.places.citiesIn(this.value().provinces ?? [], this.value().districts ?? []).filter((o) => {
      const k = splitKey(o.value);
      return this.free({ level: 'C', province: k.province, district: this.places.districtOf(k.province, k.name) ?? '', name: k.name });
    }));
  protected countryList = computed<SelectOption<string>[]>(() =>
    countryOptions().filter((o) => this.free({ level: 'N', province: '', district: '', name: o.value })));

  constructor() {
    super();
    this.places.load();
    // a narrower choice follows a wider one: districts outside the chosen provinces, cities outside them, drop out
    this.form.controls.provinces.valueChanges.pipe(takeUntilDestroyed()).subscribe((ps) => {
      if (!ps.length) return;
      const keep = (key: string) => ps.includes(splitKey(key).province);
      const ds = this.form.controls.districts.value.filter(keep);
      if (ds.length !== this.form.controls.districts.value.length) this.form.controls.districts.setValue(ds);
      const cs = this.form.controls.cities.value.filter(keep);
      if (cs.length !== this.form.controls.cities.value.length) this.form.controls.cities.setValue(cs);
    });
    this.form.controls.districts.valueChanges.pipe(takeUntilDestroyed()).subscribe((ds) => {
      if (!ds.length) return;
      const cs = this.form.controls.cities.value.filter((key) => {
        const k = splitKey(key);
        const d = this.places.districtOf(k.province, k.name);
        return !!d && ds.includes(placeKey(k.province, d));
      });
      if (cs.length !== this.form.controls.cities.value.length) this.form.controls.cities.setValue(cs);
    });
  }

  protected reset() {
    const d = this.distributor();
    const cycles = this.paymentCycles();
    const days = d?.paymentDays ?? 30;
    const choice = days === 0 ? '0' : cycles.includes(days) ? String(days) : 'custom';
    this.form.reset(d
      ? {
        market: d.market ?? 'Local', name: d.name,
        provinces: d.provinces ?? [],
        districts: (d.districts ?? []).map((x) => placeKey(x.province, x.name)),
        cities: (d.cities ?? []).map((x) => placeKey(x.province, x.name)),
        countries: d.countries ?? [], exclusive: String(!!d.exclusive),
        contact: d.contact ?? '', address: d.address ?? '', taxNo: d.taxNo ?? '',
        paymentChoice: choice, paymentCustom: days, creditLimit: Number(d.creditLimit), advancePct: Number(d.advancePct),
        selloutDays: d.selloutDays ?? 30, status: d.status ?? 'Active', statusNote: d.statusNote ?? '', statusUntil: d.statusUntil ?? '',
        poc: d.poc ?? '', contract: d.contract ?? '', terms: d.terms ?? '', files: d.files ?? [],
      }
      : {
        market: 'Local', name: '', provinces: [], districts: [], cities: [], countries: [], exclusive: 'false',
        contact: '', address: '', taxNo: '', paymentChoice: cycles.includes(30) ? '30' : String(cycles[0] ?? 30), paymentCustom: 30,
        creditLimit: 0, advancePct: 0, selloutDays: this.defaultSelloutDays(), status: 'Active', statusNote: '', statusUntil: '',
        poc: '', contract: '', terms: '', files: [],
      });
  }

  protected request() {
    const v = this.form.getRawValue();
    const local = v.market !== 'International';
    const international = v.market !== 'Local';
    const paymentDays = v.paymentChoice === 'custom' ? Number(v.paymentCustom) : Number(v.paymentChoice);
    return this.api.saveDistributor(this.distributor()?.id ?? null, {
      name: v.name.trim(), market: v.market,
      provinces: local ? v.provinces : [],
      districts: local ? v.districts.map((k) => { const x = splitKey(k); return { name: x.name, province: x.province }; }) : [],
      cities: local ? v.cities.map((k) => { const x = splitKey(k); return { name: x.name, province: x.province, district: this.places.districtOf(x.province, x.name) }; }) : [],
      countries: international ? v.countries : [],
      exclusive: v.exclusive === 'true',
      contact: v.contact, address: v.address, taxNo: v.taxNo,
      paymentDays, creditLimit: Number(v.creditLimit), advancePct: Number(v.advancePct), selloutDays: Number(v.selloutDays),
      ...(this.distributor() ? {
        status: v.status, statusNote: v.status === 'Active' ? null : v.statusNote.trim() || null,
        statusUntil: v.status === 'Temporary suspend' && v.statusUntil ? v.statusUntil : null,
      } : {}),
      poc: v.poc, contract: v.contract, terms: v.terms, files: v.files,
    });
  }

  protected successMessage() {
    return this.distributor() ? 'Distributor updated.' : 'Distributor added.';
  }
}
