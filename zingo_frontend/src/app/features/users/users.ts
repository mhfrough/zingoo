import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtNumber } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TabItem, TabPanel, Tabs, TableColumn, ToastService,
} from '../../ui';
import { NAV } from '../../portal.config';
import { OpsApi } from '../ops/ops.api';
import { PasswordForm } from './password-form';
import { UserForm } from './user-form';
import { ROLE_LIST, UserRow, UsersApi } from './users.api';

const ROLE_TONE: Record<string, Tone> = {
  Admin: 'accent', Finance: 'info', Manufacturing: 'warning', Distribution: 'success', Exports: 'success', Viewer: 'neutral', Investor: 'info', Distributor: 'neutral',
};

/** what each kind of change is called in the permission table */
const WRITE_LABEL: Record<string, string> = {
  manufacturing: 'Manufacturing: products, batches, payments to the factory',
  distribution: 'Distribution: distributors, orders, dispatch, collections, agreed rates',
  finance: 'Finance: entries, signing, income and expense documents, vouchers, accounts',
  exports: 'Exports: container quotes, shipping, collections, export costs',
  admin: 'Settings, users, budgets and every list (Admin only)',
};

/** one row of the permission table: a page and which roles may open it */
interface PageRow {
  label: string;
  roles: Record<string, boolean>;
}

/**
 * Users & Roles: who can sign in, with which role and signing seat, and what each role can open and change.
 * The roles themselves are fixed by how the app works; the people and their roles are yours to set.
 */
@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, Kpi, PageHeader, Tabs, TabPanel, UserForm, PasswordForm],
  templateUrl: './users.html',
  styleUrl: './users.css',
})
export class Users {
  private api = inject(UsersApi);
  private ops = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  private tick = signal(0);
  protected users = rxResource({ params: () => this.tick(), stream: () => this.api.list() });
  protected access = rxResource({ stream: () => this.api.access() });
  protected distributors = rxResource({ stream: () => this.ops.distributors() });

  protected canEdit = computed(() => this.auth.can('admin'));
  protected tab = signal('people');
  protected tabs = computed<TabItem[]>(() => [
    { id: 'people', label: 'People', icon: 'users', count: this.users.value()?.length ?? 0 },
    { id: 'roles', label: 'Roles & access', icon: 'shield-check' },
  ]);
  protected number = fmtNumber;

  // ───────────── numbers ─────────────
  private all = computed(() => this.users.value() ?? []);
  protected active = computed(() => this.all().filter((u) => u.status === 'Active').length);
  protected disabled = computed(() => this.all().filter((u) => u.status === 'Disabled').length);
  protected signers = computed(() => this.all().filter((u) => u.status === 'Active' && u.seat !== 'None').length);
  protected admins = computed(() => this.all().filter((u) => u.status === 'Active' && u.role === 'Admin').length);

  // ───────────── people ─────────────
  protected columns: TableColumn<UserRow>[] = [
    { id: 'name', label: 'Name', value: (u) => u.name, sub: (u) => u.email },
    { id: 'role', label: 'Role', kind: 'tag', value: (u) => u.role, tone: (u): Tone => ROLE_TONE[u.role] ?? 'neutral', sub: (u) => u.distributorName },
    { id: 'seat', label: 'Signing seat', priority: 2, value: (u) => (u.seat === 'None' ? '-' : u.seat === 'Both' ? 'Seat A and B' : `Seat ${u.seat}`) },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (u) => (u.isRoot ? `${u.status} · root` : u.status),
      tone: (u): Tone => (u.status === 'Active' ? 'success' : 'neutral'),
    },
  ];

  protected actions = (u: UserRow): RowAction[] => {
    if (!this.canEdit()) return [];
    const mine = u.id === this.auth.user()?.id;
    return [
      { id: 'edit', label: 'Edit' },
      { id: 'password', label: 'Reset password' },
      ...(u.isRoot || mine ? [] : [{ id: 'toggle', label: u.status === 'Active' ? 'Switch off' : 'Switch on', tone: (u.status === 'Active' ? 'danger' : 'success') as 'danger' | 'success' }]),
    ];
  };

  protected async onAction(e: RowActionEvent<UserRow>) {
    const u = e.row;
    if (e.id === 'edit') return this.openUser(u);
    if (e.id === 'password') { this.target.set(u); this.passwordOpen.set(true); return; }
    if (e.id !== 'toggle') return;
    if (u.status === 'Active') {
      const ok = await this.confirm.ask({
        title: `Switch off ${u.name}?`,
        message: 'They can no longer sign in. Their past work stays. You can switch them on again any time.',
        confirmLabel: 'Switch off',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.api.update(u.id, { status: u.status === 'Active' ? 'Disabled' : 'Active' }).subscribe({
      next: () => { this.toast.success(u.status === 'Active' ? `${u.name} switched off.` : `${u.name} is active again.`); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  // ───────────── roles and access ─────────────
  protected roles = ROLE_LIST;
  protected roleColumns = computed<TableColumn<PageRow>[]>(() => [
    { id: 'page', label: 'Page', value: (r) => r.label },
    ...ROLE_LIST.map((role, i): TableColumn<PageRow> => ({
      id: role, label: role, align: 'end', priority: i < 3 ? 1 : 2, value: (r) => (r.roles[role] ? 'Yes' : '-'), sortable: false,
    })),
  ]);
  protected pageRows = computed<PageRow[]>(() => {
    const pages = this.access.value()?.pages;
    if (!pages) return [];
    return NAV.filter((n) => n.path !== 'ui').map((n) => {
      const key = n.page ?? n.path;
      return { label: n.label, roles: Object.fromEntries(ROLE_LIST.map((r) => [r, !!pages[r]?.includes(key)])) };
    });
  });
  protected writeRows = computed(() =>
    Object.entries(this.access.value()?.writes ?? {}).map(([group, roles]) => ({ group, label: WRITE_LABEL[group] ?? group, roles })));

  // ───────────── forms ─────────────
  protected userOpen = signal(false);
  protected editing = signal<UserRow | null>(null);
  protected passwordOpen = signal(false);
  protected target = signal<UserRow | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openUser(u: UserRow | null = null) {
    this.editing.set(u);
    this.userOpen.set(true);
  }
}
