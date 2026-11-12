import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Btn, ConfirmService, DataTable, RowAction, RowActionEvent, TableColumn, ToastService } from '../../ui';
import { CompanyForm } from './company-form';
import { Company, SettingsApi } from './settings.api';

/** The companies of the group: add, edit, make primary, delete. */
@Component({
  selector: 'app-settings-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, CompanyForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>Companies</h2><p>The companies of the group. The primary one names the business on every page</p></div>
        @if (canEdit()) {
          <button appBtn size="sm" icon="plus" (click)="openForm()">Add company</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns" [rows]="companies.value() ?? []" [actions]="actions" [searchable]="false"
          [loading]="companies.isLoading()" emptyTitle="No companies" emptyText="Add the first one." (action)="onAction($event)" />
      </div>
    </div>
    <app-company-form [(open)]="formOpen" [company]="editing()" (saved)="reload()" />
  `,
})
export class SettingsCompanies {
  private api = inject(SettingsApi);
  private store = inject(SettingsStore);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  protected canEdit = computed(() => this.auth.can('admin'));

  private tick = signal(0);
  protected companies = rxResource({ params: () => this.tick(), stream: () => this.api.companies() });

  protected columns: TableColumn<Company>[] = [
    { id: 'name', label: 'Company', value: (c) => c.name, sub: (c) => c.legalName || null },
    { id: 'contact', label: 'Contact', priority: 2, value: (c) => c.poc || c.phone || c.email || null, sub: (c) => (c.taxNo ? `NTN ${c.taxNo}` : null) },
    { id: 'status', label: 'Status', kind: 'tag', value: (c) => (c.primary ? 'Primary' : c.active ? 'Active' : 'Switched off') },
  ];
  protected actions = (c: Company): RowAction[] => !this.canEdit() ? [] : [
    { id: 'edit', label: 'Edit' },
    ...(c.primary ? [] : [{ id: 'primary', label: 'Make primary' }, { id: 'delete', label: 'Delete', tone: 'danger' as const }]),
  ];

  protected formOpen = signal(false);
  protected editing = signal<Company | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
    this.store.reload();
  }

  protected openForm(c: Company | null = null) {
    this.editing.set(c);
    this.formOpen.set(true);
  }

  protected onAction(e: RowActionEvent<Company>) {
    if (e.id === 'edit') return this.openForm(e.row);
    if (e.id === 'primary') {
      this.api.saveCompany(e.row.id, { primary: true, active: true }).subscribe({
        next: () => { this.toast.success(`${e.row.name} is now the primary company.`); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }
    void this.remove(e.row);
  }

  private async remove(c: Company) {
    const ok = await this.confirm.ask({ title: `Delete ${c.name}?`, message: 'It is removed for good.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    this.api.deleteCompany(c.id).subscribe({
      next: () => { this.toast.success('Deleted.'); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }
}
