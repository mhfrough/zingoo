/** Shapes returned by the export container endpoints. */

export interface ContainerType {
  code: string;
  maxCartons: number;
}

/** What the seller carries, in the invoice currency. */
export interface ShipmentCosts {
  origin: number;
  ocean: number;
  insurance: number;
  destination: number;
  fees: number;
  extras: number;
  seller: number;
}

/** A container quote or shipment with its costing, what was collected and what is still due. */
export interface ExportRow {
  id: string;
  refNo: string;
  date: string;
  shipDate: string | null;
  buyer: string;
  country: string;
  port: string | null;
  container: string;
  incoterm: string;
  productId: string;
  product: { id: string; sku: string; name: string };
  cartons: number;
  currency: string;
  /** PKR per 1 unit of the invoice currency */
  fxRate: number;
  /** selling price per pack, in the invoice currency */
  rate: number;
  inland: number;
  origin: number;
  documentation: number;
  ocean: number;
  insurance: number;
  destination: number;
  duty: number;
  bankFees: number;
  otherCosts: number;
  status: 'Quote' | 'Shipped';
  packsPerCarton: number;
  unitCost: number;
  revenueForeign: number;
  revenuePKR: number;
  cogs: number;
  costs: ShipmentCosts;
  sellerCostPKR: number;
  net: number;
  grossProfit: number;
  margin: number;
  fobEquivalent: number;
  /** foreign money received so far */
  collected: number;
  /** foreign money still to receive */
  due: number;
  costPaid: number;
  costDue: number;
  /** the international distributor the order is for (older quotes only have a buyer name) */
  distributorId?: string | null;
  distributor?: { id: string; name: string; code: string | null } | null;
  /** the price-list version the rate came from */
  priceId?: string | null;
  paymentDays?: number | null;
  dueDate?: string | null;
  overdue?: boolean;
  creditOverrideBy?: string | null;
  creditOverrideReason?: string | null;
  creditOverrideAt?: string | null;
  /** what the credit check said when it shipped */
  creditNote?: string | null;
}

/** an international distributor's credit position, in its credit currency */
export interface CreditPosition {
  currency: string;
  limit: number;
  outstanding: number;
  unapplied: number;
  exposure: number;
  available: number;
  overdue: number;
  expired: boolean;
  control: 'Block' | 'Warn';
  problems: string[];
}

/** money an international distributor sent, and how it was applied */
export interface Remittance {
  id: string;
  refNo: string;
  date: string;
  currency: string;
  amount: number;
  fees: number;
  fxRate: number;
  method: string;
  bankRef: string | null;
  fromBank: string | null;
  note: string | null;
  by: string;
  applied: number;
  unapplied: number;
  allocations: { refNo: string; shipment: string; amount: number }[];
}

/** GET /distributors/:id/account */
export interface DistributorAccount {
  distributor: {
    id: string; name: string; code: string | null; registrationStatus: string; invoiceCurrency: string | null; paymentDays: number;
    paymentTermType: string | null; settlementMethods: string[];
    bankAccounts: { index: number; label: string; verified: boolean; currency: string | null }[];
  };
  credit: CreditPosition;
  agingLabels: string[];
  currencies: {
    currency: string; invoiced: number; collected: number; open: number; overdue: number; unapplied: number; aging: number[];
    openPKR: number; unappliedPKR: number; balance: number;
  }[];
  orders: ExportRow[];
  remittances: Remittance[];
  statement: { date: string; ref: string; text: string; currency: string; debit: number; credit: number; balance: number }[];
}

/** Foreign-currency money received for a shipment. */
export interface ExportReceipt {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  foreignAmount: number;
  fxRate: number;
  method: string;
  note: string | null;
  shipment: { refNo: string; currency: string; buyer: string; fxRate: number };
}

/** PKR paid for the seller-side logistics costs of a shipment. */
export interface ExportCostPayment {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  amount: number;
  method: string;
  note: string | null;
  shipment: { refNo: string; buyer: string };
}
