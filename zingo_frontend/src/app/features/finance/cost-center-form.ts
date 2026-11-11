import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsStore } from '../../core/settings.store';
import { Btn, Field, MoneyInput, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';
import { Budget } from './models';

/**
 * Add an investment stream (a cost center that spending and investments are booked against) with its budget and
 * its type, or change the type of an existing one. The types come from Settings (Fixed Asset, Movable Asset,
 * Operation Cost ...); a fixed asset type also carries a depreciation rate.
 */
@Component({
  selector: 'app-cost-center-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="center() ? 'Type of ' + center()!.name : 'New investment stream'"
                   [subtitle]="center() ? 'The type comes from Settings & Data.' : 'It appears in the budgets and in every stream list.'" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        @if (!center()) {
          <app-field label="Stream name" [required]="true" [error]="invalid('name') ? 'Enter a name' : null" [wide]="true">
            <input type="text" formControlName="name" />
          </app-field>
          <app-field label="Budget allocation">
            <app-money-input formControlName="budget" />
          </app-field>
        }
        <app-field label="Stream type" hint="Set in Settings & Data">
          <select formControlName="streamType">
            <option value="">Not set</option>
            @for (t of types(); track t.code) {
              <option [value]="t.code">{{ t.code }}</option>
            }
          </select>
        </app-field>
        @if (depreciable()) {
          <app-field label="Depreciation" hint="Percent of its value lost each year">
            <app-money-input formControlName="depreciationRate" currency="" [decimals]="2" [max]="100" />
          </app-field>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" [icon]="center() ? 'check' : 'plus'" [loading]="busy()">
          {{ center() ? 'Save type' : 'Add stream' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CostCenterForm extends FormModal {
  /** the stream whose type is being changed (empty = add a new stream) */
  readonly center = input<Budget | null>(null);
  readonly formId = 'form-cost-center';
  private fin = inject(FinanceApi);
  private store = inject(SettingsStore);

  protected types = this.store.streamTypes;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    budget: [0, Validators.min(0)],
    streamType: [''],
    depreciationRate: [0, [Validators.min(0), Validators.max(100)]],
  });

  private type = toSignal(this.form.controls.streamType.valueChanges, { initialValue: '' });
  /** a type that loses value over time carries a depreciation rate */
  protected depreciable = computed(() => !!this.types().find((t) => t.code === this.type())?.flags['depreciable']);

  protected reset() {
    const c = this.center();
    this.form.reset({ name: '', budget: 0, streamType: c?.streamType ?? '', depreciationRate: Number(c?.depreciationRate ?? 0) });
    // the name is only needed when adding a stream
    this.form.controls.name.setValidators(c ? [] : [Validators.required]);
    this.form.controls.name.updateValueAndValidity({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const rate = this.depreciable() ? Number(v.depreciationRate) || 0 : 0;
    const c = this.center();
    return c ? this.fin.setStream(c.id, v.streamType, rate) : this.fin.createCostCenter(v.name.trim(), Number(v.budget), v.streamType, rate);
  }

  protected successMessage() {
    return this.center() ? 'Stream type saved.' : 'New stream added to the budgets.';
  }
}
