import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AttachmentsApi } from '../../core/attachments.api';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone, fmtDate, fmtMoney, fmtNumber, fmtPct } from '../../shared/format';
import {
  Btn, ConfirmService, DataTable, Kpi, PageHeader, RowAction, RowActionEvent, TableColumn, Tag, ToastService,
} from '../../ui';
import { OpsApi } from '../ops/ops.api';
import { BudgetForm } from './budget-form';
import { CapitalInjectionForm } from './capital-injection-form';
import { CapitalTargetForm } from './capital-target-form';
import { CostCenterForm } from './cost-center-form';
import { FinanceApi } from './finance.api';
import { FinanceEntryForm } from './finance-entry-form';
import { FundingPositionView } from './funding-position';
import { Budget, FinanceEntry, FundingRoom } from './models';
import { RepaymentForm } from './repayment-form';

const today = () => new Date().toISOString().slice(0, 10);

/** one investor on the investor view */
interface InvestorRow {
  name: string;
  /** Person, Manufacturer or Distributor (empty on older entries) */
  kind: string;
  /** the types of funding, e.g. "Equity · Shareholder Loan" */
  funding: string;
  injections: number;
  /** in the bank (cleared) */
  invested: number;
  /** cheques not cleared yet */
  awaiting: number;
  /** share of all capital in the bank, 0 to 100 */
  share: number;
  /** "Manufacturing 400,000 · Packaging 200,000" */
  streams: string;
  /** the earliest expected return date */
  nextReturn: string | null;
}

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
    Btn, DataTable, Kpi, PageHeader, Tag, FinanceEntryForm, BudgetForm, CostCenterForm, CapitalTargetForm, CapitalInjectionForm,
    FundingPositionView, RepaymentForm,
  ],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance {
  private fin = inject(FinanceApi);
  private ops = inject(OpsApi);
  private confirm = inject(ConfirmService);
  private toast = inject(ToastService);
  private files = inject(AttachmentsApi);
  protected auth = inject(AuthService);

  private tick = signal(0);
  /** changes on every reload, so an open position drawer reads its data again */
  protected version = this.tick.asReadonly();
  protected entries = rxResource({ params: () => this.tick(), stream: () => this.fin.entries() });
  protected budgets = rxResource({ params: () => this.tick(), stream: () => this.fin.budgets() });
  /** the accounts a capital injection can come from: people, manufacturers and distributors */
  protected accounts = rxResource({ params: () => this.tick(), stream: () => this.fin.investorAccounts() });
  protected flows = rxResource({ params: () => this.tick(), stream: () => this.fin.cashFlows() });
  protected statement = rxResource({ params: () => this.tick(), stream: () => this.fin.incomeStatement('all') });
  protected orders = rxResource({ params: () => this.tick(), stream: () => this.ops.orders() });
  protected settings = rxResource({ params: () => this.tick(), stream: () => this.ops.settings() });

  protected canWrite = computed(() => this.auth.can('finance'));
  protected isAdmin = computed(() => this.auth.can('admin'));

  // form state
  protected entryOpen = signal(false);
  protected capitalOpen = signal(false);
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
  /** money put in by investors (an advance the company paid out to a partner is not capital) */
  private capitalEntries = computed(() => this.all().filter((e) => e.type === 'Capital Injection' && e.direction !== 'out'));

  /** loans and advances whose money is in the bank (or paid out): what is owed, repaid and used */
  protected loans = computed(() => this.all().filter((e) => e.type === 'Capital Injection' && e.liability && e.cleared));
  protected loanSummary = computed(() => {
    const sum = (rows: FinanceEntry[], f: (e: FinanceEntry) => number) => rows.reduce((n, e) => n + f(e), 0);
    const received = this.loans().filter((e) => e.direction !== 'out');
    const paidOut = this.loans().filter((e) => e.direction === 'out');
    return {
      funded: sum(received, (e) => Number(e.amount)), repaid: sum(received, (e) => e.repaid), outstanding: sum(received, (e) => e.outstanding),
      lent: sum(paidOut, (e) => Number(e.amount)), receivable: sum(paidOut, (e) => e.outstanding), used: sum(this.loans(), (e) => e.usedAmount),
    };
  });

  /** the fundings a spend can be paid from: capital in the bank, with what is left on each stream */
  protected fundingRooms = computed<FundingRoom[]>(() => {
    const all = this.all();
    const editing = this.editingEntry()?.id;
    return all
      .filter((e) => e.type === 'Capital Injection' && e.direction !== 'out' && e.cleared && e.streams.length)
      .map((e) => ({
        id: e.id,
        label: `${e.refNo} · ${e.party} · ${e.funding || 'Equity'}`,
        left: Object.fromEntries(e.streams.map((s) => [
          s.stream,
          Math.round((Number(s.amount) - all.filter((x) => x.fundedById === e.id && x.category === s.stream && x.id !== editing).reduce((n, x) => n + Number(x.amount), 0)) * 100) / 100,
        ])),
      }));
  });
  /** capital that is really in the bank: a cheque still waiting, or bounced, does not count */
  protected capital = computed(() =>
    this.capitalEntries().filter((e) => e.cleared).reduce((n, e) => n + Number(e.amount), 0));
  /** cheques given by investors that the bank has not cleared yet */
  protected cheques = computed(() => this.capitalEntries().filter((e) => e.chequeStatus === 'Pending'));
  protected chequeAmount = computed(() => this.cheques().reduce((n, e) => n + Number(e.amount), 0));

  /** capital by investor: what is in the bank, what is still a waiting cheque, and where it is invested */
  protected investors = computed<InvestorRow[]>(() => {
    const byName = new Map<string, InvestorRow & { streamTotals: Map<string, number> }>();
    for (const e of this.capitalEntries()) {
      if (e.chequeStatus === 'Bounced') continue;
      // an investor is one account; older entries without an account are told apart by name
      const key = e.partyId ?? e.party.trim().toLowerCase();
      const row = byName.get(key) ?? {
        name: e.party.trim(), kind: e.partyType, funding: '', injections: 0, invested: 0, awaiting: 0, share: 0, streams: '', nextReturn: null,
        streamTotals: new Map<string, number>(),
      };
      row.injections++;
      if (e.funding && !row.funding.split(' · ').includes(e.funding)) row.funding = row.funding ? `${row.funding} · ${e.funding}` : e.funding;
      if (e.cleared) {
        row.invested += Number(e.amount);
        for (const s of e.streams.length ? e.streams : [{ stream: e.category, amount: e.amount, pct: 100 }]) {
          row.streamTotals.set(s.stream, (row.streamTotals.get(s.stream) ?? 0) + Number(s.amount));
        }
        if (e.expectedReturnDate && (!row.nextReturn || e.expectedReturnDate < row.nextReturn)) row.nextReturn = e.expectedReturnDate;
      } else {
        row.awaiting += Number(e.amount);
      }
      byName.set(key, row);
    }
    const total = this.capital();
    return [...byName.values()]
      .map(({ streamTotals, ...r }) => ({
        ...r,
        share: total > 0 ? (r.invested / total) * 100 : 0,
        streams: [...streamTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => `${name} ${fmtMoney(amount)}`).join(' · '),
      }))
      .sort((a, b) => b.invested - a.invested || b.awaiting - a.awaiting);
  });
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
  /** the streams with their type, for the "invested against" lists */
  protected streamOptions = computed(() => (this.budgets.value() ?? []).map((b) => ({ name: b.name, type: b.streamType })));

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
      sub: (e) => (e.type === 'Capital Injection' ? [e.funding || 'Equity', e.paymentSource].filter(Boolean).join(' · ') : null),
    },
    {
      id: 'stream', label: 'Stream', value: (e) => e.category, priority: 3,
      sub: (e) => (e.streams.length > 1 ? e.streams.map((s) => `${s.stream} ${s.pct}%`).join(' · ') : null),
    },
    {
      id: 'party', label: 'Counterparty', value: (e) => e.party, priority: 2,
      sub: (e) => (e.coInvestors.length ? `With ${e.coInvestors.join(', ')}` : e.note),
    },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (e) => e.amount },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (e) => this.statusOf(e),
      tone: (e): Tone => ({ Approved: 'success', Pending: 'warning', 'Awaiting clearance': 'warning', Bounced: 'danger' } as Record<string, Tone>)[this.statusOf(e)] ?? 'neutral',
      priority: 2,
    },
  ];

  private statusOf(e: FinanceEntry) {
    if (e.chequeStatus === 'Pending') return 'Awaiting clearance';
    if (e.chequeStatus === 'Bounced') return 'Bounced';
    return e.approved ? 'Approved' : 'Pending';
  }

  protected entryActions = (e: FinanceEntry): RowAction[] => [
    ...(this.canWrite() && e.chequeStatus === 'Pending'
      ? [{ id: 'cheque-cleared', label: 'Mark cleared', tone: 'success' } as RowAction, { id: 'cheque-bounced', label: 'Bounced', tone: 'danger' } as RowAction]
      : []),
    ...(e.proof ? [{ id: 'proof', label: 'Proof', icon: 'download' } as RowAction] : []),
    ...(e.agreement ? [{ id: 'agreement', label: 'Agreement', icon: 'download' } as RowAction] : []),
    ...(this.canWrite() && !e.approved ? [{ id: 'edit', label: 'Edit' } as RowAction] : []),
  ];

  protected chequeColumns: TableColumn<FinanceEntry>[] = [
    { id: 'ref', label: 'Cheque', value: (e) => e.chequeNo, sub: (e) => e.refNo },
    { id: 'party', label: 'Investor', value: (e) => e.party, sub: (e) => e.paymentReference || null, priority: 2 },
    { id: 'amount', label: 'Amount (PKR)', kind: 'money', value: (e) => e.amount },
    {
      id: 'due', label: 'Clears on', kind: 'date', value: (e) => e.clearanceDate, priority: 2,
      sub: (e) => (e.clearanceDate && e.clearanceDate < today() ? 'Past due. Check with the bank' : null),
    },
  ];

  private loanStatus(e: FinanceEntry) {
    if (e.outstanding < 0.005) return 'Settled';
    if (e.expectedReturnDate && e.expectedReturnDate < today()) return 'Overdue';
    return e.repaid > 0 ? 'Part repaid' : 'Open';
  }

  protected loanColumns: TableColumn<FinanceEntry>[] = [
    { id: 'ref', label: 'Reference', value: (e) => e.refNo, sub: (e) => fmtDate(e.date) },
    { id: 'party', label: 'Account', value: (e) => e.party, sub: (e) => `${e.funding}${e.direction === 'out' ? ' paid out' : ''}` },
    { id: 'amount', label: 'Funding (PKR)', kind: 'money', value: (e) => e.amount },
    { id: 'repaid', label: 'Repaid (PKR)', kind: 'money', value: (e) => e.repaid, priority: 2 },
    { id: 'open', label: 'Outstanding (PKR)', kind: 'money', value: (e) => e.outstanding },
    { id: 'due', label: 'Due', kind: 'date', value: (e) => e.expectedReturnDate, priority: 3 },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (e) => this.loanStatus(e), priority: 2,
      tone: (e): Tone => ({ Settled: 'success', Overdue: 'danger', 'Part repaid': 'info', Open: 'warning' } as Record<string, Tone>)[this.loanStatus(e)] ?? 'neutral',
    },
  ];

  protected loanActions = (e: FinanceEntry): RowAction[] => [
    { id: 'position', label: 'Position' },
    ...(this.canWrite() ? [{ id: 'repay', label: 'Record payment', tone: 'success' } as RowAction] : []),
    ...(e.agreement ? [{ id: 'agreement', label: 'Agreement', icon: 'download' } as RowAction] : []),
  ];

  // loan position drawer and repayment form
  protected positionOpen = signal(false);
  protected positionId = signal<string | null>(null);
  protected repayOpen = signal(false);
  protected repayEntry = signal<FinanceEntry | null>(null);

  protected onLoanAction(e: RowActionEvent<FinanceEntry>) {
    if (e.id === 'position') {
      this.positionId.set(e.row.id);
      this.positionOpen.set(true);
    } else if (e.id === 'repay') {
      this.openRepay(e.row);
    } else if (e.id === 'agreement') {
      void this.onEntryAction(e);
    }
  }

  protected openRepay(entry: FinanceEntry) {
    this.repayEntry.set(entry);
    this.repayOpen.set(true);
  }

  protected investorColumns: TableColumn<InvestorRow>[] = [
    {
      id: 'name', label: 'Investor', value: (i) => i.name,
      sub: (i) => `${i.kind ? i.kind + ' · ' : ''}${i.injections} ${i.injections === 1 ? 'injection' : 'injections'}`,
    },
    { id: 'funding', label: 'Funding', value: (i) => i.funding || null, priority: 2 },
    { id: 'invested', label: 'In the bank (PKR)', kind: 'money', value: (i) => i.invested },
    { id: 'share', label: 'Share', kind: 'mono', value: (i) => fmtPct(i.share), sortValue: (i) => i.share, align: 'end', priority: 2 },
    { id: 'awaiting', label: 'Cheques waiting (PKR)', kind: 'money', value: (i) => i.awaiting, priority: 2 },
    { id: 'streams', label: 'Invested against', value: (i) => i.streams, priority: 3 },
    { id: 'return', label: 'Expected return', kind: 'date', value: (i) => i.nextReturn, priority: 3 },
  ];

  protected async onEntryAction(e: RowActionEvent<FinanceEntry>) {
    const entry = e.row;
    if (e.id === 'edit') return this.openEntry(entry);
    if (e.id === 'proof' || e.id === 'agreement') {
      const file = e.id === 'proof' ? entry.proof : entry.agreement;
      if (file) this.files.download(file).subscribe({ error: (err) => this.toast.error(errorText(err)) });
      return;
    }

    if (e.id === 'cheque-cleared' || e.id === 'cheque-bounced') {
      const cleared = e.id === 'cheque-cleared';
      const ok = await this.confirm.ask({
        title: cleared ? `Mark cheque ${entry.chequeNo} as cleared?` : `Mark cheque ${entry.chequeNo} as bounced?`,
        message: cleared
          ? `${fmtMoney(entry.amount)} from ${entry.party} will count as cash in the bank from today.`
          : `${fmtMoney(entry.amount)} from ${entry.party} will never count as capital. This cannot be undone.`,
        confirmLabel: cleared ? 'Mark cleared' : 'Mark bounced',
        tone: cleared ? undefined : 'danger',
      });
      if (!ok) return;
      this.fin.markCheque(entry.id, cleared ? 'Cleared' : 'Bounced').subscribe({
        next: () => { this.toast.success(cleared ? 'Cheque cleared. The money is now in cash.' : 'Cheque marked as bounced.'); this.reload(); },
        error: (err) => this.toast.error(errorText(err)),
      });
      return;
    }

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
