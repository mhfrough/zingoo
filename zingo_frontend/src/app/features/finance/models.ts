/**
 * Shapes returned by the finance, accounting and report endpoints.
 * Only the fields the Investment & Finance and Income & Expenses pages use.
 */

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
  note: string | null;
  funding: 'Equity' | 'Partner Loan' | '';
  /** seats that have signed, e.g. ['A', 'B'] */
  signatures: string[];
  requiredSignatures: number;
  needsApproval: boolean;
  approved: boolean;
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
