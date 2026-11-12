import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { WriteGroup, canWrite } from './access';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** signing seat: A, B, Both or None */
  seat?: string;
  /** pages this role may open (from the server) */
  pages?: string[];
  isRoot?: boolean;
  /** an Admin switched into this login (their own session is kept to switch back) */
  viewAs?: boolean;
  /** a Distributor login: its distributor; a Manufacturer login: its manufacturer */
  distributorId?: string | null;
  manufacturerId?: string | null;
}

/** a login an Admin can preview the app as */
export interface ViewAsOption {
  id: string;
  name: string;
  email: string;
  role: string;
  distributorName: string | null;
  manufacturerName?: string | null;
}

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'zg_token';
const USER_KEY = 'zg_user';
/** the Admin's own session, kept while previewing another login */
const OWN_TOKEN_KEY = 'zg_own_token';
const OWN_USER_KEY = 'zg_own_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<AuthUser | null>(this.loadUser());

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  /** can the signed-in user change data in this area? (the server still checks) */
  can(group: WriteGroup): boolean {
    return canWrite(this.user()?.role, group);
  }

  login(email: string, password: string) {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap((res) => {
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        this.user.set(res.user);
      }),
    );
  }

  /** the logins and roles an Admin can switch to */
  viewAsOptions() {
    return this.http.get<{ users: ViewAsOption[]; roles: string[] }>(`${environment.apiUrl}/auth/view-as`);
  }

  /** switch to another login (by id) or to a role ("role:Investor", made when missing) without signing in again */
  viewAs(target: string) {
    const url = target.startsWith('role:') ? `auth/switch-role/${target.slice(5)}` : `auth/view-as/${target}`;
    return this.http.post<LoginResponse>(`${environment.apiUrl}/${url}`, {}).pipe(
      tap((res) => {
        if (!localStorage.getItem(OWN_TOKEN_KEY)) {
          localStorage.setItem(OWN_TOKEN_KEY, this.token ?? '');
          localStorage.setItem(OWN_USER_KEY, localStorage.getItem(USER_KEY) ?? '');
        }
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        this.user.set(res.user);
      }),
    );
  }

  /** back to the Admin's own view */
  backToOwn() {
    const token = localStorage.getItem(OWN_TOKEN_KEY);
    const user = localStorage.getItem(OWN_USER_KEY);
    localStorage.removeItem(OWN_TOKEN_KEY);
    localStorage.removeItem(OWN_USER_KEY);
    if (!token || !user) return this.logout();
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, user);
    this.user.set(this.loadUser());
  }

  logout() {
    localStorage.removeItem(OWN_TOKEN_KEY);
    localStorage.removeItem(OWN_USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    this.router.navigate(['/admin/login']);
  }

  private loadUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
