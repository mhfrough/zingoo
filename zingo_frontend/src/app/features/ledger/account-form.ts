import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { LedgerApi } from './ledger.api';
import { ACCOUNT_TYPES, Account } from './models';

/**
 * Add an account to the chart, or rename one (an existing account keeps its code and type, so its postings stay valid).
 * The name is what documents post to, so it must be unique.
 */
@Component({
  selector: 'app-account-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="account() ? 'Rename account' : 'Add an account'"
               subtitle="The chart of accounts is what every posting lands in." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Account code" hint="Up to 10 characters, for example 6900" [required]="true"
                   [error]="invalid('code') ? 'Enter a code' : null">
          <input type="text" formControlName="code" maxlength="10" />
        </app-field>
        <app-field label="Type" [required]="true">
          <select formControlName="type">
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </app-field>
        <app-field label="Account name" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter a name' : null">
          <input type="text" formControlName="name" maxlength="80" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ account() ? 'Save name' : 'Add account' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AccountForm extends FormModal {
  readonly account = input<Account | null>(null);
  readonly formId = 'form-account';
  protected types = ACCOUNT_TYPES;
  private ledger = inject(LedgerApi);

  readonly form = this.fb.nonNullable.group({
    code: ['', Validators.required],
    type: ['Expense'],
    name: ['', Validators.required],
  });

  protected reset() {
    const a = this.account();
    this.form.reset({ code: a?.code ?? '', type: a?.type ?? 'Expense', name: a?.name ?? '' });
    // a posted account keeps its code and type
    if (a) { this.form.controls.code.disable({ emitEvent: false }); this.form.controls.type.disable({ emitEvent: false }); }
    else { this.form.controls.code.enable({ emitEvent: false }); this.form.controls.type.enable({ emitEvent: false }); }
  }

  protected request() {
    const a = this.account();
    return a ? this.ledger.updateAccount(a.id, { name: this.form.getRawValue().name }) : this.ledger.createAccount(this.form.getRawValue());
  }

  protected successMessage() {
    return this.account() ? 'Account renamed.' : 'Account added to the chart.';
  }
}
