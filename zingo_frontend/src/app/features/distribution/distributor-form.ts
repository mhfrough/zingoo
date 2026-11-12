import { AttachmentMeta } from '../../core/attachments.api';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { PlacesService } from '../../core/places.service';
import { Btn, Field, Offcanvas, MoneyInput, FilesInput, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor } from '../ops/models';

/** Add or edit a distributor: who they are, the area they cover (province, main city, other cities) and the trading terms we agreed. */
@Component({
  selector: 'app-distributor-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilesInput, MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn, Select],
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

    .areas {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin-block-start: var(--space-2);
    }

    .area {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-pill, 999px);
      background: var(--surface-2, transparent);
      font-size: var(--text-sm);
      color: var(--text-1);
      cursor: pointer;

      &:hover,
      &:focus-visible {
        border-color: var(--danger, currentColor);
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="distributor() ? 'Edit distributor' : 'Add distributor'"
               subtitle="Company details and trading terms." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Distributor / company" [required]="true" [error]="invalid('name') ? 'Enter the company name' : null">
          <input type="text" formControlName="name" />
        </app-field>
        <app-field label="Province">
          <app-select formControlName="province" [options]="places.provinces()" placeholder="Choose a province" />
        </app-field>
        <app-field label="Main city" [required]="true" [error]="invalid('region') ? 'Choose the main city' : null">
          <app-select formControlName="region" [options]="cityOptions()" placeholder="Choose a city" />
        </app-field>
        <app-field label="Other areas covered" [wide]="true" hint="Pick each city the distributor also serves. Click a city to remove it">
          <app-select [formControl]="areaPick" [options]="areaOptions()" placeholder="Add a city" />
          @if (areas().length) {
            <div class="areas">
              @for (a of areas(); track a) {
                <button type="button" class="area" (click)="removeArea(a)" [attr.aria-label]="'Remove ' + a">{{ a }} ×</button>
              }
            </div>
          }
        </app-field>
        <app-field label="Contact or phone" [wide]="true"><input type="text" formControlName="contact" /></app-field>
        <app-field label="Address" [wide]="true"><input type="text" formControlName="address" /></app-field>
        <app-field label="Tax number"><input type="text" formControlName="taxNo" /></app-field>
        <app-field label="Payment terms" hint="Days after dispatch that payment is due">
          <select formControlName="paymentDays">
            @for (d of paymentCycles(); track d) {
              <option [ngValue]="d">{{ d }} days</option>
            }
          </select>
        </app-field>
        <app-field label="Credit limit" hint="0 means no limit. Over the limit, dispatch is held for Finance.">
          <app-money-input formControlName="creditLimit" />
        </app-field>
        <app-field label="Advance guide (%)" hint="Share of an order the distributor is asked to pay up front">
          <input type="number" formControlName="advancePct" min="0" max="100" step="1" />
        </app-field>
        <app-field label="Sell-out days" hint="Days to sell one container. A product can set its own" [required]="true"
                   [error]="invalid('selloutDays') ? '1 to 365 days' : null">
          <input type="number" formControlName="selloutDays" min="1" max="365" step="1" />
        </app-field>
        <h4 class="form-section">Contract</h4>
        <app-field label="Point of contact" hint="Who to speak to: name, phone or email"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Contract" hint="Contract number or title"><input type="text" formControlName="contract" maxlength="150" /></app-field>
        <app-field label="Terms" [wide]="true"><textarea formControlName="terms" maxlength="5000" placeholder="What was agreed: rates, payment, delivery, exclusivity"></textarea></app-field>
        <app-field label="Uploads" [wide]="true" hint="Signed contract, licences, pictures. Several files at once"><app-files-input formControlName="files" label="Upload files" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ distributor() ? 'Save distributor' : 'Add distributor' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DistributorForm extends FormModal {
  readonly distributor = input<Distributor | null>(null);
  /** allowed payment terms, from Settings */
  readonly paymentCycles = input<number[]>([15, 30, 45, 60]);
  /** sell-out days for a new distributor (Settings) */
  readonly defaultSelloutDays = input(30);
  readonly formId = 'form-distributor';

  protected places = inject(PlacesService);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    province: this.fb.control<string | null>(null),
    region: ['', Validators.required],
    areas: [[] as string[]],
    contact: [''],
    address: [''],
    taxNo: [''],
    paymentDays: [30],
    creditLimit: [0, Validators.min(0)],
    advancePct: [0, [Validators.min(0), Validators.max(100)]],
    selloutDays: [30, [Validators.required, Validators.min(1), Validators.max(365)]],
    poc: [''],
    contract: [''],
    terms: [''],
    files: [[] as AttachmentMeta[]],
  });

  /** the city picker for "other areas"; a pick is added to the list and the picker cleared */
  protected areaPick = new FormControl<string | null>(null);

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected areas = computed(() => this.value().areas ?? []);

  /** cities of the chosen province, plus the saved city if it is not in the list */
  protected cityOptions = computed<SelectOption<string>[]>(() => {
    const v = this.value();
    const list = this.places.cities(v.province);
    return v.region && !list.some((c) => c.value === v.region) ? [{ value: v.region, label: v.region }, ...list] : list;
  });
  /** any city not already covered */
  protected areaOptions = computed<SelectOption<string>[]>(() => {
    const v = this.value();
    const taken = new Set([v.region, ...(v.areas ?? [])]);
    return this.places.cities(v.province).filter((c) => !taken.has(c.value));
  });

  constructor() {
    super();
    this.places.load();
    // a city picked before the province fills the province in
    this.form.controls.region.valueChanges.pipe(takeUntilDestroyed()).subscribe((city) => {
      if (city && !this.form.controls.province.value) {
        const p = this.places.provinceOf(city);
        if (p) this.form.controls.province.setValue(p);
      }
    });
    this.areaPick.valueChanges.pipe(takeUntilDestroyed()).subscribe((city) => {
      if (!city) return;
      const list = this.form.controls.areas.value;
      if (!list.includes(city)) {
        this.form.controls.areas.setValue([...list, city]);
        this.form.markAsDirty();
      }
      this.areaPick.setValue(null, { emitEvent: false });
    });
  }

  protected removeArea(city: string) {
    this.form.controls.areas.setValue(this.form.controls.areas.value.filter((a) => a !== city));
    this.form.markAsDirty();
  }

  protected reset() {
    const d = this.distributor();
    this.areaPick.setValue(null, { emitEvent: false });
    this.form.reset(d
      ? { name: d.name, province: d.province ?? null, region: d.region, areas: d.areas ?? [], contact: d.contact ?? '', address: d.address ?? '', taxNo: d.taxNo ?? '', paymentDays: d.paymentDays, creditLimit: Number(d.creditLimit), advancePct: Number(d.advancePct), selloutDays: d.selloutDays ?? 30,
          poc: d.poc ?? '', contract: d.contract ?? '', terms: d.terms ?? '', files: d.files ?? [] }
      : { name: '', province: null, region: '', areas: [], contact: '', address: '', taxNo: '', paymentDays: 30, creditLimit: 0, advancePct: 0, selloutDays: this.defaultSelloutDays(), poc: '', contract: '', terms: '', files: [] });
  }

  protected request() {
    return this.api.saveDistributor(this.distributor()?.id ?? null, this.form.getRawValue());
  }

  protected successMessage() {
    return this.distributor() ? 'Distributor updated.' : 'Distributor added.';
  }
}
