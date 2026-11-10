import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
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
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    symbol: ['', Validators.required],
    name: ['', Validators.required],
    rate: [1, [Validators.required, Validators.min(0.000001)]],
  });

  protected reset() {
    const c = this.currency();
    this.form.reset({ code: c?.code ?? '', symbol: c?.symbol ?? '', name: c?.name ?? '', rate: Number(c?.rate ?? 1) });
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
      ? this.settingsApi.updateCurrency(c.code, { name: v.name, symbol: v.symbol, rate: Number(v.rate) })
      : this.settingsApi.addCurrency({ code: v.code, name: v.name, symbol: v.symbol, rate: Number(v.rate) });
  }

  protected successMessage() {
    return this.currency() ? 'Currency updated.' : 'Currency added.';
  }
}
