import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import {
  Batch, CollectionRow, Dashboard, Distributor, Manufacturer, Order, Product, Settings, StockRow,
} from './models';

/** Every call the Overview, Manufacturing and Distribution pages make. */
@Injectable({ providedIn: 'root' })
export class OpsApi {
  private api = inject(ApiService);

  // reads
  dashboard = () => this.api.get<Dashboard>('reports/dashboard');
  stock = () => this.api.get<StockRow[]>('reports/stock');
  settings = () => this.api.get<Settings>('settings');
  products = () => this.api.get<Product[]>('products');
  manufacturers = () => this.api.get<Manufacturer[]>('manufacturers');
  distributors = () => this.api.get<Distributor[]>('distributors');
  batches = () => this.api.get<Batch[]>('batches');
  orders = () => this.api.get<Order[]>('orders');
  collections = () => this.api.get<CollectionRow[]>('collections');

  // products
  saveProduct = (id: string | null, body: unknown) =>
    id ? this.api.patch<Product>(`products/${id}`, body) : this.api.post<Product>('products', body);

  // batches
  saveBatch = (id: string | null, body: unknown) =>
    id ? this.api.patch<Batch>(`batches/${id}`, body) : this.api.post<Batch>('batches', body);
  deleteBatch = (id: string) => this.api.delete(`batches/${id}`);
  releaseBatch = (id: string) => this.api.post<Batch>(`batches/${id}/release`, {});
  payManufacturer = (body: unknown) => this.api.post('manufacturer-payments', body);

  // distributors
  saveDistributor = (id: string | null, body: unknown) =>
    id ? this.api.patch<Distributor>(`distributors/${id}`, body) : this.api.post<Distributor>('distributors', body);

  // orders
  saveOrder = (id: string | null, body: unknown) =>
    id ? this.api.patch<Order>(`orders/${id}`, body) : this.api.post<Order>('orders', body);
  deleteOrder = (id: string) => this.api.delete(`orders/${id}`);
  dispatchOrder = (id: string) => this.api.post<Order>(`orders/${id}/dispatch`, {});
  creditOverride = (id: string, reason: string) => this.api.post<Order>(`orders/${id}/credit-override`, { reason });
  collect = (body: unknown) => this.api.post('collections', body);
}
