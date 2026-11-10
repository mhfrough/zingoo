// Fixed lists from the client's prototype. Stored as plain varchar, validated with @IsIn(...).
// Adding a value later needs no migration.

export const ROLES = ['Admin', 'Manufacturing', 'Finance', 'Distribution', 'Exports', 'Viewer', 'Distributor'] as const;
export type Role = (typeof ROLES)[number];

/** Approval seat: A / B = the two signatories, Both = can sign as either. */
export const SEATS = ['None', 'A', 'B', 'Both'] as const;
export type Seat = (typeof SEATS)[number];

export const USER_STATUS = ['Active', 'Disabled'] as const;
export const QC_STATUS = ['Pending', 'Passed', 'Failed'] as const;
export const BATCH_STATUS = ['Planned', 'Released'] as const;
export const ORDER_STATUS = ['Draft', 'Dispatched'] as const;
export const FINANCE_TYPES = ['Capital Injection', 'Operating Expense', 'Asset Purchase', 'Other Receipt'] as const;
export const FUNDING = ['Equity', 'Partner Loan', ''] as const;
export const PAY_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Other'] as const;
export const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'COGS', 'Expense'] as const;
export const DOC_KINDS = ['Income', 'Expense'] as const;
export const CATEGORY_KINDS = ['COST_CENTER', 'INCOME', 'EXPENSE'] as const;
export const INCOTERMS = ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as const;
export const EXPORT_STATUS = ['Quote', 'Shipped'] as const;

/** What a ledger line came from (used to replace the lines when the document changes). */
export type RefType =
  | 'BATCH' | 'MFR_PAYMENT' | 'ORDER' | 'COLLECTION' | 'FINANCE' | 'ACC_DOC' | 'ACC_SETTLEMENT'
  | 'EXPORT' | 'EXPORT_RECEIPT' | 'EXPORT_COST' | 'VOUCHER' | 'CREDIT_NOTE';

export type JournalSource =
  | 'Manufacturing' | 'Distribution' | 'Investment' | 'Accounting' | 'Exports' | 'Manual Voucher' | 'Distributor Portal';
