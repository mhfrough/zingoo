import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { downloadCsv } from '../../shared/csv';
import { errorText } from '../../shared/errors';
import { Tone, fmtAmount2, fmtDate, fmtMoney } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TabItem, TabPanel, Tabs, Tag, TableColumn, ToastService,
} from '../../ui';
import { FinanceApi } from '../finance/finance.api';
import { AccountForm } from './account-form';
import { LedgerApi } from './ledger.api';
import { Account, AgedRow, BalanceLine, LedgerLine, TrialRow, Voucher } from './models';
import { VoucherForm } from './voucher-form';

/** `YYYY-MM` -> "Nov 2026" */
const periodLabel = (p: string) =>
  p === 'all' ? 'All dates' : new Date(`${p}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const TYPE_TONE: Record<string, Tone> = {
  Asset: 'info', Liability: 'warning', Equity: 'accent', Revenue: 'success', COGS: 'neutral', Expense: 'danger',
};

/**
 * General Ledger: the books behind every other page. Trial balance, one account's ledger, profit and loss with cash flows,
 * balance sheet, manual journal vouchers, the chart of accounts and aged receivables.
 * Everything is read from the posted journal, so it always agrees with the rest of the app.
 */
@Component({
  selector: 'app-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, Kpi, PageHeader, Tag, Tabs, TabPanel, VoucherForm, AccountForm],
  templateUrl: './ledger.html',
  styleUrl: './ledger.css',
})
export class Ledger {
  private api = inject(LedgerApi);
  private fin = inject(FinanceApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  protected auth = inject(AuthService);

  protected tab = signal('trial');
  protected period = signal('all');
  /** account code, or 'all' */
  protected account = signal('all');
  private tick = signal(0);

  protected trial = rxResource({ params: () => this.tick(), stream: () => this.api.trialBalance() });
  protected accounts = rxResource({ params: () => this.tick(), stream: () => this.api.accounts() });
  protected periods = rxResource({ params: () => this.tick(), stream: () => this.fin.periods() });
  protected currencies = rxResource({ stream: () => this.fin.currencies() });
  protected balance = rxResource({ params: () => this.tick(), stream: () => this.api.balanceSheet() });
  protected aged = rxResource({ params: () => this.tick(), stream: () => this.api.aged() });
  protected vouchers = rxResource({ params: () => this.tick(), stream: () => this.api.vouchers() });
  protected flows = rxResource({ params: () => this.tick(), stream: () => this.fin.cashFlows() });
  private query = computed(() => ({ tick: this.tick(), period: this.period() }));
  protected statement = rxResource({ params: () => this.query(), stream: ({ params }) => this.fin.incomeStatement(params.period) });
  private lineQuery = computed(() => ({ tick: this.tick(), period: this.period(), account: this.account() }));
  protected lines = rxResource({ params: () => this.lineQuery(), stream: ({ params }) => this.api.accountLedger(params.account, params.period) });

  protected canWrite = computed(() => this.auth.can('finance'));
  protected money = fmtMoney;
  protected amount = fmtAmount2;

  protected periodOptions = computed(() => [
    { value: 'all', label: periodLabel('all') },
    ...(this.periods.value() ?? []).map((p) => ({ value: p, label: periodLabel(p) })),
  ]);
  protected accountOptions = computed(() => this.accounts.value() ?? []);
  /** accounts a voucher may use */
  protected activeAccounts = computed(() => (this.accounts.value() ?? []).filter((a) => a.active));

  protected tabs = computed<TabItem[]>(() => [
    { id: 'trial', label: 'Trial balance', icon: 'scale' },
    { id: 'ledger', label: 'Account ledger', icon: 'book' },
    { id: 'pnl', label: 'Profit & loss', icon: 'trending-up' },
    { id: 'balance', label: 'Balance sheet', icon: 'landmark' },
    { id: 'vouchers', label: 'Journal vouchers', icon: 'file', count: this.vouchers.value()?.length ?? 0 },
    { id: 'accounts', label: 'Chart of accounts', icon: 'list', count: this.accounts.value()?.length ?? 0 },
    { id: 'aged', label: 'Aged receivables', icon: 'clock' },
  ]);

  // ───────────── trial balance ─────────────
  /** accounts that carry a balance, shown on the debit or the credit side */
  protected trialRows = computed(() => (this.trial.value()?.accounts ?? []).filter((a) => Math.abs(a.net) > 0.004));
  protected trialColumns: TableColumn<TrialRow>[] = [
    { id: 'account', label: 'Account', value: (a) => a.name, sub: (a) => `${a.code} · ${a.type}` },
    { id: 'debit', label: 'Debit', kind: 'money', value: (a) => (a.net > 0 ? a.net : '') , sortValue: (a) => Math.max(0, a.net) },
    { id: 'credit', label: 'Credit', kind: 'money', value: (a) => (a.net < 0 ? -a.net : ''), sortValue: (a) => Math.max(0, -a.net) },
  ];
  protected trialTotals = computed(() => {
    const rows = this.trialRows();
    return {
      account: 'Total',
      debit: fmtMoney(rows.reduce((n, a) => n + Math.max(0, a.net), 0)),
      credit: fmtMoney(rows.reduce((n, a) => n + Math.max(0, -a.net), 0)),
    };
  });
  protected trialActions = (): RowAction[] => [{ id: 'ledger', label: 'View ledger' }];

  protected onTrialAction(e: RowActionEvent<TrialRow>) {
    if (e.id === 'ledger') this.viewLedger(e.row.code);
  }

  // ───────────── account ledger ─────────────
  protected ledgerRows = computed(() => [...(this.lines.value() ?? [])].reverse());
  protected ledgerColumns: TableColumn<LedgerLine>[] = [
    { id: 'date', label: 'Date / reference', value: (l) => fmtDate(l.date), sortValue: (l) => l.date, sub: (l) => l.reference },
    { id: 'account', label: 'Account', value: (l) => l.account, sub: (l) => l.accountCode, priority: 2 },
    { id: 'desc', label: 'Description', value: (l) => l.description, sub: (l) => l.source, priority: 3 },
    { id: 'debit', label: 'Debit', kind: 'money', value: (l) => (l.debit ? l.debit : '') },
    { id: 'credit', label: 'Credit', kind: 'money', value: (l) => (l.credit ? l.credit : '') },
    { id: 'running', label: 'Running balance', kind: 'money', priority: 2, value: (l) => l.running },
  ];

  protected viewLedger(code: string) {
    this.account.set(code);
    this.tab.set('ledger');
  }

  // ───────────── balance sheet ─────────────
  protected balanceColumns: TableColumn<BalanceLine>[] = [
    { id: 'name', label: 'Account', value: (b) => b.name, sub: (b) => b.code },
    { id: 'balance', label: 'Balance (PKR)', kind: 'money', value: (b) => b.balance },
  ];

  // ───────────── vouchers ─────────────
  protected voucherColumns: TableColumn<Voucher>[] = [
    { id: 'ref', label: 'Voucher', value: (v) => v.refNo, sub: (v) => fmtDate(v.date) },
    { id: 'memo', label: 'Description', value: (v) => v.memo, sub: (v) => (v.reverses ? `Reverses ${v.reverses}` : `${v.lines.length} lines`), priority: 2 },
    {
      id: 'amount', label: 'Amount', kind: 'mono', align: 'end',
      value: (v) => `${v.currency} ${fmtAmount2(v.lines.reduce((n, l) => n + Number(l.debit), 0))}`,
      sortValue: (v) => v.lines.reduce((n, l) => n + Number(l.debit), 0) * Number(v.fxRate),
      sub: (v) => (v.currency === 'PKR' ? null : `at ${fmtAmount2(v.fxRate, 4)}`),
    },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (v) => v.status, tone: (v): Tone => (v.status === 'Posted' ? 'success' : 'neutral'),
    },
  ];
  protected voucherActions = (v: Voucher): RowAction[] =>
    this.canWrite() && v.status === 'Posted' && !v.reverses ? [{ id: 'reverse', label: 'Reverse', tone: 'danger' }] : [];

  protected async onVoucherAction(e: RowActionEvent<Voucher>) {
    if (e.id !== 'reverse') return;
    const v = e.row;
    const ok = await this.confirm.ask({
      title: `Reverse voucher ${v.refNo}?`,
      message: 'An opposite voucher is posted today and the original stays visible, so the audit trail is kept.',
      confirmLabel: 'Post reversal',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.reverseVoucher(v.id).subscribe({
      next: () => { this.toast.success(`${v.refNo} reversed.`); this.reload(); },
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  // ───────────── chart of accounts ─────────────
  private net = computed(() => new Map((this.trial.value()?.accounts ?? []).map((a) => [a.code, a.net])));
  protected accountColumns: TableColumn<Account>[] = [
    { id: 'name', label: 'Account', value: (a) => a.name, sub: (a) => a.code },
    { id: 'type', label: 'Type', kind: 'tag', value: (a) => a.type, tone: (a): Tone => TYPE_TONE[a.type] ?? 'neutral', priority: 2 },
    { id: 'balance', label: 'Balance (PKR)', kind: 'money', value: (a) => this.net().get(a.code) ?? 0 },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (a) => (a.active ? 'Active' : 'Switched off'),
      tone: (a): Tone => (a.active ? 'success' : 'neutral'), priority: 3,
    },
  ];
  protected accountActions = (a: Account): RowAction[] => [
    { id: 'ledger', label: 'View ledger' },
    ...(this.canWrite()
      ? [{ id: 'rename', label: 'Rename' }, { id: 'toggle', label: a.active ? 'Switch off' : 'Switch on', tone: a.active ? 'danger' as const : 'success' as const }]
      : []),
  ];

  protected onAccountAction(e: RowActionEvent<Account>) {
    const a = e.row;
    if (e.id === 'ledger') return this.viewLedger(a.code);
    if (e.id === 'rename') return this.openAccount(a);
    if (e.id === 'toggle') {
      this.api.updateAccount(a.id, { active: !a.active }).subscribe({
        next: () => { this.toast.success(a.active ? `${a.name} switched off. Old postings stay.` : `${a.name} is active again.`); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  // ───────────── aged receivables ─────────────
  protected agedColumns: TableColumn<AgedRow>[] = [
    { id: 'ref', label: 'Invoice', value: (r) => r.reference, sub: (r) => r.type },
    { id: 'party', label: 'Customer', value: (r) => r.party, priority: 2 },
    {
      id: 'due', label: 'Due / age', value: (r) => fmtDate(r.dueDate), sortValue: (r) => r.dueDate,
      sub: (r) => (r.daysOverdue ? `${r.daysOverdue} days overdue` : 'Not yet due'), priority: 3,
    },
    { id: 'bucket', label: 'Bucket', kind: 'tag', value: (r) => r.bucket, tone: (r): Tone => (r.bucketIndex === 0 ? 'success' : r.bucketIndex < 3 ? 'warning' : 'danger'), priority: 2 },
    { id: 'out', label: 'Outstanding (PKR)', kind: 'money', value: (r) => r.outstanding },
  ];
  protected agedTotals = computed(() => ({ out: fmtMoney(this.aged.value()?.total ?? 0) }));

  // ───────────── forms and export ─────────────
  protected voucherOpen = signal(false);
  protected accountOpen = signal(false);
  protected editingAccount = signal<Account | null>(null);

  protected reload() {
    this.tick.update((n) => n + 1);
  }

  protected openAccount(a: Account | null = null) {
    this.editingAccount.set(a);
    this.accountOpen.set(true);
  }

  protected exportCsv() {
    downloadCsv('zingoo-ledger.csv', [
      {
        title: 'TRIAL BALANCE',
        rows: (this.trial.value()?.accounts ?? []).map((a) => ({ code: a.code, account: a.name, type: a.type, debit: a.debit, credit: a.credit, net: a.net })),
      },
      {
        title: 'LEDGER LINES',
        rows: (this.lines.value() ?? []).map((l) => ({
          date: l.date, reference: l.reference, source: l.source, account: l.account, description: l.description,
          debit: l.debit, credit: l.credit, running: l.running,
        })),
      },
    ]);
  }
}
