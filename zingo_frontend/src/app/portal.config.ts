import { IconName } from './ui';

/**
 * The portal menu. Sidebar, routes and the "coming soon" pages are all built from this list.
 * `forms` / `tables` list what each page will contain (taken from the client's prototype).
 */
export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  group: 'Operations' | 'Money' | 'Trade' | 'Partners' | 'Admin';
  description: string;
  phase: number;
  forms: string[];
  tables: string[];
  /** page key in the server's role table, when it differs from `path` */
  page?: string;
}

export const NAV_GROUPS: NavItem['group'][] = ['Operations', 'Money', 'Trade', 'Partners', 'Admin'];

export const NAV: NavItem[] = [
  {
    path: 'overview', label: 'Overview', icon: 'dashboard', group: 'Operations', phase: 3,
    description: 'One view of factory output, capital, income, expenses and collections.',
    forms: ['Quick add: production batch, sales order, finance entry, income, expense'],
    tables: ['Operational alerts', 'Latest distributor orders'],
  },
  {
    path: 'manufacturing', label: 'Manufacturing', icon: 'factory', group: 'Operations', phase: 3,
    description: 'Record batches from the production partner, pass quality control and release bundles into stock.',
    forms: ['Product / SKU', 'Production batch', 'Pay manufacturer'],
    tables: ['Live SKU stock', 'Production batches', 'Manufacturer payables'],
  },
  {
    path: 'distribution', label: 'Distribution', icon: 'truck', group: 'Operations', phase: 3,
    description: 'Create sales orders, dispatch stock to distributors and record collections.',
    forms: ['Sales order', 'Dispatch order', 'Record collection', 'Distributor and trading profile'],
    tables: ['Sales order desk', 'Distributor directory', 'Collections journal'],
  },
  {
    path: 'finance', label: 'Investment & Finance', icon: 'landmark', group: 'Money', phase: 4,
    description: 'Capital, spend and the two-signature approval desk, against budgets per cost center.',
    forms: ['Finance entry', 'Budget allocation', 'Cost center', 'Capital target'],
    tables: ['Budgets by stream', 'Approval desk', 'Investment and paid spending'],
  },
  {
    path: 'accounting', label: 'Income & Expenses', icon: 'receipt', group: 'Money', phase: 4,
    description: 'Invoices, bills, partial settlements and a management profit-and-loss.',
    forms: ['Income invoice', 'Expense bill', 'Collect / pay a document'],
    tables: ['Income and expense documents', 'Receipts and bill payments', 'Open receivables', 'Bills to pay', 'Journal', 'Cash and bank book'],
  },
  {
    path: 'ledger', label: 'General Ledger', icon: 'book', group: 'Money', phase: 5,
    description: 'Trial balance, account ledgers, manual vouchers and ageing, all from one double-entry journal.',
    forms: ['Journal voucher (multi-line)', 'Chart of accounts entry'],
    tables: ['Trial balance', 'Chart of accounts', 'Account ledger', 'Vouchers', 'Aged receivables', 'Cash flows'],
  },
  {
    path: 'pricing', label: 'Pricing & Margins', icon: 'scale', group: 'Trade', phase: 5,
    description: 'Unit economics per SKU and the agreed rate for each distributor.',
    forms: ['Manufacturer and distributor commercial rates', 'Agreed SKU rate'],
    tables: ['Unit economics', 'Rate card per distributor', 'Manufacturers'],
  },
  {
    path: 'exports', label: 'Export Containers', icon: 'container', group: 'Trade', phase: 5,
    description: 'Export quotes by container and Incoterm, in foreign currency, with landed costs and FX gain or loss.',
    forms: ['Export quotation', 'Container costing', 'Collect export invoice', 'Pay export costs'],
    tables: ['Export shipments', 'Foreign receipts', 'Export cost payables'],
  },
  {
    path: 'partner-portal', page: 'portal', label: 'Distributor Self-Service', icon: 'handshake', group: 'Partners', phase: 7,
    description: 'What a distributor sees: requests, orders, cargo receipts, payments and statements.',
    forms: ['Replenishment request', 'Cargo receipt / proof of delivery', 'Payment advice', 'Damage claim review'],
    tables: ['My orders', 'Cargo and damage', 'Payments and credit', 'Agreed SKU rates', 'Statement'],
  },
  {
    path: 'factory-portal', page: 'factory', label: 'Manufacturer Portal', icon: 'factory', group: 'Partners', phase: 8,
    description: 'What a manufacturer sees: orders from Zen Foods to accept or reject, and the progress it reports.',
    forms: ['Accept order', 'Reject order', 'Report progress'],
    tables: ['Orders from Zen Foods', 'Payment details'],
  },
  {
    path: 'users', label: 'Users & Roles', icon: 'users', group: 'Admin', phase: 6,
    description: 'Who can read and change what, and who holds signing seat A or B.',
    forms: ['User', 'Assign distributor account'],
    tables: ['Users', 'Role access matrix'],
  },
  {
    path: 'settings', label: 'Settings & Data', icon: 'settings', group: 'Admin', phase: 6,
    description: 'Company assumptions, currencies, containers, categories and data export.',
    forms: ['Operating assumption', 'Currency', 'Container type', 'Manufacturer', 'Payment cycles', 'Income / expense category'],
    tables: ['Currencies', 'Container types', 'Manufacturers', 'Categories'],
  },
  {
    path: 'ui', page: 'users', label: 'Design system', icon: 'palette', group: 'Admin', phase: 1,
    description: 'Every building block of the portal in one place. Removed before launch.',
    forms: [],
    tables: [],
  },
];

/** The page key the server uses for a menu item. */
export const pageKey = (n: NavItem) => n.page ?? n.path;

/**
 * Menu items a role may open. `pages` comes from the login response (AuthService.user().pages);
 * without it (an old session) everything is shown and the server still refuses what is not allowed.
 */
export const visibleNav = (pages: string[] | undefined): NavItem[] =>
  pages ? NAV.filter((n) => pages.includes(pageKey(n))) : NAV;

/** The first page a role can open (where it lands after signing in): Overview for staff, its portal for a distributor or a manufacturer. */
export const homePath = (pages: string[] | undefined): string =>
  `/admin/${(pages ? NAV.find((n) => pages.includes(pageKey(n))) : NAV[0])?.path ?? 'overview'}`;
