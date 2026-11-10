import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import {
  Attachment, Desk, PortalAdvice, PortalOrder, PortalProfile, PortalRate, PortalReceipt, PortalRequest, Statement,
} from './portal.models';

/**
 * Every call the partner portal makes. A distributor login always sees its own distributor, so it passes nothing;
 * staff pass the distributor they are looking at.
 */
@Injectable({ providedIn: 'root' })
export class PortalApi {
  private api = inject(ApiService);

  profile = (d?: string) => this.api.get<PortalProfile>('portal/profile', { distributorId: d });
  orders = (d?: string) => this.api.get<PortalOrder[]>('portal/orders', { distributorId: d });
  requests = (d?: string) => this.api.get<PortalRequest[]>('portal/requests', { distributorId: d });
  receipts = (d?: string) => this.api.get<PortalReceipt[]>('portal/receipts', { distributorId: d });
  advices = (d?: string) => this.api.get<PortalAdvice[]>('portal/advices', { distributorId: d });
  rates = (d?: string) => this.api.get<PortalRate[]>('portal/rates', { distributorId: d });
  statement = (d?: string) => this.api.get<Statement>('portal/statement', { distributorId: d });
  desk = () => this.api.get<Desk>('portal/desk');
  evidence = (id: string) => this.api.get<Attachment>(`portal/receipts/${id}/evidence`);
  proof = (id: string) => this.api.get<Attachment>(`portal/advices/${id}/proof`);

  createRequest = (body: unknown) => this.api.post('portal/requests', body);
  createReceipt = (body: unknown) => this.api.post('portal/receipts', body);
  createAdvice = (body: unknown) => this.api.post('portal/advices', body);

  acceptRequest = (id: string, body: unknown) => this.api.post(`portal/requests/${id}/accept`, body);
  rejectRequest = (id: string, note: string) => this.api.post(`portal/requests/${id}/reject`, { note });
  approveClaim = (id: string) => this.api.post(`portal/receipts/${id}/approve`, {});
  rejectClaim = (id: string, note: string) => this.api.post(`portal/receipts/${id}/reject`, { note });
  confirmAdvice = (id: string) => this.api.post(`portal/advices/${id}/confirm`, {});
  rejectAdvice = (id: string, note: string) => this.api.post(`portal/advices/${id}/reject`, { note });
}
