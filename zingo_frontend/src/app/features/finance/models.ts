/**
 * Shapes returned by the finance, accounting and report endpoints.
 * Only the fields the Investment & Finance and Income & Expenses pages use.
 */

import type { AttachmentMeta } from '../../core/attachments.api';

export type FinanceType = 'Capital Injection' | 'Operating Expense' | 'Asset Purchase' | 'Other Receipt';

/** A capital, spend or receipt entry, with its signature state. */
export interface FinanceEntry {
  id: string;
  refNo: string;
  date: string;
  type: FinanceType;
  /** cost center / investment stream */
  category: string;
  amount: number;
  party: string;
  /** capital only: which kind of account the investor is; empty on older entries */
  partyType: InvestorType | '';
  /** capital only: the investor's account (a person, a manufacturer or a distributor) */
  partyId: string | null;
  note: string | null;
  /** capital only: the type of funding, a capital source from Settings (Equity, Shareholder Loan, Partner Advance ...) */
  funding: string;
  /** seats that have signed, e.g. ['A', 'B'] */
  signatures: string[];
  requiredSignatures: number;
  needsApproval: boolean;
  approved: boolean;

  // ── capital injection details (empty for other types) ──
  /** shared by every investor of one shared investment */
  groupId: string | null;
  /** the other investors in the same shared investment */
  coInvestors: string[];
  paymentSource: string;
  paymentReference: string;
  paymentAgainst: string;
  paidBy: string;
  receivedBy: string;
  issueDate: string | null;
  expectedReturnDate: string | null;
  chequeNo: string;
  clearanceDate: string | null;
  chequeStatus: ChequeStatus;
  /** true when the money is in the bank: not a cheque that is still waiting, or bounced */
  cleared: boolean;
  /** what the investment is invested against, biggest first */
  streams: StreamShare[];
  proof: AttachmentMeta | null;
  agreement: AttachmentMeta | null;
}

export type ChequeStatus = '' | 'Pending' | 'Cleared' | 'Bounced';

/** The kinds of account that can put money in. */
export type InvestorType = 'Person' | 'Manufacturer' | 'Distributor';

/** An account that can put money in: a person (Settings), a contract manufacturer or a distributor. */
export interface InvestorAccount {
  type: InvestorType;
  id: string;
  name: string;
  /** the person's role, the manufacturer's contact or the distributor's region */
  note: string;
}

/** The part of an investor's amount invested against one stream. */
export interface StreamShare {
  stream: string;
  amount: number;
  /** share of that investor's amount, 0 to 100 */
  pct: number;
}

/** An income invoice or an expense bill, with what has been settled so far. */
export interface AccountingDoc {
  id: string;
  refNo: string;
  date: string;
  kind: 'Income' | 'Expense';
  category: string;
  /** amount in PKR */
  amount: number;
  foreignAmount: number | null;
  currency: string;
  fxRate: number;
  party: string;
  dueDate: string | null;
  note: string | null;
  paid: number;
  due: number;
  status: string;
  signatures: string[];
  requiredSignatures: number;
  needsApproval: boolean;
  approved: boolean;
}

/** A (part) collection or payment against an accounting document. */
export interface Settlement {
  id: string;
  refNo: string;
  date: string;
  documentId: string;
  amount: number;
  method: string;
  note: string | null;
  document: { refNo: string; kind: 'Income' | 'Expense'; party: string };
}

/** Budget, spend and percentage used for one cost center. */
export interface Budget {
  id: string;
  name: string;
  budget: number;
  spent: number;
  usedPct: number;
  /** type of investment stream from Settings (Fixed Asset, Operation Cost ...), empty when not set */
  streamType: string;
  /** percent of value lost per year, for a depreciable type */
  depreciationRate: number;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  rate: number;
}

/** Management profit and loss for a period ('all' or 'YYYY-MM'). */
export interface IncomeStatement {
  period: string;
  sales: number;
  other: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  income: Record<string, number>;
  expenses: Record<string, number>;
}

export interface FlowLine {
  label: string;
  amount: number;
}

/** Cash in and out by source; `net` equals the cash balance. */
export interface CashFlows {
  inflows: FlowLine[];
  outflows: FlowLine[];
  cashIn: number;
  cashOut: number;
  net: number;
}

export interface JournalLine {
  id: string;
  date: string;
  source: string;
  reference: string;
  description: string;
  accountCode: string;
  account: string;
  debit: number;
  credit: number;
}

export interface CashBookRow {
  id: string;
  date: string;
  reference: string;
  description: string;
  source: string;
  cashIn: number;
  cashOut: number;
  balance: number;
}

/** One open invoice (receivable) or bill (payable). */
export interface OpenItem {
  reference: string;
  type: string;
  party: string;
  date?: string;
  dueDate: string;
  outstanding: number;
}

export interface OpenItems {
  total: number;
  rows: OpenItem[];
}

export interface CategoryRow {
  id: string;
  kind: 'COST_CENTER' | 'INCOME' | 'EXPENSE';
  name: string;
  budget: number;
}
