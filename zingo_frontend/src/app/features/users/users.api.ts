import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';

/** A login as the users screen sees it (never the password). */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  seat: 'None' | 'A' | 'B' | 'Both';
  status: 'Active' | 'Disabled';
  isRoot: boolean;
  distributorId: string | null;
  distributorName: string | null;
  manufacturerId?: string | null;
  manufacturerName?: string | null;
}

/** Which page each role can open and which kind of change it can make. */
export interface AccessMatrix {
  pages: Record<string, string[]>;
  writes: Record<string, string[]>;
}

export const ROLE_LIST = ['Admin', 'Manufacturing', 'Finance', 'Distribution', 'Exports', 'Viewer', 'Investor', 'Distributor', 'Manufacturer'] as const;

/** Every call the Users & Roles page makes. */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private api = inject(ApiService);

  list = () => this.api.get<UserRow[]>('users');
  access = () => this.api.get<AccessMatrix>('users/access');
  create = (body: unknown) => this.api.post<UserRow>('users', body);
  update = (id: string, body: unknown) => this.api.patch<UserRow>(`users/${id}`, body);
  resetPassword = (id: string, password: string) => this.api.post(`users/${id}/reset-password`, { password });
}
