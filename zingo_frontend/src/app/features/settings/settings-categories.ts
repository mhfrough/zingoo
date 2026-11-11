import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { fmtMoney } from '../../shared/format';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { BudgetForm } from '../finance/budget-form';
import { CostCenterForm } from '../finance/cost-center-form';
import { FinanceApi } from '../finance/finance.api';
import { Budget, CategoryRow } from '../finance/models';
import { CategoryForm } from './category-form';
import { SettingsApi } from './settings.api';

/**
 * Cost centers (with budgets) and the income and expense categories. A category that documents use can be renamed
 * (they follow) but not deleted; an unused one can be deleted.
 */
@Component({
  selector: 'app-settings-categories',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, CategoryForm, BudgetForm, CostCenterForm],
  template: `
    <div class="stack">
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>Investment streams</h2><p>Where spending and investments are booked, each with its budget and type</p></div>
          @if (canEdit()) {
            <button appBtn size="sm" icon="plus" (click)="openCenter(null)">Add stream</button>
          }
        </div>
        <div class="card__body">
          <app-data-table [columns]="centerColumns" [rows]="centers()" [actions]="centerActions" [searchable]="false" [loading]="budgets.isLoading()"
            emptyTitle="No streams" emptyText="Add the first one." (action)="onCenterAction($event)" />
        </div>
      </div>

      <div class="two-col">
        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Income categories</h2><p>On income invoices</p></div>
            @if (canEdit()) {
            <button appBtn size="sm" icon="plus" (click)="openCategory('INCOME')">Add category</button>
          }
          </div>
          <div class="card__body">
            <app-data-table [columns]="categoryColumns" [rows]="income.value() ?? []" [actions]="categoryActions" [searchable]="false" [loading]="income.isLoading()"
              emptyTitle="No income categories" emptyText="Add the first one." (action)="onCategoryAction($event)" />
          </div>
        </div>
        <div class="card" data-flush>
          <div class="card__head">
            <div><h2>Expense categories</h2><p>On supplier bills</p></div>
            @if (canEdit()) {
            <button appBtn size="sm" icon="plus" (click)="openCategory('EXPENSE')">Add category</button>
          }
          </div>
          <div class="card__body">
            <app-data-table [columns]="categoryColumns" [rows]="expense.value() ?? []" [actions]="categoryActions" [searchable]="false" [loading]="expense.isLoading()"
              emptyTitle="No expense categories" emptyText="Add the first one." (action)="onCategoryAction($event)" />
          </div>
        </div>
      </div>
    </div>

    <app-category-form [(open)]="categoryOpen" [category]="editingCategory()" [kind]="newKind()" (saved)="reload()" />
    <app-budget-form [(open)]="budgetOpen" [centers]="budgets.value() ?? []" [only]="editingCenter()" (saved)="reload()" />
    <app-cost-center-form [(open)]="costCenterOpen" [center]="typeCenter()" (saved)="reload()" />
  `,
  styles: `
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-4);

      @media (max-width: 1100px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class SettingsCategories {
  private fin = inject(FinanceApi);
  private api = inject(SettingsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);
  protected canEdit = computed(() => this.auth.can('admin'));

  private tick = signal(0);
  protected budgets = rxResource({ params: () => this.tick(), stream: () => this.fin.budgets() });
  protected income = rxResource({ params: () => this.tick(), stream: () => this.fin.categories('INCOME') });
  protected expense = rxResource({ params: () => this.tick(), stream: () => this.fin.categories('EXPENSE') });

  protected centers = computed(() => this.budgets.value() ?? []);
  /** cost center rows by name, so a budget row can be renamed (it needs the category id, which the budget row also carries) */
  protected centerColumns: TableColumn<Budget>[] = [
    { id: 'name', label: 'Stream', value: (b) => b.name },
    {
      id: 'type', label: 'Type', value: (b) => b.streamType || 'Not set', priority: 2,
      sub: (b) => (b.depreciationRate > 0 ? `Depreciates ${b.depreciationRate}% a year` : null),
    },
    { id: 'budget', label: 'Budget (PKR)', kind: 'money', value: (b) => b.budget },
    { id: 'spent', label: 'Spent', kind: 'money', priority: 2, value: (b) => b.spent, sub: (b) => `${b.usedPct}% used` },
  ];
  protected centerActions = (): RowAction[] => !this.canEdit() ? [] : [{ id: 'budget', label: 'Edit budget' }, { id: 'type', label: 'Set type' }, { id: 'rename', label: 'Rename' }, { id: 'delete', label: 'Delete', tone: 'danger' }];

  protected categoryColumns: TableColumn<CategoryRow>[] = [{ id: 'name', label: 'Category', value: (c) => c.name }];
  protected categoryActions = (): RowAction[] => !this.canEdit() ? [] : [{ id: 'rename', label: 'Rename' }, { id: 'delete', label: 'Delete', tone: 'danger' }];

  protected money = fmtMoney;

  // forms
  protected categoryOpen = signal(false);
  protected editingCategory = signal<CategoryRow | null>(null);
  protected newKind = signal<'INCOME' | 'EXPENSE'>('EXPENSE');
  protected budgetOpen = signal(false);
  protected editingCenter = signal<Budget | null>(null);
  protected costCenterOpen = signal(false);
  /** the stream whose type is being set (null = adding a new stream) */
  protected typeCenter = signal<Budget | null>(null);

  protected openCenter(b: Budget | null) {
    this.typeCenter.set(b);
    this.costCenterOpen.set(true);
  }

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openCategory(kind: 'INCOME' | 'EXPENSE', c: CategoryRow | null = null) {
    this.newKind.set(kind);
    this.editingCategory.set(c);
    this.categoryOpen.set(true);
  }

  /** the category row of a cost center (budgets and categories share the id) */
  private centerRow(b: Budget): CategoryRow {
    return { id: b.id, kind: 'COST_CENTER', name: b.name, budget: b.budget };
  }

  protected onCenterAction(e: RowActionEvent<Budget>) {
    if (e.id === 'budget') { this.editingCenter.set(e.row); this.budgetOpen.set(true); return; }
    if (e.id === 'type') return this.openCenter(e.row);
    if (e.id === 'rename') return this.openCategory('EXPENSE', this.centerRow(e.row));
    void this.remove(this.centerRow(e.row));
  }

  protected onCategoryAction(e: RowActionEvent<CategoryRow>) {
    if (e.id === 'rename') return this.openCategory(e.row.kind === 'INCOME' ? 'INCOME' : 'EXPENSE', e.row);
    void this.remove(e.row);
  }

  private async remove(c: CategoryRow) {
    const ok = await this.confirm.ask({
      title: `Delete ${c.name}?`,
      message: 'It is removed for good. A category that documents already use cannot be deleted; rename it instead.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.deleteCategory(c.id).subscribe({
      next: () => { this.toast.success('Deleted.'); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }
}
