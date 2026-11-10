import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { UserRow, UsersApi } from './users.api';

/** Set a new password for a login (for example after they forgot theirs). Tell them the new password yourself. */
@Component({
  selector: 'app-password-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Reset password" [subtitle]="user() ? user()!.name + ' · ' + user()!.email : ''" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="New password" hint="At least 8 characters" [wide]="true" [required]="true" [error]="invalid('password') ? 'Use at least 8 characters' : null">
          <input type="password" formControlName="password" autocomplete="new-password" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="key" [loading]="busy()">Set password</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class PasswordForm extends FormModal {
  readonly user = input<UserRow | null>(null);
  readonly formId = 'form-password';
  private usersApi = inject(UsersApi);

  readonly form = this.fb.nonNullable.group({ password: ['', [Validators.required, Validators.minLength(8)]] });

  protected reset() {
    this.form.reset({ password: '' });
  }

  protected request() {
    return this.usersApi.resetPassword(this.user()!.id, this.form.getRawValue().password);
  }

  protected successMessage() {
    return 'Password changed. Tell them the new one.';
  }
}
