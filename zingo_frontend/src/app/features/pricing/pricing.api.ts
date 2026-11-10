import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Distributor, Product } from '../ops/models';

/** The price per pack agreed with one distributor for one SKU. */
export interface AgreedRate {
  id: string;
  distributorId: string;
  productId: string;
  rate: number;
  distributor: Distributor;
  product: Product;
}

/** Calls of the Pricing & Margins page (products and settings come from OpsApi). */
@Injectable({ providedIn: 'root' })
export class PricingApi {
  private api = inject(ApiService);

  agreedRates = () => this.api.get<AgreedRate[]>('distributor-rates');
  /** one rate per distributor and SKU: creates it or changes the existing one */
  setRate = (body: { distributorId: string; productId: string; rate: number }) => this.api.put<AgreedRate>('distributor-rates', body);
  deleteRate = (id: string) => this.api.delete(`distributor-rates/${id}`);
  /** commercial rates of one SKU */
  saveRates = (productId: string, body: unknown) => this.api.patch<Product>(`products/${productId}`, body);
  updateSettings = (body: unknown) => this.api.patch('settings', body);
}
