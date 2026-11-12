import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Company, SettingsApi } from './settings.api';

/** Add or change a company of the group. The primary company's name is the company name everywhere. */
@Component({
  selector: 'app-company-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="company() ? 'Edit company' : 'Add company'"
                   subtitle="A company of the group. The primary one names the business on every page." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null">
          <input type="text" formControlName="name" maxlength="150" />
        </app-field>
        <app-field label="Legal name"><input type="text" formControlName="legalName" maxlength="200" /></app-field>
        <app-field label="Tax number (NTN)"><input type="text" formControlName="taxNo" maxlength="40" /></app-field>
        <app-field label="Point of contact"><input type="text" formControlName="poc" maxlength="150" /></app-field>
        <app-field label="Phone"><input type="tel" formControlName="phone" maxlength="60" /></app-field>
        <app-field label="Email"><input type="email" formControlName="email" maxlength="120" /></app-field>
        <app-field label="Address" [wide]="true"><input type="text" formControlName="address" maxlength="250" /></app-field>
        @if (!company()?.primary) {
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
})
export class CompanyForm extends FormModal {
  readonly company = input<Company | null>(null);
  readonly formId = 'form-company';
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    legalName: [''],
    taxNo: [''],
    poc: [''],
    phone: [''],
    email: [''],
    address: [''],
    primary: [false],
    active: ['true'],
  });

  protected reset() {
    const c = this.company();
    this.form.reset({
      name: c?.name ?? '', legalName: c?.legalName ?? '', taxNo: c?.taxNo ?? '', poc: c?.poc ?? '', phone: c?.phone ?? '',
      email: c?.email ?? '', address: c?.address ?? '', primary: !!c?.primary, active: String(c?.active ?? true),
    });
  }

  protected request() {
    const v = this.form.getRawValue();
    const c = this.company();
    const primary = !!c?.primary || v.primary;
    return this.settingsApi.saveCompany(c?.id ?? null, { ...v, name: v.name.trim(), primary, active: primary || v.active === 'true' });
  }

  protected successMessage() {
    return this.company() ? 'Company updated.' : 'Company added.';
  }
}
