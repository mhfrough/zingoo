import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Manufacturer } from '../ops/models';

/** Every change Settings & Data makes. Reads come from SettingsStore, OpsApi and FinanceApi. */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private api = inject(ApiService);

  // assumptions
  updateSettings = (body: unknown) => this.api.patch('settings', body);

  // pick-lists (payment methods, Incoterms)
  addLookup = (body: unknown) => this.api.post('lookups', body);
  updateLookup = (id: string, body: unknown) => this.api.patch(`lookups/${id}`, body);

  // currencies and containers
  addCurrency = (body: unknown) => this.api.post('currencies', body);
  updateCurrency = (code: string, body: unknown) => this.api.patch(`currencies/${code}`, body);
  deleteCurrency = (code: string) => this.api.delete(`currencies/${code}`);
  addContainer = (body: unknown) => this.api.post('container-types', body);
  updateContainer = (code: string, body: unknown) => this.api.patch(`container-types/${code}`, body);
  deleteContainer = (code: string) => this.api.delete(`container-types/${code}`);

  // categories (income and expense; cost centers are created from the finance form)
  addCategory = (body: unknown) => this.api.post('categories', body);
  renameCategory = (id: string, name: string) => this.api.patch(`categories/${id}`, { name });
  deleteCategory = (id: string) => this.api.delete(`categories/${id}`);

  // manufacturers
  saveManufacturer = (id: string | null, body: unknown) =>
    id ? this.api.patch<Manufacturer>(`manufacturers/${id}`, body) : this.api.post<Manufacturer>('manufacturers', body);
}
