import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Modal } from '../../ui';
import { ContainerType } from '../exports/models';
import { FormModal } from '../ops/form-modal';
import { SettingsApi } from './settings.api';

/** Add a container type or change how many cartons it plans for. The code stays, since quotes use it. */
@Component({
  selector: 'app-container-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Modal, Field, Btn],
  template: `
    <app-modal [(open)]="open" size="sm" [title]="container() ? 'Edit container type' : 'Add container type'"
               subtitle="Planning cartons only. Check weight and volume yourself.">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Code" hint="For example 40HC" [required]="true" [error]="invalid('code') ? 'Enter a code' : null">
          <input type="text" formControlName="code" maxlength="10" />
        </app-field>
        <app-field label="Planning cartons" [required]="true" [error]="invalid('maxCartons') ? 'Enter at least 1' : null">
          <input type="number" formControlName="maxCartons" min="1" step="1" />
        </app-field>
      </form>
      <ng-container modalFooter>
        <button appBtn type="button" (click)="close()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ container() ? 'Save changes' : 'Add container type' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ContainerForm extends FormModal {
  readonly container = input<ContainerType | null>(null);
  readonly formId = 'form-container';
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({
    code: ['', Validators.required],
    maxCartons: [0, [Validators.required, Validators.min(1)]],
  });

  protected reset() {
    const c = this.container();
    this.form.reset({ code: c?.code ?? '', maxCartons: c?.maxCartons ?? 0 });
    if (c) this.form.controls.code.disable({ emitEvent: false });
    else this.form.controls.code.enable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const c = this.container();
    return c ? this.settingsApi.updateContainer(c.code, { maxCartons: Number(v.maxCartons) }) : this.settingsApi.addContainer({ code: v.code, maxCartons: Number(v.maxCartons) });
  }

  protected successMessage() {
    return this.container() ? 'Container type updated.' : 'Container type added.';
  }
}
