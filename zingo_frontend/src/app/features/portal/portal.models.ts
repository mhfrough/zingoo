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
  product: { sku: string; name: string };
  order: { refNo: string } | null;
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
export interface PortalRate {
  productId: string;
  sku: string;
  name: string;
  mrp: number;
  standardRate: number;
  rate: number;
  agreed: boolean;
  packsPerCarton: number;
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
}

export interface Attachment {
  name: string;
  mime: string;
  data: string;
}
