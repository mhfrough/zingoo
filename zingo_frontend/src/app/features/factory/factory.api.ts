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
  onHandContainers: number;
  onHandValue: number;
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
