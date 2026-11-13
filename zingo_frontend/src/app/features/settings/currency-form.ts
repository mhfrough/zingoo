import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { SettingsApi } from './settings.api';

/** Add a currency or change its name, symbol or exchange rate (PKR per 1 unit). PKR is the base currency and stays at 1. */
@Component({
  selector: 'app-currency-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  styles: `
    .history {
      grid-column: 1 / -1;
      font-size: var(--text-sm);

      & ul {
        margin: var(--space-1) 0 0;
        padding-inline-start: var(--space-5);
        color: var(--text-2);
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="currency() ? 'Edit ' + currency()!.code : 'Add currency'"
               subtitle="The rate is PKR per 1 unit. Documents freeze the rate they were made at." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Code" hint="Three letters, for example SAR" [required]="true" [error]="invalid('code') ? 'Use 3 letters' : null">
          <input type="text" formControlName="code" maxlength="3" />
        </app-field>
        <app-field label="Symbol" [required]="true" [error]="invalid('symbol') ? 'Enter a symbol' : null">
          <input type="text" formControlName="symbol" maxlength="8" />
        </app-field>
        <app-field label="Name" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter a name' : null">
          <input type="text" formControlName="name" maxlength="60" />
        </app-field>
        <app-field label="Exchange rate" hint="PKR per 1 unit" [wide]="true" [required]="true" [error]="invalid('rate') ? 'Enter a rate above zero' : null">
          <input type="number" formControlName="rate" min="0" step="any" />
        </app-field>
        @if (currency() && currency()!.code !== 'PKR') {
          <app-field label="Rate source" hint="Kept with the change: State Bank, a commercial bank, manual override" [wide]="true">
            <input type="text" formControlName="source" maxlength="60" placeholder="Manual" />
          </app-field>
          @if (history().length) {
            <div class="history">
              <strong>Earlier rates</strong>
              <ul>
                @for (h of history(); track h.id) {
                  <li>{{ h.effectiveOn }} · {{ h.rate }} · {{ h.source }} · {{ h.by }}</li>
                }
              </ul>
            </div>
          }
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ currency() ? 'Save changes' : 'Add currency' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CurrencyForm extends FormModal {
  readonly currency = input<Currency | null>(null);
  readonly formId = 'form-currency';
  /** the last rate changes of the currency being edited */
  protected history = signal<{ id: string; rate: number; source: string; effectiveOn: string; by: string }[]>([]);
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    symbol: ['', Validators.required],
    name: ['', Validators.required],
    rate: [1, [Validators.required, Validators.min(0.000001)]],
    source: [''],
  });

  protected reset() {
    const c = this.currency();
    this.form.reset({ code: c?.code ?? '', symbol: c?.symbol ?? '', name: c?.name ?? '', rate: Number(c?.rate ?? 1), source: '' });
    this.history.set([]);
    if (c && c.code !== 'PKR') this.settingsApi.currencyRates(c.code).subscribe({ next: (h) => this.history.set(h.slice(0, 8)), error: () => this.history.set([]) });
    if (c) this.form.controls.code.disable({ emitEvent: false });
    else this.form.controls.code.enable({ emitEvent: false });
    // PKR is the base currency: its rate is fixed
    if (c?.code === 'PKR') this.form.controls.rate.disable({ emitEvent: false });
    else this.form.controls.rate.enable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const c = this.currency();
    return c
      ? this.settingsApi.updateCurrency(c.code, { name: v.name, symbol: v.symbol, rate: Number(v.rate), source: v.source.trim() || undefined })
      : this.settingsApi.addCurrency({ code: v.code, name: v.name, symbol: v.symbol, rate: Number(v.rate) });
  }

  protected successMessage() {
    return this.currency() ? 'Currency updated.' : 'Currency added.';
  }
}
