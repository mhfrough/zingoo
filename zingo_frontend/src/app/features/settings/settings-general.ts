import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Btn, Field, ToastService, MoneyInput } from '../../ui';
import { SettingsApi } from './settings.api';
import { SettingsCompanies } from './settings-companies';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** locales the number format can follow (the browser formats amounts with it) */
const LOCALES = [
  ['en-PK', 'Pakistan (1,234,567.89)'], ['en-IN', 'India (12,34,567.89)'], ['en-US', 'United States (1,234,567.89)'],
  ['en-GB', 'United Kingdom (1,234,567.89)'], ['de-DE', 'Germany (1.234.567,89)'],
] as const;
const PREFIXES = [
  ['sales', 'Sales orders'], ['batch', 'Production batches'], ['finance', 'Finance entries'], ['accounting', 'Income and expense documents'], ['export', 'Export containers'],
] as const;

/** "15, 30, 45" -> [15, 30, 45] */
const numbers = (text: string) => text.split(/[,\s]+/).filter(Boolean).map(Number);

/**
 * Company and assumptions: every number and default the app works from.
 * One form, saved together; the Save button stays off until something changed. Changes apply to every page at once.
 */
@Component({
  selector: 'app-settings-general',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Field, Btn, SettingsCompanies],
  template: `
    <div class="stack">
    <app-settings-companies />
    <form [formGroup]="form" (ngSubmit)="save()" novalidate class="stack">
      <div class="card">
        <div class="card__head"><div><h2>Company</h2><p>How the business is named and how numbers are written</p></div></div>
        <div class="card__body form-grid">
          <app-field label="Company name" [required]="true" [error]="bad('companyName') ? 'Enter the company name' : null"><input type="text" formControlName="companyName" /></app-field>
          <app-field label="Financial year starts in">
            <select formControlName="fiscalMonth">
              @for (m of months; track m; let i = $index) {
                <option [value]="i + 1">{{ m }}</option>
              }
            </select>
          </app-field>
          <app-field label="Number format" hint="Changes how every amount is written">
            <select formControlName="numberFormat">
              @for (l of locales; track l[0]) {
                <option [value]="l[0]">{{ l[1] }}</option>
              }
            </select>
          </app-field>
          <app-field label="Base currency" hint="Every amount is kept in this currency"><input type="text" [value]="settings()?.baseCurrency ?? 'PKR'" disabled /></app-field>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2>Money and approvals</h2><p>Who signs what, and the planning figures</p></div></div>
        <div class="card__body form-grid">
          <app-field label="Two signatures from" hint="Spending at or above this needs both signatories" [required]="true">
            <app-money-input formControlName="approvalThreshold" />
          </app-field>
          <app-field label="Signatory A"><input type="text" formControlName="signatoryA" /></app-field>
          <app-field label="Signatory B"><input type="text" formControlName="signatoryB" /></app-field>
          <app-field label="Capital target" hint="What the business plans to raise">
            <app-money-input formControlName="capitalTarget" />
          </app-field>
          <app-field label="Overhead per pack" hint="Planning share charged to every pack">
            <app-money-input formControlName="profitAllocationPerPack" />
          </app-field>
          <app-field label="Sales tax rate" hint="Planning only, not posted"><input type="number" formControlName="salesTaxRate" min="0" step="0.01" /></app-field>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2>Operations</h2><p>Defaults for stock, containers and payment terms</p></div></div>
        <div class="card__body form-grid">
          <app-field label="Packets per bundle" hint="Default for a new SKU" [required]="true"><input type="number" formControlName="packsPerCarton" min="1" step="1" /></app-field>
          <app-field label="Bundles per container" hint="Default for a new SKU. A container is one batch for a distributor" [required]="true"><input type="number" formControlName="bundlesPerContainer" min="1" step="1" /></app-field>
          <app-field label="Sell-out days" hint="Default for a new distributor" [required]="true"><input type="number" formControlName="defaultSelloutDays" min="1" max="365" step="1" /></app-field>
          <app-field label="Low-stock alert below" hint="Cartons per SKU"><input type="number" formControlName="lowStockCartons" min="0" step="1" /></app-field>
          <app-field label="Default container">
            <select formControlName="containerSize">
              @for (c of store.containers(); track c.code) {
                <option [value]="c.code">{{ c.code }}</option>
              }
            </select>
          </app-field>
          <app-field label="Default Incoterm">
            <select formControlName="defaultIncoterm">
              @for (t of store.incoterms(); track t.id) {
                <option [value]="t.code">{{ t.code }}</option>
              }
            </select>
          </app-field>
          <app-field label="Payment terms offered" hint="Days, separated by commas" [error]="bad('paymentCycles') ? 'Enter whole days, for example 15, 30, 45' : null">
            <input type="text" formControlName="paymentCycles" />
          </app-field>
          <app-field label="Default payment terms" hint="Must be one of the days above"><input type="number" formControlName="defaultPaymentCycle" min="1" step="1" /></app-field>
          <app-field label="Aging buckets" hint="Upper day limits, for example 30, 60, 90" [error]="bad('agingBuckets') ? 'Use increasing day counts' : null">
            <input type="text" formControlName="agingBuckets" />
          </app-field>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2>Document numbers</h2><p>The letters in front of each reference, for example SO-201. New documents use them straight away.</p></div></div>
        <div class="card__body form-grid" formGroupName="docPrefixes">
          @for (p of prefixes; track p[0]) {
            <app-field [label]="p[1]" [error]="prefixBad(p[0]) ? '1 to 6 letters' : null"><input type="text" [formControlName]="p[0]" maxlength="6" /></app-field>
          }
        </div>
      </div>

      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      @if (canEdit()) {
      <div class="cluster">
        <button appBtn variant="primary" type="submit" icon="check" [loading]="busy()" [disabled]="form.pristine">Save settings</button>
        <button appBtn type="button" [disabled]="form.pristine" (click)="load()">Discard changes</button>
        @if (form.pristine) { <span class="muted">Nothing changed yet.</span> }
      </div>
      } @else {
        <div class="notice"><span>View only. Only an Admin can change the settings.</span></div>
      }
    </form>
    </div>
  `,
})
export class SettingsGeneral {
  protected store = inject(SettingsStore);
  protected auth = inject(AuthService);
  protected canEdit = computed(() => this.auth.can('admin'));
  private api = inject(SettingsApi);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);

  protected months = MONTHS;
  protected locales = LOCALES;
  protected prefixes = PREFIXES;
  protected settings = this.store.settings;
  protected busy = signal(false);
  protected error = signal('');

  protected form = this.fb.nonNullable.group({
    companyName: ['', Validators.required],
    fiscalMonth: ['7'],
    numberFormat: ['en-PK'],
    approvalThreshold: [0, Validators.min(0)],
    signatoryA: [''],
    signatoryB: [''],
    capitalTarget: [0, Validators.min(0)],
    profitAllocationPerPack: [0, Validators.min(0)],
    salesTaxRate: [0, Validators.min(0)],
    packsPerCarton: [1, [Validators.required, Validators.min(1)]],
    bundlesPerContainer: [10, [Validators.required, Validators.min(1)]],
    defaultSelloutDays: [30, [Validators.required, Validators.min(1), Validators.max(365)]],
    lowStockCartons: [0, Validators.min(0)],
    containerSize: [''],
    defaultIncoterm: [''],
    paymentCycles: ['', Validators.pattern(/^\s*\d+(\s*[, ]\s*\d+)*\s*$/)],
    defaultPaymentCycle: [30, Validators.min(1)],
    agingBuckets: ['', Validators.pattern(/^\s*\d+(\s*[, ]\s*\d+)*\s*$/)],
    docPrefixes: this.fb.nonNullable.group({
      sales: ['', Validators.pattern(/^[A-Za-z]{1,6}$/)], batch: ['', Validators.pattern(/^[A-Za-z]{1,6}$/)],
      finance: ['', Validators.pattern(/^[A-Za-z]{1,6}$/)], accounting: ['', Validators.pattern(/^[A-Za-z]{1,6}$/)],
      export: ['', Validators.pattern(/^[A-Za-z]{1,6}$/)],
    }),
  });


  constructor() {
    // fill the form once the settings arrive (and again after a save reloads them, unless the user is mid-edit)
    effect(() => {
      const s = this.settings();
      if (!s) return;
      untracked(() => {
        if (this.form.pristine) this.fill();
      });
    });
  }

  private fill() {
    const s = this.settings();
    if (!s) return;
    this.form.reset({
      companyName: s.companyName, fiscalMonth: String(s.fiscalMonth), numberFormat: s.numberFormat,
      approvalThreshold: Number(s.approvalThreshold), signatoryA: s.signatoryA, signatoryB: s.signatoryB,
      capitalTarget: Number(s.capitalTarget), profitAllocationPerPack: Number(s.profitAllocationPerPack), salesTaxRate: Number(s.salesTaxRate),
      packsPerCarton: s.packsPerCarton, bundlesPerContainer: s.bundlesPerContainer ?? 10, defaultSelloutDays: s.defaultSelloutDays ?? 30, lowStockCartons: s.lowStockCartons, containerSize: s.containerSize, defaultIncoterm: s.defaultIncoterm,
      paymentCycles: s.paymentCycles.join(', '), defaultPaymentCycle: s.defaultPaymentCycle, agingBuckets: (s.agingBuckets ?? [30, 60, 90]).join(', '),
      docPrefixes: { sales: s.docPrefixes['sales'] ?? '', batch: s.docPrefixes['batch'] ?? '', finance: s.docPrefixes['finance'] ?? '', accounting: s.docPrefixes['accounting'] ?? '', export: s.docPrefixes['export'] ?? '' },
    });
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
  }

  /** put the saved values back (Discard changes) */
  protected load() {
    this.form.markAsPristine();
    this.fill();
  }

  protected bad(name: string) {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected prefixBad(name: string) {
    const c = this.form.get(['docPrefixes', name]);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected save() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    const v = this.form.getRawValue();
    const cycles = numbers(v.paymentCycles);
    if (!cycles.includes(Number(v.defaultPaymentCycle))) {
      this.error.set('The default payment terms must be one of the days offered.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.api.updateSettings({
      companyName: v.companyName, fiscalMonth: Number(v.fiscalMonth), numberFormat: v.numberFormat,
      approvalThreshold: Number(v.approvalThreshold), signatoryA: v.signatoryA, signatoryB: v.signatoryB,
      capitalTarget: Number(v.capitalTarget), profitAllocationPerPack: Number(v.profitAllocationPerPack), salesTaxRate: Number(v.salesTaxRate),
      packsPerCarton: Number(v.packsPerCarton), bundlesPerContainer: Number(v.bundlesPerContainer), defaultSelloutDays: Number(v.defaultSelloutDays), lowStockCartons: Number(v.lowStockCartons), containerSize: v.containerSize, defaultIncoterm: v.defaultIncoterm,
      paymentCycles: cycles, defaultPaymentCycle: Number(v.defaultPaymentCycle), agingBuckets: numbers(v.agingBuckets), docPrefixes: v.docPrefixes,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.form.markAsPristine();
        this.store.reload();
        this.toast.success('Settings saved. Every page now uses them.');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
      },
    });
  }
}
