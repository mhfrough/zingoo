import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

/** Thin wrapper over HttpClient. The auth token is added by the interceptor. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get<T>(path: string, query: Record<string, string | undefined> = {}) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) if (v) params = params.set(k, v);
    return this.http.get<T>(`${this.base}/${path}`, { params });
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(`${this.base}/${path}`, body);
  }

  patch<T>(path: string, body: unknown) {
    return this.http.patch<T>(`${this.base}/${path}`, body);
  }

  delete<T>(path: string) {
    return this.http.delete<T>(`${this.base}/${path}`);
  }
}
