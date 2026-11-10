import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TableColumn, Tag, ToastService,
} from '../../ui';
import { OpsApi } from '../ops/ops.api';
import { BudgetForm } from './budget-form';
import { CapitalTargetForm } from './capital-target-form';
import { CostCenterForm } from './cost-center-form';
import { FinanceApi } from './finance.api';
import { FinanceEntryForm } from './finance-entry-form';
import { Budget, FinanceEntry } from './models';

const TYPE_TONE: Record<string, Tone> = {
  'Capital Injection': 'success', 'Other Receipt': 'info', 'Operating Expense': 'warning', 'Asset Purchase': 'accent',
};

/**
 * Investment & Finance: capital, spend and the two-signature approval desk, against budgets per cost center.
 * Everything is read from the API; signing, editing and deleting go back through it.
 */
@Component({
  selector: 'app-finance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Btn, DataTable, Kpi, PageHeader, Tag, FinanceEntryForm, BudgetForm, CostCenterForm, CapitalTargetForm,
  ],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance {
  private fin = inject(FinanceApi);
  private ops = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  private tick = signal(0);
  protected entries = rxResource({ params: () => this.tick(), stream: () => this.fin.entries() });
  protected budgets = rxResource({ params: () => this.tick(), stream: () => this.fin.budgets() });
  protected flows = rxResource({ params: () => this.tick(), stream: () => this.fin.cashFlows() });
  protected statement = rxResource({ params: () => this.tick(), stream: () => this.fin.incomeStatement('all') });
  protected orders = rxResource({ params: () => this.tick(), stream: () => this.ops.orders() });
  protected settings = rxResource({ params: () => this.tick(), stream: () => this.ops.settings() });

  protected canWrite = computed(() => this.auth.can('finance'));
  protected isAdmin = computed(() => this.auth.can('admin'));

  // form state
  protected entryOpen = signal(false);
  protected editingEntry = signal<FinanceEntry | null>(null);
  protected budgetOpen = signal(false);
  protected editingBudget = signal<Budget | null>(null);
  protected centerOpen = signal(false);
  protected targetOpen = signal(false);

  protected money = fmtMoney;
  protected number = fmtNumber;

  // ───────────── numbers ─────────────
  protected all = computed(() => this.entries.value() ?? []);
  protected pending = computed(() => this.all().filter((e) => e.needsApproval && !e.approved));
  protected capital = computed(() =>
    this.all().filter((e) => e.type === 'Capital Injection').reduce((n, e) => n + Number(e.amount), 0));
  protected pendingAmount = computed(() => this.pending().reduce((n, e) => n + Number(e.amount), 0));

  private outflow = (label: string) => this.flows.value()?.outflows.find((r) => r.label === label)?.amount ?? 0;
  protected opex = computed(() => this.outflow('Approved operating expenses') + this.outflow('Bills paid'));
  protected assets = computed(() => this.outflow('Capital asset purchases'));
  protected paidSpend = computed(() => this.opex() + this.assets());

  private dispatched = computed(() => (this.orders.value() ?? []).filter((o) => o.status === 'Dispatched'));
  protected invoiced = computed(() => this.dispatched().reduce((n, o) => n + o.billed, 0));
  protected collected = computed(() => this.dispatched().reduce((n, o) => n + o.collected, 0));
  protected receivable = computed(() => this.dispatched().reduce((n, o) => n + o.outstanding, 0));

  /** cost centers as cards (the catch-all "Other" has no card, as in the client's prototype) */
  protected streamCards = computed(() => (this.budgets.value() ?? []).filter((b) => b.name !== 'Other'));
  protected streamNames = computed(() => (this.budgets.value() ?? []).map((b) => b.name));

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  // ───────────── approval desk and entries ─────────────

  /** the seats this user may still sign for on an entry */
  private seatsFor(e: FinanceEntry): ('A' | 'B')[] {
    const seat = this.auth.user()?.seat;
    const mine: ('A' | 'B')[] = seat === 'Both' ? ['A', 'B'] : seat === 'A' ? ['A'] : seat === 'B' ? ['B'] : [];
    return mine.filter((s) => !e.signatures.includes(s));
  }

  protected deskColumns: TableColumn<FinanceEntry>[] = [
    { id: 'ref', label: 'Request', value: (e) => e.refNo, sub: (e) => fmtDate(e.date) },
    { id: 'stream', label: 'Stream / payee', value: (e) => e.category, sub: (e) => e.party },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (e) => e.amount },
    {
      id: 'progress', label: 'Progress', kind: 'tag', value: (e) => `${e.signatures.length} of ${e.requiredSignatures} signatures`,
      tone: (): Tone => 'warning',
    },
  ];

  protected deskActions = (e: FinanceEntry): RowAction[] => {
    if (!this.canWrite()) return [];
    return [
      ...this.seatsFor(e).map((s): RowAction => ({ id: `sign-${s}`, label: `Sign ${s}`, tone: 'success' })),
      { id: 'edit', label: 'Edit' },
      { id: 'delete', label: 'Delete', tone: 'danger' },
    ];
  };

  protected entryColumns: TableColumn<FinanceEntry>[] = [
    { id: 'ref', label: 'Entry', value: (e) => e.refNo, sub: (e) => fmtDate(e.date) },
    {
      id: 'type', label: 'Type', kind: 'tag', value: (e) => e.type, tone: (e): Tone => TYPE_TONE[e.type] ?? 'neutral',
      sub: (e) => (e.type === 'Capital Injection' ? e.funding || 'Equity' : null),
    },
    { id: 'stream', label: 'Stream', value: (e) => e.category, priority: 3 },
    { id: 'party', label: 'Counterparty', value: (e) => e.party, sub: (e) => e.note, priority: 2 },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (e) => e.amount },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (e) => (e.approved ? 'Approved' : 'Pending'),
      tone: (e): Tone => (e.approved ? 'success' : 'warning'), priority: 2,
    },
  ];

  protected entryActions = (e: FinanceEntry): RowAction[] =>
    this.canWrite() && !e.approved ? [{ id: 'edit', label: 'Edit' }] : [];

  protected async onEntryAction(e: RowActionEvent<FinanceEntry>) {
    const entry = e.row;
    if (e.id === 'edit') return this.openEntry(entry);

    if (e.id === 'sign-A' || e.id === 'sign-B') {
      const seat = e.id === 'sign-A' ? 'A' : 'B';
      this.fin.signEntry(entry.id, seat).subscribe({
        next: (res) => {
          this.toast.success(res.approved
            ? 'Fully approved. The spending is now posted to cash and the budget.'
            : 'Signature recorded. Waiting for the other signatory.');
          this.reload();
        },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }

    if (e.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete request ${entry.refNo}?`,
        message: `The pending ${entry.type.toLowerCase()} of ${fmtMoney(entry.amount)} will be removed. This cannot be undone.`,
        confirmLabel: 'Delete request',
        tone: 'danger',
      });
      if (!ok) return;
      this.fin.deleteEntry(entry.id).subscribe({
        next: () => { this.toast.success('Request deleted.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  protected openEntry(e: FinanceEntry | null = null) {
    this.editingEntry.set(e);
    this.entryOpen.set(true);
  }

  protected openBudget(b: Budget | null = null) {
    this.editingBudget.set(b);
    this.budgetOpen.set(true);
  }
}
