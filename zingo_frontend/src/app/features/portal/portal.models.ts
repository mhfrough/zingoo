import { Distributor, Order } from '../ops/models';

/** Account position and open tasks at the top of the portal. */
export interface PortalProfile {
  distributor: Distributor;
  creditLimit: number;
  openBalance: number;
  overdue: number;
  availableCredit: number;
  pendingAdvices: number;
  pendingAdviceCount: number;
  toAcknowledge: number;
  acknowledged: number;
  advancesHeld: number;
  creditHeld: number;
  numberFormat: string;
  /** the earlier stock-request / sales-order flow is in use */
  salesOrdersEnabled?: boolean;
  requestsNeedApproval?: boolean;
  paymentMethods: string[];
  paymentCycles: number[];
}

/** An order with its delivery and payment progress. */
export interface PortalOrder extends Order {
  credited: number;
  portalStatus: 'Awaiting dispatch' | 'Paid' | 'Overdue' | 'Part paid' | 'Open';
  voucher: 'Invoice' | 'Pro-forma';
  receipt: { id: string; refNo: string; status: string } | null;
  /** money reported by the distributor and not yet verified */
  pendingAdvice: number;
  /** every payment against the order (advances and collections), oldest first */
  payments?: { date: string; refNo: string; amount: number; method: string; advance: boolean }[];
}

export interface PortalRequest {
  id: string;
  refNo: string;
  date: string;
  distributorId: string;
  productId: string;
  cartons: number;
  requestedDate: string | null;
  poRef: string | null;
  notes: string | null;
  status: 'Requested' | 'Accepted' | 'Rejected';
  reviewNote: string | null;
  product: { sku: string; name: string; containerUnit?: string | null };
  /** the order this line belongs to (DO-001) when several products were ordered together */
  groupRef?: string | null;
  containers?: number | null;
  packaging?: string | null;
  packetsPerBundle?: number | null;
  bundlesPerContainer?: number | null;
  transport?: OrderTransport | null;
  /** Carton, Bora: from the template picked, or changed on the order */
  containerUnit?: string | null;
  order: { refNo: string } | null;
  /** the production order the request became */
  productionOrder: {
    id: string; refNo: string; status: string; stage: string | null; readyDate: string | null; reason?: string | null;
    /** ready date plus the transit days of Settings */
    expectedDate?: string | null;
    containers?: number; shipped?: number; received?: number;
    manufacturer?: { name: string };
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

/** a distributor order already past the desk: Zen Foods watches it with the manufacturer */
export interface DeskOrder extends PortalRequest {
  distributor: { id: string; name: string };
}

export interface PortalReceipt {
  id: string;
  refNo: string;
  date: string;
  orderId: string;
  goodCartons: number;
  damagedCartons: number;
  missingCartons: number;
  condition: string;
  waybill: string | null;
  receivedBy: string | null;
  reason: string | null;
  evidence: string | null;
  hasEvidence: boolean;
  status: 'Accepted' | 'Disputed' | 'Approved' | 'Rejected';
  reviewNote: string | null;
  /** value of the damaged and missing bundles at the order's price */
  claimValue: number;
  order: { refNo: string };
  distributorName?: string;
}

export interface PortalAdvice {
  id: string;
  refNo: string;
  date: string;
  orderId: string;
  distributorId: string;
  amount: number;
  method: string;
  bankRef: string | null;
  proof: string | null;
  hasProof: boolean;
  status: 'Submitted' | 'Confirmed' | 'Rejected';
  isAdvance: boolean;
  note: string | null;
  reviewNote: string | null;
  order: { refNo: string };
  distributorName?: string;
}

/** A SKU with the distributor's price. */
/** planned transport given when ordering */
export interface OrderTransport {
  transporter?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverCnic?: string | null;
}

export interface PortalRate {
  manufacturerName?: string | null;
  /** the product has a manufacturer set up, so it can be ordered */
  orderable?: boolean;
  /** every manufacturer that can make it (names only); an order line may pick one, else the default */
  madeBy?: { id: string; name: string; isDefault: boolean }[];
  productId: string;
  sku: string;
  name: string;
  mrp: number;
  standardRate: number;
  rate: number;
  agreed: boolean;
  packsPerCarton: number;
  /** saved packaging templates: the order form picks one (figures can be changed per order) */
  packagings?: {
    name: string; piecesPerPacket?: number; packetsPerBundle: number; bundlesPerContainer: number; containerUnit?: string | null;
    containersPerTruck?: number | null; transportUnit?: string | null; isDefault: boolean;
  }[];
  bundlesPerContainer?: number;
  /** what a container is called (Carton, Bora) */
  containerUnit?: string | null;
  packetSize?: string | null;
  perCarton: number;
  spread: number;
  spreadPct: number;
}

export interface StatementEntry {
  date: string;
  kind: string;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementInvoice {
  orderId: string;
  refNo: string;
  voucher: string;
  sku: string;
  billed: number;
  collected: number;
  credited: number;
  outstanding: number;
}

export interface Statement {
  entries: StatementEntry[];
  invoices: StatementInvoice[];
  closing: number;
}

export interface DeskRequest extends PortalRequest {
  distributor: { name: string };
  product: {
    sku: string; name: string; bundlesPerContainer?: number; manufacturer?: { name: string } | null;
    packagings?: { name: string; isDefault?: boolean; bundlesPerContainer: number }[];
  };
  rate: number;
  value: number;
}

export interface AuditRow {
  id: string;
  event: string;
  reference: string | null;
  notes: string | null;
  by: string;
  createdAt: string;
}

/** Everything waiting for Zingoo staff. */
export interface Desk {
  requests: DeskRequest[];
  advices: PortalAdvice[];
  claims: PortalReceipt[];
  audit: AuditRow[];
  /** Settings: distributor orders wait here for Zingo approval */
  needsApproval: boolean;
  recent: DeskOrder[];
}

export interface Attachment {
  name: string;
  mime: string;
  data: string;
}

/** one distributor order (DO- number) and its money: amount owed, paid, balance, days since the goods arrived */
export interface OrderMoney {
  orderRef: string;
  date: string;
  products: string[];
  containers: number;
  receivedContainers: number;
  orderedValue: number;
  receivedValue: number;
  amount: number;
  paid: number;
  balance: number;
  receivedDate: string | null;
  creditDays: number;
  dueDate: string | null;
  daysSince: number | null;
  overdue: boolean;
  state: 'Acceptance pending' | 'In production' | 'Part received' | 'Received' | 'Cancelled';
}

/** one payment on an order, with the balance after it */
export interface OrderLedgerEntry {
  id: string | null;
  date: string;
  refNo: string;
  kind: string;
  method: string;
  reference: string | null;
  amount: number;
  status: 'Active' | 'Reversed';
  proofId: string | null;
  proofName: string | null;
  by: string | null;
  balance: number;
}

