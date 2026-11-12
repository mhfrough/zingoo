import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { downloadCsv } from '../../shared/csv';
import { errorText } from '../../shared/errors';
import { Tone, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TabItem, TabPanel, Tabs, Tag,
  TableColumn, ToastService,
} from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountingDoc, CashBookRow, JournalLine, OpenItem, Settlement } from '../finance/models';
import { IncomeInvoiceForm } from './income-invoice-form';
import { ExpenseBillForm } from './expense-bill-form';
import { SettleForm } from './settle-form';

/** `YYYY-MM` -> "Nov 2026" for the period selector */
const periodLabel = (p: string) =>
  p === 'all' ? 'All dates' : new Date(`${p}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** one row of an income / expense breakdown, with its share of the total for the bar */
interface Share {
  label: string;
  amount: number;
  pct: number;
}

/** an open item with the accounting document behind it (when there is one), so it can be collected or paid here */
interface OpenRow extends OpenItem {
  doc: AccountingDoc | null;
}

/**
 * Income & Expenses: invoices and bills, collections and payments, the management profit and loss,
 * the general journal and the cash book, for one period or for all dates.
 * Dispatches, collections and approved investment spend post by themselves; only direct income and supplier bills are recorded here.
 */
@Component({
  selector: 'app-accounting',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Btn, DataTable, Kpi, PageHeader, Tag, Tabs, TabPanel, IncomeInvoiceForm, ExpenseBillForm, SettleForm,
  ],
  templateUrl: './accounting.html',
  styleUrl: './accounting.css',
})
export class Accounting {
  private fin = inject(FinanceApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  protected period = signal('all');
  protected tab = signal('overview');
  private tick = signal(0);

  // period-independent data
  protected docs = rxResource({ params: () => this.tick(), stream: () => this.fin.docs() });
  protected settlements = rxResource({ params: () => this.tick(), stream: () => this.fin.settlements() });
  protected currencies = rxResource({ params: () => this.tick(), stream: () => this.fin.currencies() });
  protected incomeCats = rxResource({ stream: () => this.fin.categories('INCOME') });
  protected expenseCats = rxResource({ stream: () => this.fin.categories('EXPENSE') });
  protected periods = rxResource({ params: () => this.tick(), stream: () => this.fin.periods() });
  protected receivables = rxResource({ params: () => this.tick(), stream: () => this.fin.receivables() });
  protected payables = rxResource({ params: () => this.tick(), stream: () => this.fin.payables() });
  protected flows = rxResource({ params: () => this.tick(), stream: () => this.fin.cashFlows() });

  // period-dependent data
  private query = computed(() => ({ tick: this.tick(), period: this.period() }));
  protected statement = rxResource({ params: () => this.query(), stream: ({ params }) => this.fin.incomeStatement(params.period) });
  protected journal = rxResource({ params: () => this.query(), stream: ({ params }) => this.fin.journal(params.period) });
  protected cashBook = rxResource({ params: () => this.query(), stream: ({ params }) => this.fin.cashBook(params.period) });

  protected canWrite = computed(() => this.auth.can('finance'));
  protected money = fmtMoney;
  protected number = fmtNumber;

  protected periodOptions = computed(() => [
    { value: 'all', label: periodLabel('all') },
    ...(this.periods.value() ?? []).map((p) => ({ value: p, label: periodLabel(p) })),
  ]);

  // ───────────── numbers ─────────────
  /** documents dated inside the selected period */
  protected periodDocs = computed(() => {
    const p = this.period();
    return [...(this.docs.value() ?? [])]
      .filter((d) => p === 'all' || d.date.slice(0, 7) === p)
      .sort((a, b) => b.date.localeCompare(a.date) || b.refNo.localeCompare(a.refNo));
  });
  protected periodSettlements = computed(() => {
    const p = this.period();
    return [...(this.settlements.value() ?? [])]
      .filter((s) => p === 'all' || s.date.slice(0, 7) === p)
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  protected waiting = computed(() => (this.docs.value() ?? []).filter((d) => d.needsApproval && !d.approved));

  protected tabs = computed<TabItem[]>(() => [
    { id: 'overview', label: 'Overview & P&L', icon: 'trending-up' },
    { id: 'transactions', label: 'Income / Expenses', icon: 'receipt', count: this.periodDocs().length },
    { id: 'journal', label: 'Journal & Cashbook', icon: 'book' },
  ]);

  private share(rec: Record<string, number> | undefined): Share[] {
    const rows = Object.entries(rec ?? {}).filter(([, v]) => Math.abs(v) > 0.004);
    const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
    return rows.map(([name, amount]) => ({
      label: name.replace(/^(Income|Expense) · /, ''), amount, pct: Math.round((Math.abs(amount) / max) * 100),
    }))
      .sort((a, b) => b.amount - a.amount);
  }
  protected incomeShare = computed(() => this.share(this.statement.value()?.income));
  protected expenseShare = computed(() => this.share(this.statement.value()?.expenses));

  // ───────────── open items ─────────────
  private byRef = computed(() => new Map((this.docs.value() ?? []).map((d) => [d.refNo, d])));
  protected openReceivables = computed<OpenRow[]>(() =>
    (this.receivables.value()?.rows ?? []).map((r) => ({ ...r, doc: this.byRef().get(r.reference) ?? null })));
  protected openPayables = computed<OpenRow[]>(() =>
    (this.payables.value()?.rows ?? []).map((r) => ({ ...r, doc: this.byRef().get(r.reference) ?? null })));

  protected openColumns = (due: string): TableColumn<OpenRow>[] => [
    { id: 'ref', label: 'Document', value: (r) => r.reference, sub: (r) => r.type },
    { id: 'party', label: 'Party', value: (r) => r.party, priority: 2 },
    { id: 'due', label: due, kind: 'date', value: (r) => r.dueDate, priority: 3 },
    { id: 'out', label: 'Outstanding (PKR)', kind: 'money', value: (r) => r.outstanding },
  ];
  protected receivableColumns = this.openColumns('Due');
  protected payableColumns = this.openColumns('Due');

  /** collect / pay only for documents recorded here; dispatch invoices are collected on the Distribution page */
  protected openActions = (r: OpenRow): RowAction[] =>
    this.canWrite() && r.doc && r.doc.approved && r.doc.due > 0
      ? [{ id: 'settle', label: r.doc.kind === 'Income' ? 'Collect' : 'Pay', tone: 'success' }]
      : [];

  // ───────────── documents ─────────────
  protected statusTone = (d: AccountingDoc): Tone => {
    if (!d.approved) return 'warning';
    if (d.due < 0.01) return 'success';
    return d.paid > 0 ? 'info' : 'warning';
  };

  private seatsFor(d: AccountingDoc): ('A' | 'B')[] {
    const seat = this.auth.user()?.seat;
    const mine: ('A' | 'B')[] = seat === 'Both' ? ['A', 'B'] : seat === 'A' ? ['A'] : seat === 'B' ? ['B'] : [];
    return mine.filter((s) => !d.signatures.includes(s));
  }

  /** a document is locked once it has payments, or (for a bill) once it is approved */
  private locked = (d: AccountingDoc) => d.paid > 0 || (d.kind === 'Expense' && d.approved);

  protected docColumns: TableColumn<AccountingDoc>[] = [
    { id: 'ref', label: 'Document', value: (d) => d.refNo, sub: (d) => fmtDate(d.date) },
    {
      id: 'kind', label: 'Type', kind: 'tag', value: (d) => d.kind, tone: (d): Tone => (d.kind === 'Income' ? 'success' : 'warning'),
      sub: (d) => d.category, priority: 2,
    },
    { id: 'party', label: 'Customer / vendor', value: (d) => d.party, sub: (d) => d.note, priority: 3 },
    {
      id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (d) => d.amount,
      sub: (d) => (d.currency !== 'PKR' && d.foreignAmount ? `${d.currency} ${fmtNumber(d.foreignAmount)} @ ${d.fxRate}` : null),
    },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (d) => d.status, tone: this.statusTone,
      sub: (d) => (!d.approved ? `${d.signatures.length} of ${d.requiredSignatures} signatures` : d.due > 0 ? `${fmtMoney(d.due)} open` : null),
    },
  ];

  protected docActions = (d: AccountingDoc): RowAction[] => {
    if (!this.canWrite()) return [];
    const acts: RowAction[] = [];
    if (d.needsApproval && !d.approved) {
      acts.push(...this.seatsFor(d).map((s): RowAction => ({ id: `sign-${s}`, label: `Sign ${s}`, tone: 'success' })));
    }
    if (d.approved && d.due > 0) acts.push({ id: 'settle', label: d.kind === 'Income' ? 'Collect' : 'Pay', tone: 'success' });
    if (!this.locked(d)) {
      acts.push({ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' });
    }
    return acts;
  };

  protected settlementColumns: TableColumn<Settlement>[] = [
    { id: 'ref', label: 'Entry', value: (s) => s.refNo, sub: (s) => fmtDate(s.date) },
    { id: 'doc', label: 'Document', value: (s) => s.document.refNo, sub: (s) => s.document.party, priority: 2 },
    {
      id: 'flow', label: 'Flow', kind: 'tag', value: (s) => (s.document.kind === 'Income' ? 'Receipt' : 'Payment'),
      tone: (s): Tone => (s.document.kind === 'Income' ? 'success' : 'warning'), priority: 2,
    },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (s) => s.amount },
    { id: 'method', label: 'Method', value: (s) => s.method, sub: (s) => s.note, priority: 3 },
  ];

  // ───────────── journal and cash book ─────────────
  protected journalColumns: TableColumn<JournalLine>[] = [
    { id: 'date', label: 'Date / reference', value: (j) => fmtDate(j.date), sub: (j) => j.reference },
    { id: 'account', label: 'Account', value: (j) => j.account, sub: (j) => j.accountCode, priority: 2 },
    { id: 'desc', label: 'Description', value: (j) => j.description, sub: (j) => j.source, priority: 3 },
    { id: 'debit', label: 'Debit', kind: 'money', value: (j) => (j.debit ? j.debit : '') },
    { id: 'credit', label: 'Credit', kind: 'money', value: (j) => (j.credit ? j.credit : '') },
  ];
  protected journalTotals = computed(() => {
    const rows = this.journal.value() ?? [];
    return {
      date: 'Total',
      debit: fmtMoney(rows.reduce((n, r) => n + Number(r.debit), 0)),
      credit: fmtMoney(rows.reduce((n, r) => n + Number(r.credit), 0)),
    };
  });

  protected cashColumns: TableColumn<CashBookRow>[] = [
    { id: 'date', label: 'Date / reference', value: (c) => fmtDate(c.date), sub: (c) => c.reference },
    { id: 'desc', label: 'Transaction', value: (c) => c.description, sub: (c) => c.source, priority: 2 },
    { id: 'in', label: 'Cash in', kind: 'money', value: (c) => (c.cashIn ? c.cashIn : '') },
    { id: 'out', label: 'Cash out', kind: 'money', value: (c) => (c.cashOut ? c.cashOut : '') },
    { id: 'balance', label: 'Balance', kind: 'money', value: (c) => c.balance },
  ];
  /** newest movement first, as in the prototype */
  protected cashRows = computed(() => [...(this.cashBook.value() ?? [])].reverse());

  // ───────────── forms ─────────────
  protected docKind = signal<'Income' | 'Expense'>('Income');
  protected editingDoc = signal<AccountingDoc | null>(null);
  protected settleOpen = signal(false);
  protected settling = signal<AccountingDoc | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  /** an income invoice opens the step-by-step invoice; an expense bill the short form */
  protected incomeOpen = signal(false);
  protected billOpen = signal(false);

  protected openDoc(kind: 'Income' | 'Expense', doc: AccountingDoc | null = null) {
    this.docKind.set(kind);
    this.editingDoc.set(doc);
    if (kind === 'Income') this.incomeOpen.set(true);
    else this.billOpen.set(true);
  }

  protected openSettle(doc: AccountingDoc) {
    this.settling.set(doc);
    this.settleOpen.set(true);
  }

  protected onOpenAction(e: RowActionEvent<OpenRow>) {
    if (e.id === 'settle' && e.row.doc) this.openSettle(e.row.doc);
  }

  protected async onDocAction(e: RowActionEvent<AccountingDoc>) {
    const doc = e.row;
    if (e.id === 'edit') return this.openDoc(doc.kind, doc);
    if (e.id === 'settle') return this.openSettle(doc);

    if (e.id === 'sign-A' || e.id === 'sign-B') {
      this.fin.signDoc(doc.id, e.id === 'sign-A' ? 'A' : 'B').subscribe({
        next: (res) => {
          this.toast.success(res.approved
            ? 'Fully approved. The bill is now in payables and can be paid.'
            : 'Signature recorded. Waiting for the other signatory.');
          this.reload();
        },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }

    if (e.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete ${doc.refNo}?`,
        message: `The ${doc.kind.toLowerCase()} for ${doc.party} (${fmtMoney(doc.amount)}) will be removed. This cannot be undone.`,
        confirmLabel: 'Delete document',
        tone: 'danger',
      });
      if (!ok) return;
      this.fin.deleteDoc(doc.id).subscribe({
        next: () => { this.toast.success('Document deleted.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  // ───────────── CSV ─────────────
  protected exportCsv() {
    const stamp = this.period() === 'all' ? 'all-dates' : this.period();
    downloadCsv(`zingoo-accounting-${stamp}.csv`, [
      {
        title: 'GENERAL JOURNAL',
        rows: (this.journal.value() ?? []).map((j) => ({
          date: j.date, source: j.source, reference: j.reference, description: j.description,
          account: j.account, debit: j.debit, credit: j.credit,
        })),
      },
      {
        title: 'INCOME AND EXPENSE DOCUMENTS',
        rows: this.periodDocs().map((d) => ({
          reference: d.refNo, date: d.date, type: d.kind, category: d.category, party: d.party,
          currency: d.currency, amount_pkr: d.amount, settled: d.paid, open: d.due, status: d.status, due_date: d.dueDate, note: d.note,
        })),
      },
      {
        title: 'RECEIPTS AND PAYMENTS',
        rows: this.periodSettlements().map((s) => ({
          reference: s.refNo, date: s.date, document: s.document.refNo, party: s.document.party,
          flow: s.document.kind === 'Income' ? 'Receipt' : 'Payment', amount_pkr: s.amount, method: s.method,
        })),
      },
    ]);
  }
}
