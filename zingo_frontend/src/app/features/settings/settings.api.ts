import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Manufacturer } from '../ops/models';

/** A company of the group; exactly one is primary. */
export interface Company {
  id: string;
  name: string;
  legalName: string;
  taxNo: string;
  address: string;
  phone: string;
  email: string;
  poc: string;
  fiscalMonth: number;
  market: 'Local' | 'International';
  region: string;
  country: string;
  state: string;
  city: string;
  currency: string;
  approvalThreshold: number | null;
  signatoryA: string;
  signatoryB: string;
  capitalTarget: number | null;
  logoId: string | null;
  primary: boolean;
  active: boolean;
}

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
  currencyRates = (code: string) => this.api.get<{ id: string; rate: number; source: string; effectiveOn: string; by: string }[]>(`currencies/${code}/rates`);
  addContainer = (body: unknown) => this.api.post('container-types', body);
  updateContainer = (code: string, body: unknown) => this.api.patch(`container-types/${code}`, body);
  deleteContainer = (code: string) => this.api.delete(`container-types/${code}`);

  // categories (income and expense; cost centers are created from the finance form)
  addCategory = (body: unknown) => this.api.post('categories', body);
  renameCategory = (id: string, name: string) => this.api.patch(`categories/${id}`, { name });
  deleteCategory = (id: string) => this.api.delete(`categories/${id}`);

  // companies
  companies = () => this.api.get<Company[]>('companies');
  saveCompany = (id: string | null, body: unknown) =>
    id ? this.api.patch<Company>(`companies/${id}`, body) : this.api.post<Company>('companies', body);
  deleteCompany = (id: string) => this.api.delete(`companies/${id}`);
  /** super admin: any company, the primary one too; or every company at once */
  deleteCompanyAsSuperAdmin = (id: string) => this.api.delete(`platform/companies/${id}`);
  deleteAllCompanies = () => this.api.post<{ deleted: number }>('platform/companies/delete-all', { confirm: 'DELETE' });

  // the platform (super admin)
  updatePlatform = (body: unknown) => this.api.patch('platform', body);
  clearBusinessData = () => this.api.post<{ removed: Record<string, number>; usersKept: number }>('platform/clear-data', { confirm: 'DELETE' });

  // manufacturers
  saveManufacturer = (id: string | null, body: unknown) =>
    id ? this.api.patch<Manufacturer>(`manufacturers/${id}`, body) : this.api.post<Manufacturer>('manufacturers', body);
}
