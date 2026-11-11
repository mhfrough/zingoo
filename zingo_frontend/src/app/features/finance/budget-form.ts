import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { Btn, Field, Offcanvas, MoneyInput } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FinanceApi } from './finance.api';
import { Budget } from './models';

/**
 * Edit the budget (allocation) of one cost center, or of all of them at once.
 * Pass `only` to edit a single cost center; leave it empty to edit every one.
 */
@Component({
  selector: 'app-budget-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyInput, ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="only() ? 'Edit ' + only()!.name + ' budget' : 'Edit all investment allocations'"
               subtitle="PKR allocated to each cost center." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
        @for (c of fields(); track c.id) {
          <app-field [label]="c.name + ' allocation'">
            <app-money-input [formControlName]="c.id" />
          </app-field>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save allocation</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class BudgetForm extends FormModal {
  /** every cost center with its current budget */
  readonly centers = input<Budget[]>([]);
  /** edit just this one (otherwise all) */
  readonly only = input<Budget | null>(null);
  readonly formId = 'form-budget';
  private fin = inject(FinanceApi);

  /** the cost centers shown in the form */
  protected rows = computed(() => (this.only() ? [this.only()!] : this.centers()));

  /** one control per cost center, added in reset() */
  readonly form = this.fb.nonNullable.group({});

  /** the fields drawn in the template: only set once their controls exist, so a field never looks for a missing control */
  protected fields = signal<Budget[]>([]);

  protected reset() {
    this.fields.set([]);
    for (const name of Object.keys(this.form.controls)) this.form.removeControl(name);
    for (const c of this.rows()) {
      this.form.addControl(c.id, new FormControl(Number(c.budget), { nonNullable: true, validators: [Validators.min(0)] }));
    }
    this.form.markAsPristine();
    this.fields.set(this.rows());
  }

  protected request() {
    const values = this.form.getRawValue() as Record<string, number>;
    const changed = this.rows().filter((c) => Number(values[c.id]) !== Number(c.budget));
    return forkJoin(changed.length ? changed.map((c) => this.fin.setBudget(c.id, Number(values[c.id]))) : [this.fin.categories()]);
  }

  protected successMessage() {
    return 'Investment allocations updated.';
  }
}
