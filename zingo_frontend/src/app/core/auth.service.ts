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
}

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'zg_token';
const USER_KEY = 'zg_user';

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

  logout() {
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
