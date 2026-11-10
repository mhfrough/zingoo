import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { fmtAmount2, fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { ExportsApi } from './exports.api';
import { ExportRow } from './models';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Money from the foreign buyer, in the invoice currency, at the bank rate of the day.
 * The difference to the invoice rate is booked as a realised FX gain or loss.
 */
@Component({
  selector: 'app-export-collect-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Collect from the buyer"
               [subtitle]="shipment() ? shipment()!.refNo + ' · ' + shipment()!.buyer : ''" size="lg" [dirty]="form.dirty">
      @if (shipment(); as s) {
        <div class="notice">
          <span>Outstanding <strong>{{ s.currency }} {{ amount(s.due) }}</strong> · invoice rate PKR {{ amount(s.fxRate, 4) }} per {{ s.currency }}</span>
        </div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Collection date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field [label]="'Amount received (' + (shipment()?.currency ?? '') + ')'" [required]="true"
                   [error]="invalid('foreignAmount') ? 'Enter an amount above zero' : null">
          <input type="number" formControlName="foreignAmount" min="0.01" step="0.01" />
        </app-field>
        <app-field label="Bank exchange rate" hint="PKR per 1 unit, on the day it arrived" [required]="true"
                   [error]="invalid('fxRate') ? 'Enter the rate' : null">
          <input type="number" formControlName="fxRate" min="0" step="any" />
        </app-field>
        <app-field label="Payment method">
          <select formControlName="method">
            @for (m of methods(); track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>
        </app-field>
        <app-field label="Bank advice / reference" [wide]="true"><input type="text" formControlName="note" /></app-field>
      </form>
      @if (preview(); as p) {
        <div class="notice" [attr.data-tone]="p.diff < 0 ? 'warning' : null">
          <span>
            PKR received <strong>{{ money(p.cash) }}</strong> against {{ money(p.base) }} invoiced:
            @if (p.diff > 0) { an FX <strong>gain</strong> of {{ money(p.diff) }}. }
            @else if (p.diff < 0) { an FX <strong>loss</strong> of {{ money(-p.diff) }}. }
            @else { no exchange difference. }
          </span>
        </div>
      }
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="banknote" [loading]="busy()">Post collection</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ExportCollectForm extends FormModal {
  readonly shipment = input<ExportRow | null>(null);
  readonly formId = 'form-export-collect';
  protected methods = inject(SettingsStore).paymentMethods;
  protected money = fmtMoney;
  protected amount = fmtAmount2;
  private exportsApi = inject(ExportsApi);

  readonly form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    foreignAmount: [0, [Validators.required, Validators.min(0.01)]],
    fxRate: [1, [Validators.required, Validators.min(0.000001)]],
    method: ['Bank Transfer'],
    note: [''],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected preview = computed(() => {
    const s = this.shipment();
    const v = this.value();
    if (!s || !(Number(v.foreignAmount) > 0) || !(Number(v.fxRate) > 0)) return null;
    const base = Math.round(Number(v.foreignAmount) * Number(s.fxRate) * 100) / 100;
    const cash = Math.round(Number(v.foreignAmount) * Number(v.fxRate) * 100) / 100;
    return { base, cash, diff: Math.round((cash - base) * 100) / 100 };
  });

  protected reset() {
    const s = this.shipment();
    this.form.reset({ date: today(), foreignAmount: Number(s?.due ?? 0), fxRate: Number(s?.fxRate ?? 1), method: 'Bank Transfer', note: '' });
  }

  protected request() {
    return this.exportsApi.collect(this.shipment()!.id, this.form.getRawValue());
  }

  protected successMessage() {
    return 'Collection posted to cash and receivables, with any realised FX gain or loss.';
  }
}
