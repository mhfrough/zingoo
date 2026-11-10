import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { CategoryRow } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { SettingsApi } from './settings.api';

/**
 * Add an income or expense category, or rename any category (cost centers too).
 * Renaming moves the documents that used the old name, and its ledger account, along with it.
 */
@Component({
  selector: 'app-category-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="category() ? 'Rename ' + category()!.name : 'Add ' + kindWord() + ' category'"
               [subtitle]="category() ? 'Documents and the ledger account follow the new name.' : 'It becomes available on new invoices and bills.'" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Category name" [wide]="true" [required]="true" [error]="invalid('name') ? 'Enter a name' : null">
          <input type="text" formControlName="name" maxlength="80" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ category() ? 'Rename' : 'Add category' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CategoryForm extends FormModal {
  /** the category being renamed (empty = add a new one) */
  readonly category = input<CategoryRow | null>(null);
  /** the kind to add when there is no category */
  readonly kind = input<'INCOME' | 'EXPENSE'>('EXPENSE');
  readonly formId = 'form-category';
  protected kindWord = computed(() => (this.kind() === 'INCOME' ? 'income' : 'expense'));
  private settingsApi = inject(SettingsApi);

  readonly form = this.fb.nonNullable.group({ name: ['', Validators.required] });

  protected reset() {
    this.form.reset({ name: this.category()?.name ?? '' });
  }

  protected request() {
    const name = this.form.getRawValue().name.trim();
    const c = this.category();
    return c ? this.settingsApi.renameCategory(c.id, name) : this.settingsApi.addCategory({ kind: this.kind(), name });
  }

  protected successMessage() {
    return this.category() ? 'Category renamed.' : 'Category added.';
  }
}
