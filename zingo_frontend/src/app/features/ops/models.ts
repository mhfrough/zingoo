import { AttachmentMeta } from '../../core/attachments.api';
/** Shapes returned by the API (zingo_backend). Only the fields the pages use. */

/** one saved way of packing a product */
export interface PackagingTemplate {
  name: string;
  packetsPerBundle: number;
  bundlesPerContainer: number;
  isDefault: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  pack: number;
  mrp: number;
  rate: number;
  manufacturerRate: number;
  packagingRate: number;
  printingRate: number;
  inboundRate: number;
  /** weight of one packet in grams */
  gramsPerPacket?: number | null;
  /** saved packaging templates; the default one's figures are packsPerCarton / bundlesPerContainer */
  packagings?: PackagingTemplate[];
  /** every distributor that sells it; the first is distributorId */
  distributorIds?: string[];
  /** freight to the distributor, per packet */
  outboundRate?: number;
  /** packets per bundle */
  packsPerCarton: number;
  /** bundles per container (a container is one batch handed to a distributor) */
  bundlesPerContainer: number;
  flavour: string | null;
  packetSize: string | null;
  description: string | null;
  manufacturerId: string | null;
  manufacturer?: Manufacturer | null;
  distributorId: string | null;
  distributor?: Distributor | null;
  /** the product's own sell-out days; empty = the distributor's */
  selloutDays: number | null;
  currency: string;
  active: boolean;
  stockCartons?: number;
  /** packets per bundle x bundles per container */
  packetsPerContainer?: number;
  /** the sell-out days that apply: the product's own, else the distributor's */
  effectiveSelloutDays?: number | null;
}

/** one bank account of a manufacturer */
export interface PartnerBankAccount {
  bank: string;
  title: string;
  /** account number or IBAN */
  account: string;
  branch?: string;
  isDefault: boolean;
}

export interface Manufacturer {
  id: string;
  name: string;
  /** how it is paid: an advance on each order, a credit line, or both */
  paymentTerms?: ('Advance' | 'Credit line')[];
  /** credit line: days to clear after delivery (0 = no limit) */
  paymentDays: number;
  /** credit line: most Zen Foods may owe, in its currency (0 = no limit) */
  creditLimit?: number;
  /** advance on each order, % of its value */
  advancePct?: number;
  bankAccounts?: PartnerBankAccount[];
  currency: string;
  contact: string | null;
  /** point of contact */
  poc?: string | null;
  contract?: string | null;
  terms?: string | null;
  files?: AttachmentMeta[];
}

export interface Distributor {
  id: string;
  name: string;
  /** a short territory label for lists (first city, else district, province or country) */
  region: string;
  /** Pakistan, abroad, or both */
  market?: 'Local' | 'International' | 'Both';
  provinces?: string[];
  districts?: { name: string; province: string }[];
  cities?: { name: string; province: string; district?: string | null }[];
  countries?: string[];
  /** no other distributor may be given these areas */
  exclusive?: boolean;
  status?: 'Active' | 'Hold' | 'Temporary suspend' | 'Permanent suspend';
  statusNote?: string | null;
  statusUntil?: string | null;
  // international distributor (the client's spec)
  /** INT-DST-0001 */
  code?: string | null;
  legalName?: string | null;
  website?: string | null;
  classification?: string | null;
  /** country of registration */
  country?: string | null;
  registrationNo?: string | null;
  registrationAuthority?: string | null;
  registrationExpiry?: string | null;
  taxTreatment?: string | null;
  licenceNo?: string | null;
  licenceAuthority?: string | null;
  licenceIssued?: string | null;
  licenceExpiry?: string | null;
  accountManager?: string | null;
  salesTeam?: string | null;
  salesChannel?: string | null;
  contacts?: { name: string; role?: string; email?: string; phoneCode?: string; mobile?: string; whatsapp?: string; isPrimary: boolean }[];
  addresses?: { type: 'Registered' | 'Billing' | 'Warehouse' | 'Consignee' | 'Delivery'; line: string; city?: string; region?: string; postalCode?: string; country: string; isDefault: boolean }[];
  kycDocs?: { type: string; file: { id: string; name: string; mime: string; size: number }; expiry?: string | null }[];
  agreementStart?: string | null;
  agreementEnd?: string | null;
  renewalNoticeDays?: number | null;
  noticePeriodDays?: number | null;
  agreementVersion?: string | null;
  agreementStatus?: 'Draft' | 'Under review' | 'Signed' | 'Expired' | 'Terminated';
  agreementFile?: { id: string; name: string; mime: string; size: number } | null;
  moq?: string | null;
  quarterlyTarget?: number;
  annualTarget?: number;
  approvedProductIds?: string[];
  /** Draft, Documents submitted, Under review, Approved, Active, On hold, Suspended, Archived */
  registrationStatus?: string;
  /** earlier fields, kept for older records */
  province?: string | null;
  areas?: string[];
  contact: string | null;
  address: string | null;
  taxNo: string | null;
  paymentDays: number;
  creditLimit: number;
  advancePct: number;
  /** days to sell one container out, unless a product says otherwise */
  selloutDays?: number;
  /** point of contact */
  poc?: string | null;
  contract?: string | null;
  terms?: string | null;
  files?: AttachmentMeta[];
}

export interface Batch {
  id: string;
  refNo: string;
  date: string;
  productId: string;
  manufacturerId: string;
  targetCartons: number;
  producedCartons: number;
  cost: number;
  qc: 'Pending' | 'Passed' | 'Failed';
  status: 'Planned' | 'Released';
  notes: string | null;
  product: Product;
  manufacturer: Manufacturer;
  paid: number;
  due: number;
}

export interface Order {
  id: string;
  refNo: string;
  date: string;
  dispatchDate: string | null;
  distributorId: string;
  productId: string;
  cartons: number;
  rate: number;
  status: 'Draft' | 'Dispatched';
  dueDate: string;
  paymentTermsDays: number;
  poRef: string | null;
  notes: string | null;
  creditOverride: boolean;
  creditOverrideNote: string | null;
  distributor: Distributor;
  product: Product;
  billed: number;
  collected: number;
  outstanding: number;
  creditLimit: number;
  projectedExposure: number | null;
  creditHold: boolean;
}

export interface CollectionRow {
  id: string;
  refNo: string;
  date: string;
  orderId: string;
  amount: number;
  method: string;
  note: string | null;
  order: { refNo: string; distributor: { name: string } };
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  pack: number;
  cartons: number;
  packs: number;
  low: boolean;
  active: boolean;
}

export interface Alert {
  kind: 'approval' | 'stock' | 'order' | 'batch' | 'cheque' | 'return' | 'production' | 'payment' | 'delivery' | 'sellout' | 'invoice' | 'receivable';
  page: string;
  title: string;
  text: string;
}

export interface Dashboard {
  cash: number;
  stockCartons: number;
  stockPacks: number;
  netProfit: number;
  openReceivables: number;
  payables: number;
  capitalRaised: number;
  capitalTarget: number;
  pendingApprovals: number;
  alerts: Alert[];
  latestOrders: { id: string; refNo: string; date: string; distributor: string; sku: string; cartons: number; value: number; status: string }[];
}

/** Company settings the pages read (the full record has more fields). */
export interface Settings {
  /** packets per bundle, default for a new SKU */
  packsPerCarton: number;
  /** bundles per container, default for a new SKU */
  bundlesPerContainer?: number;
  /** sell-out days, default for a new distributor */
  defaultSelloutDays?: number;
  /** manufacturer advance %, default for a new manufacturer */
  defaultAdvancePct?: number;
  /** the earlier sales-order flow (warehouse dispatch, invoice at dispatch) is shown */
  salesOrdersEnabled?: boolean;
  lowStockCartons: number;
  paymentCycles: number[];
  defaultPaymentCycle: number;
  /** spend at or above this needs two signatures */
  approvalThreshold: number;
  /** total capital the business intends to raise */
  capitalTarget: number;
  signatoryA: string;
  signatoryB: string;
  /** overhead share charged to every pack when judging margin (PKR per pack) */
  profitAllocationPerPack: number;
  /** default container type for export quotes */
  containerSize: string;
  /** default Incoterm for export quotes */
  defaultIncoterm: string;
  companyName: string;
  baseCurrency: string;
  /** month the financial year starts (1-12) */
  fiscalMonth: number;
  /** locale for numbers and amounts, e.g. en-PK */
  numberFormat: string;
  salesTaxRate: number;
  /** reference prefixes: sales, batch, finance, accounting, export */
  docPrefixes: Record<string, string>;
  /** upper day limits of the aged-receivable buckets */
  agingBuckets: number[];
}

export const PAY_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Other'] as const;
export const QC_OPTIONS = ['Pending', 'Passed', 'Failed'] as const;
