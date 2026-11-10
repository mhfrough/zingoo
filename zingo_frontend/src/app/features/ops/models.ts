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
  packsPerCarton: number;
  currency: string;
  active: boolean;
  stockCartons?: number;
}

export interface Manufacturer {
  id: string;
  name: string;
  paymentDays: number;
  currency: string;
  contact: string | null;
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
  kind: 'approval' | 'stock' | 'order' | 'batch';
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

export interface Settings {
  packsPerCarton: number;
  lowStockCartons: number;
  paymentCycles: number[];
  defaultPaymentCycle: number;
  approvalThreshold: number;
}

export const PAY_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Other'] as const;
export const QC_OPTIONS = ['Pending', 'Passed', 'Failed'] as const;
