import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Distributor, Manufacturer, Product } from '../ops/models';

/** Draft -> Sent -> Accepted or Rejected; the company can cancel a sent or accepted order. */
export type ProductionOrderStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Cancelled';

/** one line of an order's timeline */
export interface ProductionOrderEvent {
  id: string;
  createdAt: string;
  event: string;
  note: string | null;
  by: string;
  side: 'Company' | 'Manufacturer' | 'Distributor';
}

/** A production order as the API returns it, with its worked-out quantities and money. */
export interface ProductionOrder {
  id: string;
  refNo: string;
  date: string;
  productId: string;
  product: Product;
  manufacturerId: string;
  manufacturer: Manufacturer;
  destination: 'Distributor' | 'Warehouse';
  distributorId: string | null;
  distributor: Distributor | null;
  containers: number;
  /** the product's packaging template used (empty = its default at the time) */
  packaging?: string | null;
  bundlesPerContainer: number;
  packetsPerBundle: number;
  /** PKR per packet */
  rate: number;
  advancePct: number;
  dueDate: string | null;
  readyDate: string | null;
  status: ProductionOrderStatus;
  stage: string | null;
  reason: string | null;
  notes: string | null;
  events: ProductionOrderEvent[];
  bundles: number;
  packets: number;
  value: number;
  advanceAmount: number;
  /** containers sent so far, and how many arrived */
  shippedContainers: number;
  receivedContainers: number;
  overdue: boolean;
}

/** Containers sent against an order, and what arrived. */
/** faulty goods in a manufacturer's delivery: the distributor raises it, the manufacturer decides */
export interface DeliveryClaim {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  shipmentRef: string | null;
  orderId: string;
  sku: string | null;
  productName: string | null;
  manufacturerId: string;
  manufacturer: string | null;
  distributorId: string;
  distributor: string | null;
  kind: 'Damaged' | 'Missing' | 'Quality';
  bundles: number;
  value: number;
  note: string;
  hasEvidence: boolean;
  raisedBy: string;
  status: 'Pending' | 'Accepted' | 'Rejected';
  resolution: 'Credit' | 'Replace' | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedDate: string | null;
}

export interface Shipment {
  id: string;
  refNo: string;
  orderId: string;
  order: ProductionOrder;
  productId: string;
  product: Product;
  manufacturerId: string;
  manufacturer: Manufacturer;
  destination: 'Distributor' | 'Warehouse';
  distributorId: string | null;
  distributor: Distributor | null;
  shipDate: string;
  containers: number;
  bundlesPerContainer: number;
  packetsPerBundle: number;
  rate: number;
  vehicle: string | null;
  waybill: string | null;
  note: string | null;
  shippedBy: string;
  status: 'In transit' | 'Received';
  receivedDate: string | null;
  receivedContainers: number | null;
  receivedBy: string | null;
  receiptNote: string | null;
  selloutDays: number | null;
  sellBy: string | null;
  packets: number;
  value: number;
  receivedValue: number;
  /** containers already on a distributor invoice (not rejected) */
  soldContainers: number;
  onHandContainers: number;
  onHandValue: number;
  /** what the distributor is charged per packet (agreed rate, else the product's) */
  saleRate: number | null;
  daysLeft: number | null;
  overdue: boolean;
}

/** Zen Foods stock held by a distributor for one product */
export interface DistributorStockRow {
  productId: string;
  sku: string;
  name: string;
  distributor: string;
  containers: number;
  bundles: number;
  packets: number;
  value: number;
  nextSellBy: string | null;
  overdue: boolean;
}

/** containers of one delivery on a distributor invoice */
export interface DistInvoiceLine {
  id: string;
  shipmentId: string;
  productId: string;
  product: Product;
  containers: number;
  packets: number;
  rate: number;
  costRate: number;
  amount: number;
}

/** A distributor's sales invoice for containers it distributed. */
export interface DistInvoice {
  id: string;
  refNo: string;
  date: string;
  distributorId: string;
  distributor: Distributor;
  invoiceNo: string | null;
  amount: number;
  cost: number;
  margin: number;
  dueDate: string;
  status: 'Submitted' | 'Verified' | 'Rejected';
  note: string | null;
  reason: string | null;
  submittedBy: string;
  verifiedBy: string | null;
  lines: DistInvoiceLine[];
  payments: { id: string; refNo: string; date: string; amount: number; method: string }[];
  paid: number;
  due: number;
  containers: number;
  packets: number;
  overdue: boolean;
  /** "Waiting verification", "Open", "Part paid", "Paid", "Overdue", "Rejected" */
  state: string;
}

/** one delivery from shipment to cash */
export interface TrailRow {
  id: string;
  refNo: string;
  orderRef: string;
  sku: string;
  manufacturer: string;
  destination: 'Distributor' | 'Warehouse';
  distributor: string | null;
  shipDate: string;
  status: 'In transit' | 'Received';
  receivedDate: string | null;
  sellBy: string | null;
  overdue: boolean;
  shipped: number;
  received: number;
  sold: number;
  onHand: number;
  cost: number;
  sales: number;
  collected: number;
  receivable: number;
}

/** one line of a manufacturer's statement */
export interface StatementRow {
  date: string;
  kind: string;
  ref: string;
  description: string;
  owed: number;
  paid: number;
  balance: number;
}

/** the figures of each link of the business chain */
export interface ChainSummary {
  investors: { capital: number; investors: number };
  company: { cash: number };
  manufacturers: { openOrders: number; containersOnOrder: number; valueOnOrder: number; waiting: number; inTransit: number; advances: number; owed: number };
  distributors: { containersHeld: number; stockValue: number; overdueLots: number; toVerify: number };
  customers: { containersSold: number; invoiced: number; collected: number; receivable: number; margin: number };
}

export interface DistributorStock {
  lots: Shipment[];
  byProduct: DistributorStockRow[];
}

/** What the factory portal shows at the top: the manufacturer, its order counts and the production steps. */
export interface FactoryProfile {
  manufacturer: Manufacturer;
  waiting: number;
  inProduction: number;
  containersInProduction: number;
  valueInProduction: number;
  stages: string[];
}

/** the bank account a request asks to be paid at */
export interface RequestBank {
  bank: string;
  title: string;
  account: string;
  branch?: string;
}

/** one payment against a request */
export interface RequestPayment {
  id: string;
  refNo: string;
  date: string;
  amount: number;
  method: string;
  fromAccount: string | null;
  reference: string | null;
}

/** A manufacturer's payment request (advance or balance of an order), with approval and payments worked out. */
export interface PaymentRequest {
  id: string;
  refNo: string;
  date: string;
  orderId: string;
  order: ProductionOrder;
  manufacturerId: string;
  manufacturer: Manufacturer;
  kind: 'Advance' | 'Balance';
  amount: number;
  invoiceNo: string | null;
  bank: RequestBank;
  status: 'Submitted' | 'Rejected' | 'Withdrawn';
  note: string | null;
  reason: string | null;
  raisedBy: string;
  signatures: string[];
  requiredSignatures: number;
  approved: boolean;
  payments: RequestPayment[];
  paid: number;
  due: number;
  /** "Waiting approval (1/2)", "Approved", "Part paid", "Paid", "Rejected", "Withdrawn" */
  state: string;
}

/** what the company owes a manufacturer on one order */
export interface PositionRow {
  orderId: string;
  refNo: string;
  status: string;
  sku: string;
  manufacturer: string;
  value: number;
  advancePct: number;
  advance: number;
  requested: number;
  /** advance already asked for (not rejected or withdrawn) */
  advanceRequested: number;
  approved: number;
  paid: number;
  advancePaid: number;
  toPay: number;
}

export interface Position {
  rows: PositionRow[];
  totals: { value: number; advance: number; requested: number; approved: number; paid: number; toPay: number };
}

/** Every call about production orders and payment requests (company desk and factory portal). */
@Injectable({ providedIn: 'root' })
export class FactoryApi {
  private api = inject(ApiService);

  orders = (manufacturerId?: string) => this.api.get<ProductionOrder[]>('production-orders', { manufacturerId });
  profile = (manufacturerId?: string) => this.api.get<FactoryProfile>('production-orders/profile', { manufacturerId });
  save = (id: string | null, body: unknown) =>
    id ? this.api.patch<ProductionOrder>(`production-orders/${id}`, body) : this.api.post<ProductionOrder>('production-orders', body);
  remove = (id: string) => this.api.delete<unknown>(`production-orders/${id}`);
  send = (id: string) => this.api.post<ProductionOrder>(`production-orders/${id}/send`, {});
  cancel = (id: string, reason: string) => this.api.post<ProductionOrder>(`production-orders/${id}/cancel`, { reason });
  accept = (id: string, body: { readyDate?: string; note?: string }) => this.api.post<ProductionOrder>(`production-orders/${id}/accept`, body);
  reject = (id: string, reason: string) => this.api.post<ProductionOrder>(`production-orders/${id}/reject`, { reason });
  stage = (id: string, body: { stage: string; note?: string }) => this.api.post<ProductionOrder>(`production-orders/${id}/stage`, body);

  requests = (manufacturerId?: string) => this.api.get<PaymentRequest[]>('mfr-payment-requests', { manufacturerId });
  position = (manufacturerId?: string) => this.api.get<Position>('mfr-payment-requests/position', { manufacturerId });
  request = (body: unknown) => this.api.post<PaymentRequest>('mfr-payment-requests', body);
  withdraw = (id: string) => this.api.post<PaymentRequest>(`mfr-payment-requests/${id}/withdraw`, {});
  signRequest = (id: string, seat: 'A' | 'B') => this.api.post<PaymentRequest>(`mfr-payment-requests/${id}/sign`, { seat });
  rejectRequest = (id: string, reason: string) => this.api.post<PaymentRequest>(`mfr-payment-requests/${id}/reject`, { reason });
  payRequest = (id: string, body: unknown) => this.api.post<PaymentRequest>(`mfr-payment-requests/${id}/pay`, body);

  shipments = (filter: { distributorId?: string; manufacturerId?: string } = {}) => this.api.get<Shipment[]>('production-shipments', filter);
  stock = (distributorId?: string) => this.api.get<DistributorStock>('production-shipments/stock', { distributorId });
  ship = (body: unknown) => this.api.post<Shipment>('production-shipments', body);
  receive = (id: string, body: unknown) => this.api.post<Shipment>(`production-shipments/${id}/receive`, body);

  deliveryClaims = (filter: { distributorId?: string; manufacturerId?: string } = {}) => this.api.get<DeliveryClaim[]>('delivery-claims', filter);
  raiseClaim = (body: unknown) => this.api.post<DeliveryClaim>('delivery-claims', body);
  decideClaim = (id: string, body: unknown) => this.api.post<DeliveryClaim>(`delivery-claims/${id}/decide`, body);
  claimEvidence = (id: string) => this.api.get<{ name: string; mime: string; data: string }>(`delivery-claims/${id}/evidence`);

  trail = (distributorId?: string) => this.api.get<TrailRow[]>('production-shipments/trail', { distributorId });
  statement = (manufacturerId?: string) =>
    this.api.get<{ manufacturerId: string; entries: StatementRow[]; totals: { owed: number; paid: number; balance: number } }>('mfr-payment-requests/statement', { manufacturerId });
  chain = () => this.api.get<ChainSummary>('reports/chain');
  invoices = (distributorId?: string) => this.api.get<DistInvoice[]>('distributor-invoices', { distributorId });
  createInvoice = (body: unknown) => this.api.post<DistInvoice>('distributor-invoices', body);
  verifyInvoice = (id: string) => this.api.post<DistInvoice>(`distributor-invoices/${id}/verify`, {});
  rejectInvoice = (id: string, reason: string) => this.api.post<DistInvoice>(`distributor-invoices/${id}/reject`, { reason });
  payInvoice = (id: string, body: unknown) => this.api.post<DistInvoice>(`distributor-invoices/${id}/pay`, body);
}

/** the tone of a status tag */
export const ORDER_TONE: Record<ProductionOrderStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  Draft: 'neutral', Sent: 'warning', Accepted: 'info', Rejected: 'danger', Cancelled: 'neutral',
};

/** "Accepted · In production" */
export const orderState = (o: ProductionOrder) => {
  if (o.status === 'Accepted' && o.receivedContainers >= o.containers) return 'Delivered';
  if (o.status === 'Accepted' && o.shippedContainers > 0) return `Shipped ${o.shippedContainers}/${o.containers}`;
  return o.status === 'Accepted' && o.stage ? o.stage : o.status === 'Sent' ? 'Waiting for answer' : o.status;
};
