import { Directive, effect, inject, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Observable } from 'rxjs';
import { errorText } from '../../shared/errors';
import { ToastService } from '../../ui';
import { OpsApi } from './ops.api';

/**
 * Shared behaviour of every "form in a modal":
 *   open (two-way), saved event, busy / error state, reset when it opens, submit -> API -> toast -> close.
 * A concrete form only supplies `form`, `reset()`, `request()` and `successMessage()`.
 */
@Directive()
export abstract class FormModal {
  readonly open = model(false);
  readonly saved = output<void>();

  protected api = inject(OpsApi);
  protected toast = inject(ToastService);
  protected fb = inject(FormBuilder);

  protected busy = signal(false);
  protected error = signal('');

  abstract readonly formId: string;
  abstract readonly form: FormGroup;
  /** put the form in its starting state (empty, or filled from the record being edited) */
  protected abstract reset(): void;
  protected abstract request(): Observable<unknown>;
  protected abstract successMessage(): string;

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.error.set('');
          this.busy.set(false);
          this.reset();
        });
      }
    });
  }

  protected invalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected close() {
    this.open.set(false);
  }

  protected submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.request().subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(this.successMessage());
        this.open.set(false);
        this.saved.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
      },
    });
  }
}
