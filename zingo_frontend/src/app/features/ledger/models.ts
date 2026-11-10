/** Shapes returned by the General Ledger endpoints. */

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'COGS' | 'Expense';

export const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'COGS', 'Expense'];

/** One account of the chart of accounts. */
export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  active: boolean;
}

export interface TrialRow {
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  /** debit - credit */
  net: number;
}

export interface TrialBalance {
  accounts: TrialRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/** One ledger line with the running balance (debit - credit) of the account(s) up to that line. */
export interface LedgerLine {
  id: string;
  date: string;
  reference: string;
  source: string;
  description: string;
  accountCode: string;
  account: string;
  debit: number;
  credit: number;
  running: number;
}

export interface BalanceLine {
  code: string;
  name: string;
  balance: number;
}

export interface BalanceSheet {
  assets: BalanceLine[];
  liabilities: BalanceLine[];
  equity: BalanceLine[];
  revenue: number;
  expense: number;
  profit: number;
  totalAssets: number;
  totalLiabilities: number;
  /** equity accounts + current profit */
  totalEquity: number;
  /** assets - liabilities - equity - profit; zero when the books balance */
  difference: number;
}

export interface AgedRow {
  reference: string;
  type: string;
  party: string;
  dueDate: string;
  outstanding: number;
  daysOverdue: number;
  bucket: string;
  bucketIndex: number;
}

export interface Aged {
  asOf: string;
  total: number;
  buckets: { label: string; total: number }[];
  rows: AgedRow[];
}

export interface VoucherLine {
  account: string;
  debit: number;
  credit: number;
}

/** A manual journal voucher. A reversing voucher points back at the one it undoes. */
export interface Voucher {
  id: string;
  refNo: string;
  date: string;
  memo: string;
  currency: string;
  fxRate: number;
  status: string;
  reverses: string | null;
  lines: VoucherLine[];
}
