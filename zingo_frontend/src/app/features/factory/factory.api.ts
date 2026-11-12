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
  side: 'Company' | 'Manufacturer';
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
  overdue: boolean;
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

/** Every call about production orders (company desk and factory portal). */
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
}

/** the tone of a status tag */
export const ORDER_TONE: Record<ProductionOrderStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  Draft: 'neutral', Sent: 'warning', Accepted: 'info', Rejected: 'danger', Cancelled: 'neutral',
};

/** "Accepted · In production" */
export const orderState = (o: ProductionOrder) => (o.status === 'Accepted' && o.stage ? o.stage : o.status === 'Sent' ? 'Waiting for answer' : o.status);
