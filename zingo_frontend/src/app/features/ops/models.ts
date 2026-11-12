import { AttachmentMeta } from '../../core/attachments.api';
/** Shapes returned by the API (zingo_backend). Only the fields the pages use. */

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

export interface Manufacturer {
  id: string;
  name: string;
  paymentDays: number;
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
  region: string;
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
  kind: 'approval' | 'stock' | 'order' | 'batch' | 'cheque' | 'return';
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
