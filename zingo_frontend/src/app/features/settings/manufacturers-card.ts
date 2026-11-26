import { logoUrl } from '../../core/attachments.api';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { fmtMoney } from '../../shared/format';
import { Btn, DataTable, RowAction, RowActionEvent, TableColumn } from '../../ui';
import { Manufacturer } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { ManufacturerForm } from './manufacturer-form';

const defaultBank = (m: Manufacturer) => m.bankAccounts?.find((b) => b.isDefault) ?? m.bankAccounts?.[0];

/**
 * The manufacturers, with add and edit: the same form (offcanvas) as Settings & Data, shown on the Operations pages
 * so a manufacturer can be added where the work happens. Only an Admin may add or change one (as in Settings).
 */
@Component({
  selector: 'app-manufacturers-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ManufacturerForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>Manufacturers</h2><p>Who makes the products, how Zen Foods pays them and into which bank account</p></div>
        @if (canEdit()) {
          <button appBtn size="sm" icon="plus" (click)="openForm(null)">Add manufacturer</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns" [rows]="manufacturers.value() ?? []" [actions]="actions" [loading]="manufacturers.isLoading()"
          [error]="manufacturers.error() ? 'The server did not answer.' : null" searchPlaceholder="Search manufacturers"
          emptyTitle="No manufacturers" emptyText="Add the first one." (action)="onAction($event)" (retry)="reload()" />
      </div>
    </div>
    <app-manufacturer-form [(open)]="open" [manufacturer]="editing()" (saved)="saved()" />
  `,
})
export class ManufacturersCard {
  private api = inject(OpsApi);
  private auth = inject(AuthService);
  /** bump to reload from outside */
  readonly tick = input(0);
  /** a manufacturer was added or changed */
  readonly changed = output<void>();

  private own = signal(0);
  protected manufacturers = rxResource({ params: () => this.tick() + this.own(), stream: () => this.api.manufacturers() });
  protected canEdit = computed(() => this.auth.can('admin'));
  protected open = signal(false);
  protected editing = signal<Manufacturer | null>(null);

  protected columns: TableColumn<Manufacturer>[] = [
    { id: 'name', label: 'Manufacturer', kind: 'title', value: (m) => m.name, sub: (m) => m.poc || m.contact || null, image: (m) => logoUrl(m.logoId) },
    {
      id: 'terms', label: 'Payment terms',
      value: (m) => (m.paymentTerms ?? ['Advance']).map((t) => (t === 'Advance' ? `${Number(m.advancePct ?? 0)}% advance` : 'Credit line')).join(' + '),
      sub: (m) => ((m.paymentTerms ?? []).includes('Credit line')
        ? `Limit ${Number(m.creditLimit) ? fmtMoney(m.creditLimit!) : 'none'} · clear in ${m.paymentDays ? m.paymentDays + ' days' : 'no limit'}`
        : 'Pay on delivery'),
    },
    {
      id: 'bank', label: 'Default bank', priority: 2, value: (m) => defaultBank(m)?.bank ?? 'No bank account',
      sub: (m) => defaultBank(m)?.account ?? null,
    },
  ];
  protected actions = (): RowAction[] => (this.canEdit() ? [{ id: 'edit', label: 'Edit' }] : []);

  /** open the form: a new manufacturer, or one to change */
  openForm(m: Manufacturer | null) {
    this.editing.set(m);
    this.open.set(true);
  }

  protected onAction(e: RowActionEvent<Manufacturer>) {
    if (e.id === 'edit') this.openForm(e.row);
  }

  protected reload() {
    this.own.update((n) => n + 1);
  }

  protected saved() {
    this.reload();
    this.changed.emit();
  }
}
