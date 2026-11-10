import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';

/**
 * Reject something and say why. The caller passes what to do with the reason (`run`), so one panel serves a rejected
 * request, a rejected claim and a rejected payment advice.
 */
@Component({
  selector: 'app-reason-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="heading()" size="lg" [dirty]="form.dirty" [subtitle]="subject()">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Reason" [wide]="true" hint="The distributor sees this" [required]="true" [error]="invalid('note') ? 'Say why' : null">
          <textarea formControlName="note"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="danger" type="submit" [attr.form]="formId" [loading]="busy()">{{ actionLabel() }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ReasonForm extends FormModal {
  readonly heading = input('Reject');
  readonly subject = input('');
  readonly actionLabel = input('Reject');
  /** what happens with the reason (a call to the API) */
  readonly run = input<(note: string) => Observable<unknown>>();
  readonly formId = 'form-reason';

  readonly form = this.fb.nonNullable.group({ note: ['', Validators.required] });

  protected reset() {
    this.form.reset({ note: '' });
  }

  protected request() {
    return this.run()!(this.form.getRawValue().note.trim());
  }

  protected successMessage() {
    return 'Done. The distributor can see the reason.';
  }
}
