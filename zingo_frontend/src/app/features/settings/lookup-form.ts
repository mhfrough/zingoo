import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Lookup } from '../../core/settings.store';
import { Btn, Field, Modal } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { SettingsApi } from './settings.api';

/** the cost lines an Incoterm can put on the seller (bank charges and other costs always are) */
export const SELLER_LINES: [string, string][] = [
  ['origin', 'Origin costs (inland, handling, documents)'],
  ['ocean', 'Ocean freight'],
  ['insurance', 'Marine insurance'],
  ['destination', 'Destination charges'],
  ['duty', 'Import duty'],
];

/**
 * Add or change an entry of a pick-list: a payment method or an Incoterm.
 * The name is stored on documents, so it cannot change once the entry exists; the text, the seller's cost lines
 * (Incoterms) and the on/off switch can. A switched-off entry is no longer offered in new forms.
 */
@Component({
  selector: 'app-lookup-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="md"
               [title]="(entry() ? 'Edit ' : 'Add ') + (list() === 'INCOTERM' ? 'Incoterm' : 'payment method')"
               [subtitle]="list() === 'INCOTERM' ? 'Which cost lines the seller carries drives the export costing.' : 'Offered in every payment form.'">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field [label]="list() === 'INCOTERM' ? 'Code' : 'Name'" [required]="true" [error]="invalid('code') ? 'Enter a name' : null"
                   [hint]="entry() ? 'Stored on documents, so it cannot change' : ''">
          <input type="text" formControlName="code" maxlength="40" />
        </app-field>
        <app-field label="Status">
          <select formControlName="active">
            <option value="true">Active</option>
            <option value="false">Switched off</option>
          </select>
        </app-field>
        @if (list() === 'INCOTERM') {
          <app-field label="Meaning" [wide]="true"><input type="text" formControlName="description" maxlength="250" /></app-field>
          <div class="field field--wide" role="group" aria-label="Seller carries">
            <span class="field__label">The seller carries</span>
            <div class="seller-lines">
              @for (l of lines; track l[0]) {
                <label class="check"><input type="checkbox" [formControlName]="l[0]" /> {{ l[1] }}</label>
              }
            </div>
          </div>
        }
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ entry() ? 'Save changes' : 'Add entry' }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .seller-lines {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
      gap: var(--space-2) var(--space-4);
    }
  `,
})
export class LookupForm extends FormModal {
  readonly list = input<'PAY_METHOD' | 'INCOTERM'>('PAY_METHOD');
  readonly entry = input<Lookup | null>(null);
  readonly formId = 'form-lookup';
  protected lines = SELLER_LINES;
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    code: ['', Validators.required],
    description: [''],
    active: ['true'],
    origin: [false],
    ocean: [false],
    insurance: [false],
    destination: [false],
    duty: [false],
  });

  protected reset() {
    const e = this.entry();
    this.form.reset({
      code: e?.code ?? '', description: e?.description ?? '', active: String(e?.active ?? true),
      origin: !!e?.flags?.['origin'], ocean: !!e?.flags?.['ocean'], insurance: !!e?.flags?.['insurance'],
      destination: !!e?.flags?.['destination'], duty: !!e?.flags?.['duty'],
    });
    if (e) this.form.controls.code.disable({ emitEvent: false });
    else this.form.controls.code.enable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const flags = { origin: v.origin, ocean: v.ocean, insurance: v.insurance, destination: v.destination, duty: v.duty };
    const e = this.entry();
    return e
      ? this.settingsApi.updateLookup(e.id, { description: v.description, flags, active: v.active === 'true' })
      : this.settingsApi.addLookup({ list: this.list(), code: v.code, description: v.description, flags });
  }

  protected successMessage() {
    return this.entry() ? 'Entry saved.' : 'Entry added.';
  }
}
