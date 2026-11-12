/** Starting configuration, taken from the client prototype. */

export const DEFAULT_SETTINGS = {
  companyName: 'Zen Foods (Pvt.) Ltd.',
  baseCurrency: 'PKR',
  fiscalMonth: 7,
  numberFormat: 'en-PK',
  capitalTarget: 8000000,
  packsPerCarton: 432,
  bundlesPerContainer: 10,
  defaultSelloutDays: 30,
  defaultAdvancePct: 30,
  approvalThreshold: 50000,
  signatoryA: 'Signatory A (Arittek)',
  signatoryB: 'Signatory B (BCP)',
  lowStockCartons: 12,
  containerSize: '40HC',
  defaultIncoterm: 'FOB',
  salesTaxRate: 0,
  profitAllocationPerPack: 0,
  paymentCycles: [15, 30, 45, 60],
  defaultPaymentCycle: 30,
  docPrefixes: { sales: 'SO', batch: 'B', finance: 'FIN', accounting: 'ACC', export: 'EXP', production: 'MO', mfrRequest: 'PR', mfrPayment: 'MPY' },
  agingBuckets: [30, 60, 90],
};

export const CURRENCIES = [
  { code: 'PKR', name: 'Pakistan Rupee', rate: 1, symbol: 'Rs' },
  { code: 'USD', name: 'US Dollar', rate: 280, symbol: '$' },
  { code: 'AED', name: 'UAE Dirham', rate: 76.25, symbol: 'AED' },
  { code: 'EUR', name: 'Euro', rate: 325, symbol: '€' },
  { code: 'GBP', name: 'Pound Sterling', rate: 370, symbol: '£' },
  { code: 'CNY', name: 'Chinese Yuan', rate: 39.3, symbol: '¥' },
];

export const CONTAINER_TYPES = [
  { code: '20GP', maxCartons: 1000 },
  { code: '40GP', maxCartons: 2000 },
  { code: '40HC', maxCartons: 2400 },
];

export const COST_CENTERS: Record<string, number> = {
  Marketing: 650000,
  Manufacturing: 1100000,
  Exports: 500000,
  Printing: 400000,
  Packaging: 700000,
  Other: 200000,
};

export const INCOME_CATEGORIES = ['Other Sales', 'Exports', 'Services', 'Other Income'];

export const EXPENSE_CATEGORIES = [
  'Marketing', 'Manufacturing', 'Exports', 'Printing', 'Packaging', 'Salaries', 'Rent', 'Utilities',
  'Transport', 'Administration', 'Other', 'Taxes & Duties', 'Interest & Bank Fees', 'Depreciation',
  'Wastage & Write-offs', 'Selling Discounts',
];

type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'COGS' | 'Expense';

/** [code, name, type] - the chart of accounts the prototype starts with. */
export const STARTER_ACCOUNTS: [string, string, AccountType][] = [
  ['1000', 'Cash & Bank', 'Asset'], ['1100', 'Accounts Receivable', 'Asset'], ['1200', 'Inventory · Estimated', 'Asset'],
  ['1300', 'Fixed Assets', 'Asset'], ['1400', 'Prepaid Expenses', 'Asset'], ['1450', 'Advance to Manufacturer', 'Asset'], ['1500', 'FX Clearing', 'Asset'],
  ['2000', 'Accounts Payable', 'Liability'], ['2050', 'Production Cost Clearing', 'Liability'],
  ['2100', 'Manufacturer Payable', 'Liability'], ['2150', 'Customer Advances', 'Liability'],
  ['2160', 'Distributor Credit Payable', 'Liability'], ['2200', 'Export Costs Payable', 'Liability'],
  ['2300', 'Partner Loans', 'Liability'], ['2400', 'Sales Tax Payable', 'Liability'], ['2410', 'Withholding Tax Payable', 'Liability'],
  ['3000', 'Owner Equity', 'Equity'], ['3100', 'Opening Balance Equity', 'Equity'],
  ['4000', 'Sales Revenue', 'Revenue'], ['4010', 'Sales Returns & Allowances', 'Revenue'],
  ['4100', 'Export Sales Revenue', 'Revenue'], ['4200', 'Other Income', 'Revenue'], ['4300', 'FX Gain', 'Revenue'],
  ['5000', 'Cost of Goods Sold', 'COGS'], ['5100', 'Export Logistics Expense', 'Expense'], ['5200', 'FX Loss', 'Expense'],
  ['5300', 'Tax Expense', 'Expense'], ['5400', 'Depreciation Expense', 'Expense'],
  ...EXPENSE_CATEGORIES.map((c, i): [string, string, AccountType] => [String(6000 + i * 10), `Expense · ${c}`, 'Expense']),
  ...INCOME_CATEGORIES.map((c, i): [string, string, AccountType] => [String(4500 + i * 10), `Income · ${c}`, 'Revenue']),
];

/**
 * Starting capital sources. Equity is owner money; a loan or an advance is money to pay back (a liability).
 * "Partner Loan" is the older name: kept switched off so earlier entries stay valid. Editable on Settings & Data.
 */
export const CAPITAL_SOURCE_DEFAULTS: { code: string; description: string; liability: boolean; advance: boolean; active: boolean }[] = [
  { code: 'Equity', description: 'Owner or shareholder capital', liability: false, advance: false, active: true },
  { code: 'Shareholder Loan', description: 'A shareholder lends money to the company', liability: true, advance: false, active: true },
  { code: 'Partner Advance', description: 'A partner advances money', liability: true, advance: true, active: true },
  { code: 'Partner Loan', description: 'Earlier name, kept for existing entries', liability: true, advance: false, active: false },
];

/**
 * Starting entries of the simple pick-lists behind the loan and advance forms (the client prototype's choices),
 * plus the company's bank and cash accounts. Every one is editable on Settings & Data.
 */
export const SIMPLE_LIST_DEFAULTS: Record<'LOAN_TENURE' | 'REPAY_PLAN' | 'REPAY_FREQUENCY' | 'ADVANCE_PURPOSE' | 'SETTLEMENT_METHOD' | 'BANK_ACCOUNT' | 'DELIVERY_STATUS' | 'BILL_TYPE' | 'BILL_TREATMENT' | 'APPROVER' | 'FLAVOUR' | 'PACKET_SIZE' | 'BANK' | 'ORDER_STAGE', string[]> = {
  LOAN_TENURE: ['Short-term (up to 12 months)', 'Long-term (over 12 months)', 'On demand'],
  REPAY_PLAN: ['Lump sum', 'Installments', 'On demand'],
  REPAY_FREQUENCY: ['Monthly', 'Quarterly', 'Half-yearly', 'Custom'],
  ADVANCE_PURPOSE: ['Operational funding', 'Procurement', 'Expense float', 'Marketing / promotion', 'Distribution', 'Other'],
  SETTLEMENT_METHOD: ['Cash repayment', 'Expense adjustment', 'Invoice settlement', 'Mixed / partial'],
  BANK_ACCOUNT: ['Zen Foods Bank Account', 'Cash in Hand', 'Manufacturing Account', 'Distribution Account'],
  DELIVERY_STATUS: ['Not dispatched', 'Dispatched', 'Delivered', 'Accepted by customer', 'Partly returned', 'Returned'],
  BILL_TYPE: ['Supplier / Manufacturing', 'Internal Expense', 'Marketing Expense', 'Operating Expense', 'Distribution Expense', 'Export Expense', 'Asset Purchase', 'Prepaid Expense'],
  BILL_TREATMENT: ['Operating expense', 'Inventory / stock', 'Fixed asset', 'Prepaid expense'],
  APPROVER: ['Zeeshan', 'Ahsan', 'Mudassir', 'Mansoor', 'Joint Approval'],
  // the client's sample flavours (prototype SKUs) and packet weights; illustrative, editable
  FLAVOUR: ['Masala Masti', 'Ketchup Tango'],
  PACKET_SIZE: ['Rs 10 pack', 'Rs 20 pack'],
  // the steps a manufacturer reports while it works on an order, in order; editable
  ORDER_STAGE: ['Preparation', 'In production', 'Quality check', 'Ready to ship'],
  // banks a partner can be paid at; editable
  BANK: ['HBL', 'Meezan Bank', 'UBL', 'MCB Bank', 'Allied Bank', 'Bank Alfalah', 'Bank Al Habib', 'Faysal Bank', 'Standard Chartered', 'National Bank of Pakistan'],
};

/** Starting types of investment stream. A depreciable type carries a depreciation rate. Editable on Settings & Data. */
export const STREAM_TYPE_DEFAULTS: { code: string; description: string; depreciable: boolean }[] = [
  { code: 'Fixed Asset', description: 'Long-life equipment and property that lose value over time', depreciable: true },
  { code: 'Movable Asset', description: 'Assets that can be moved or resold', depreciable: false },
  { code: 'Operation Cost', description: 'Running costs of the business', depreciable: false },
];

/** Starting payment methods. Editable on Settings & Data. */
export const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Other'];

/**
 * Starting Incoterms with the cost lines the seller carries (the client prototype's rules).
 * Bank charges and other costs are always the seller's, so they are not listed. Editable on Settings & Data.
 */
export const INCOTERM_DEFAULTS: { code: string; description: string; flags: Record<string, boolean> }[] = [
  { code: 'EXW', description: 'Buyer organizes most of the carriage', flags: { origin: false, ocean: false, insurance: false, destination: false, duty: false } },
  { code: 'FOB', description: 'Seller delivers the goods on board the vessel and pays the origin costs', flags: { origin: true, ocean: false, insurance: false, destination: false, duty: false } },
  { code: 'CFR', description: 'Seller also pays the ocean freight', flags: { origin: true, ocean: true, insurance: false, destination: false, duty: false } },
  { code: 'CIF', description: 'Seller also pays the ocean freight and the marine insurance', flags: { origin: true, ocean: true, insurance: true, destination: false, duty: false } },
  { code: 'DAP', description: 'Seller delivers to the named place, import duty not included', flags: { origin: true, ocean: true, insurance: true, destination: true, duty: false } },
  { code: 'DDP', description: 'Seller delivers with import duty and import clearance paid', flags: { origin: true, ocean: true, insurance: true, destination: true, duty: true } },
];
