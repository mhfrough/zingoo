import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { environment } from '../../../environments/environment';
import { saveBlob } from '../../shared/files';
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
  /** PKR per packet: baseRate + packagingFee + printingFee */
  rate: number;
  /** the manufacturer's own rate before packaging and printing (empty on older orders) */
  baseRate?: number | null;
  packagingFee?: number;
  printingFee?: number;
  piecesPerPacket?: number;
  containersPerTruck?: number | null;
  transportUnit?: string | null;
  /** staff only: what the distributor pays per packet, in total, and the margin over the manufacturer's price */
  saleRate?: number;
  saleValue?: number;
  margin?: number;
  advancePct: number;
  dueDate: string | null;
  readyDate: string | null;
  status: ProductionOrderStatus;
  stage: string | null;
  reason: string | null;
  notes: string | null;
  /** the distributor order it belongs to (DO-001) when several products were ordered together */
  groupRef?: string | null;
  /** Carton, Bora: from the packaging template, or changed on the order (empty on old orders: the product's) */
  containerUnit?: string | null;
  /** containers the factory made ready and loaded, and containers damaged in production (set at dispatch) */
  readyContainers?: number | null;
  productionDamaged?: number | null;
  /** planned transport given when ordering */
  transport?: { transporter?: string | null; vehicleNo?: string | null; driverName?: string | null; driverPhone?: string | null; driverCnic?: string | null } | null;
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

/** one load that left the factory on an order (delivered by the manufacturer or collected), for the order panel */
export interface OrderLoad {
  id: string;
  refNo: string;
  orderId?: string;
  driverName?: string | null;
  driverPhone?: string | null;
  transporter?: string | null;
  /** loads of one dispatch (several products on one vehicle) share it */
  dispatchRef?: string | null;
  shipDate: string;
  containers: number;
  method: 'Delivery' | 'Pickup';
  status: string;
  vehicle: string | null;
  waybill: string | null;
  note: string | null;
  shippedBy: string;
  receivedDate: string | null;
  receivedContainers: number | null;
  receivedBy: string | null;
  receiptNote: string | null;
  bundlesPerContainer: number;
  packetsPerBundle: number;
}

/** a claim raised on one of the order's loads (value hidden from a distributor login) */
export interface OrderClaim {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  kind: 'Damaged' | 'Missing' | 'Quality';
  bundles: number;
  value?: number;
  note: string;
  hasEvidence: boolean;
  raisedBy: string;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Hold';
  resolution: 'Credit' | 'Replace' | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedDate: string | null;
}

/** a file on an order: the signed dispatch voucher, the manufacturer's invoice copy, or another document */
export interface OrderDoc {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'CHALLAN' | 'INVOICE' | 'OTHER' | 'HANDOVER';
  uploadedBy: string;
  createdAt: string;
}

/** the manufacturer's payment invoice on an order (not shown to the distributor) */
export interface OrderInvoice {
  id: string;
  refNo: string;
  kind: 'Advance' | 'Balance';
  amount: number;
  paid: number;
  date: string;
  dueDate: string | null;
  status: 'Submitted' | 'Rejected' | 'Withdrawn';
  invoiceNo: string | null;
  invoiceFileId: string | null;
  banks: RequestBank[];
}

/** GET production-orders/:id/detail: one order in full (money fields absent for a distributor login) */
export interface OrderDetailData {
  order: ProductionOrder;
  /** the advance the distributor paid with its order (never sent to the manufacturer) */
  distAdvance?: { amount: number; method: string; date: string; reference: string | null; proofId: string; proofName: string } | null;
  /** every product of the combined order (just the one order when it is a single-product order) */
  lines: ProductionOrder[];
  /** ready date plus the transit days of Settings */
  expectedDate: string | null;
  transitDays: number;
  documents: OrderDoc[];
  invoices: OrderInvoice[];
  stages: string[];
  ready: boolean;
  shipments: OrderLoad[];
  claims: OrderClaim[];
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
  /** the order the claim is on: its DO- number, or the production order number */
  orderRef?: string | null;
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
  /** Hold: the manufacturer's manager parked it; it can still be accepted or rejected */
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Hold';
  resolution: 'Credit' | 'Replace' | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedDate: string | null;
  /** raised at the factory gate on a pickup that has not arrived yet */
  atGate?: boolean;
  /** photos / PDFs backing the claim */
  proofs?: { id: string; name: string; mime: string; size: number }[];
  /** the messages between the distributor, the manufacturer and Zen Foods */
  thread?: { id: string; text: string; by: string; side: 'Distributor' | 'Manufacturer' | 'Company'; createdAt: string }[];
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
  /** recorded at Ready to Dispatch */
  driverName?: string | null;
  driverPhone?: string | null;
  transporter?: string | null;
  /** the loads of one dispatch (several products on one vehicle) share it */
  dispatchRef?: string | null;
  note: string | null;
  shippedBy: string;
  /** Delivery = the manufacturer sent it; Pickup = the distributor collected it from the factory */
  method?: 'Delivery' | 'Pickup';
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
  /** bundles on a faulty-goods claim that was not rejected */
  claimedBundles?: number;
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
  /** part of `paid` that came from the distributor's order payments (advance and Pay) */
  fromOrders?: number;
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
  /** every account printed on the invoice; the first is `bank` */
  banks?: RequestBank[];
  dueDate?: string | null;
  invoiceFileId?: string | null;
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

/** an order on its way to a distributor that has not fully left the factory */
export interface IncomingOrder {
  id: string;
  refNo: string;
  date: string;
  status: 'Sent' | 'Accepted';
  stage: string | null;
  readyDate: string | null;
  dueDate: string | null;
  product: { id: string; sku: string; name: string; containerUnit?: string | null };
  manufacturer: { id: string; name: string };
  distributor: { id: string; name: string } | null;
  groupRef?: string | null;
  transport?: ProductionOrder['transport'];
  containerUnit?: string | null;
  containers: number;
  shippedContainers: number;
  left: number;
  bundlesPerContainer: number;
  packetsPerBundle: number;
  /** the manufacturer reported the last production step: the distributor may collect it */
  ready: boolean;
  /** ready date plus the transit days of Settings */
  expectedDate?: string | null;
}

/** bundles a distributor sent to one of its customers */
export interface DistDispatch {
  id: string;
  refNo: string;
  date: string;
  distributorId: string;
  distributor: { name: string };
  shipmentId: string;
  shipment: { refNo: string };
  productId: string;
  product: { sku: string; name: string };
  bundles: number;
  customer: string;
  area: string | null;
  vehicle: string | null;
  note: string | null;
  dispatchedBy: string;
  status: 'Dispatched' | 'Delivered' | 'Returned';
  closedDate: string | null;
  closedNote: string | null;
  closedBy: string | null;
}

/** Every call about production orders and payment requests (company desk and factory portal). */
@Injectable({ providedIn: 'root' })
export class FactoryApi {
  private api = inject(ApiService);
  private http = inject(HttpClient);

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
  detail = (id: string) => this.api.get<OrderDetailData>(`production-orders/${id}/detail`);
  /** answer or progress every product of a combined order at once */
  acceptGroup = (ids: string[], body: { readyDate?: string; note?: string }) => this.api.post<ProductionOrder[]>('production-orders/group/accept', { ids, ...body });
  rejectGroup = (ids: string[], reason: string) => this.api.post<ProductionOrder[]>('production-orders/group/reject', { ids, reason });
  stageGroup = (ids: string[], body: { stage: string; note?: string }) => this.api.post<ProductionOrder[]>('production-orders/group/stage', { ids, ...body });
  /** Ready to Dispatch: quantities, vehicle, driver and the proof of handover for a whole order */
  dispatchOrder = (body: unknown) => this.api.post<{ dispatchRef: string; loads: number }>('production-shipments/dispatch', body);
  /** attach a file to an order (CHALLAN = signed dispatch voucher, INVOICE = the manufacturer's own invoice copy) */
  addOrderDoc = (id: string, file: File, kind: OrderDoc['kind']) => {
    const body = new FormData();
    body.append('kind', kind);
    body.append('file', file, file.name);
    return this.api.post<OrderDoc>(`production-orders/${id}/documents`, body);
  };
  removeOrderDoc = (id: string, docId: string) => this.api.delete<unknown>(`production-orders/${id}/documents/${docId}`);
  /** fetches a file of an order with the login token and saves it */
  downloadOrderDoc = (id: string, doc: Pick<OrderDoc, 'id' | 'name'>) =>
    this.http.get(`${environment.apiUrl}/production-orders/${id}/documents/${doc.id}`, { responseType: 'blob' }).pipe(tap((b) => saveBlob(doc.name, b)));

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
  /** receive a whole dispatch: accept it, or report damage on arrival (opens a dispute) */
  receiveDispatch = (body: unknown) => this.api.post<{ dispatchRef: string; claims: number }>('production-shipments/receive-dispatch', body);
  incoming = (distributorId?: string) => this.api.get<IncomingOrder[]>('production-shipments/incoming', { distributorId });
  pickup = (body: unknown) => this.api.post<Shipment>('production-shipments/pickup', body);

  dispatches = (distributorId?: string) => this.api.get<DistDispatch[]>('distributor-dispatches', { distributorId });
  dispatch = (body: unknown) => this.api.post<DistDispatch>('distributor-dispatches', body);
  closeDispatch = (id: string, body: unknown) => this.api.post<DistDispatch>(`distributor-dispatches/${id}/close`, body);

  deliveryClaims = (filter: { distributorId?: string; manufacturerId?: string } = {}) => this.api.get<DeliveryClaim[]>('delivery-claims', filter);
  raiseClaim = (body: unknown) => this.api.post<DeliveryClaim>('delivery-claims', body);
  decideClaim = (id: string, body: unknown) => this.api.post<DeliveryClaim>(`delivery-claims/${id}/decide`, body);
  addClaimNote = (id: string, text: string) => this.api.post<DeliveryClaim>(`delivery-claims/${id}/notes`, { text });
  downloadClaimProof = (id: string, f: { id: string; name: string }) =>
    this.http.get(`${environment.apiUrl}/delivery-claims/${id}/proofs/${f.id}`, { responseType: 'blob' }).pipe(tap((b) => saveBlob(f.name, b)));
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

/**
 * A combined order: the production orders of one distributor order (DO- number) and one manufacturer, shown and
 * answered as one. The row is the first of them; `group` holds all (one entry for a single-product order).
 */
export type OrderRow = ProductionOrder & { group: ProductionOrder[] };

/** the key of the combined order a production order belongs to */
export const groupKey = (o: { id: string; groupRef?: string | null; manufacturerId?: string; manufacturer?: { id?: string } }) =>
  (o.groupRef ? `${o.groupRef}|${o.manufacturerId ?? o.manufacturer?.id ?? ''}` : o.id);

/** one row per combined order, newest first as the list came */
export function groupOrders(list: ProductionOrder[]): OrderRow[] {
  const map = new Map<string, ProductionOrder[]>();
  for (const o of list) map.set(groupKey(o), [...(map.get(groupKey(o)) ?? []), o]);
  return [...map.values()].map((g) => {
    const sorted = [...g].sort((a, b) => a.refNo.localeCompare(b.refNo));
    return { ...sorted[0], group: sorted };
  });
}

/** totals of a combined order */
export function groupTotals(row: OrderRow) {
  const sum = (f: (o: ProductionOrder) => number) => row.group.reduce((n, o) => n + (f(o) || 0), 0);
  return {
    containers: sum((o) => o.containers), bundles: sum((o) => o.bundles), packets: sum((o) => o.packets),
    value: sum((o) => o.value), advance: sum((o) => o.advanceAmount), shipped: sum((o) => o.shippedContainers), received: sum((o) => o.receivedContainers),
    // staff only: what the distributor pays (inflow) and the margin over the manufacturer's price (outflow = value)
    inflow: row.group.some((o) => typeof o.saleValue === 'number') ? sum((o) => o.saleValue ?? 0) : null,
    margin: row.group.some((o) => typeof o.margin === 'number') ? sum((o) => o.margin ?? 0) : null,
  };
}

/** "DO-001" for a combined order, else the production order number */
export const orderRef = (row: Pick<ProductionOrder, 'refNo' | 'groupRef'> & { group?: unknown[] }) =>
  (row.groupRef && (row.group?.length ?? 1) > 0 ? row.groupRef : row.refNo);

/** "Accepted · In production" */
export const orderState = (o: ProductionOrder) => {
  if (o.status === 'Accepted' && o.receivedContainers >= o.containers) return 'Delivered';
  // dispatched at Ready to Dispatch: everything that was ready left the factory
  if (o.status === 'Accepted' && o.readyContainers != null && o.shippedContainers >= o.readyContainers) return o.receivedContainers > 0 ? `Received ${o.receivedContainers}` : 'Dispatched';
  if (o.status === 'Accepted' && o.shippedContainers > 0) return `Shipped ${o.shippedContainers}/${o.containers}`;
  return o.status === 'Accepted' && o.stage ? o.stage : o.status === 'Sent' ? 'Acceptance pending' : o.status;
};
