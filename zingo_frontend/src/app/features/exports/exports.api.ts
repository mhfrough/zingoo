import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ContainerType, DistributorAccount, ExportCostPayment, ExportReceipt, ExportRow } from './models';

/** Every call the Export Containers page makes (products, currencies and settings come from OpsApi / FinanceApi). */
@Injectable({ providedIn: 'root' })
export class ExportsApi {
  private api = inject(ApiService);

  list = () => this.api.get<ExportRow[]>('exports');
  receipts = () => this.api.get<ExportReceipt[]>('exports/receipts');
  costPayments = () => this.api.get<ExportCostPayment[]>('exports/cost-payments');
  containerTypes = () => this.api.get<ContainerType[]>('container-types');

  save = (id: string | null, body: unknown) =>
    id ? this.api.patch<ExportRow>(`exports/${id}`, body) : this.api.post<ExportRow>('exports', body);
  remove = (id: string) => this.api.delete(`exports/${id}`);
  ship = (id: string) => this.api.post<ExportRow>(`exports/${id}/ship`, {});
  collect = (id: string, body: unknown) => this.api.post<ExportRow>(`exports/${id}/collect`, body);
  payCosts = (id: string, body: unknown) => this.api.post<ExportRow>(`exports/${id}/pay-costs`, body);
  creditOverride = (id: string, reason: string) => this.api.post<ExportRow>(`exports/${id}/credit-override`, { reason });
  account = (distributorId: string) => this.api.get<DistributorAccount>(`distributors/${distributorId}/account`);
  remit = (distributorId: string, body: unknown) => this.api.post<DistributorAccount>(`distributors/${distributorId}/remittances`, body);
  allocate = (distributorId: string, remittanceId: string, body: unknown) =>
    this.api.post<DistributorAccount>(`distributors/${distributorId}/remittances/${remittanceId}/allocate`, body);
}
