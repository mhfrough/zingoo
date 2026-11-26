import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { environment } from '../../environments/environment';
import { richToPlain } from '../ui/rich-text';
import { setVoucherBrand } from '../shared/print';
import { logoUrl } from './attachments.api';
import { AuthService } from './auth.service';

/** the platform's own details (Settings > Zingo), fixed data only the super admin changes */
export interface PlatformInfo {
  name: string;
  tagline?: string;
  logoId?: string;
  logoName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxNo?: string;
}

/** who is signed in, for the sidebar: their company, distributor or manufacturer */
export interface Identity {
  kind: 'company' | 'distributor' | 'manufacturer' | 'platform';
  name: string;
  sub: string | null;
  logoId: string | null;
  role: string;
  /** the primary company, which issues the documents (null when there is none) */
  issuer: { name: string; logoId: string | null } | null;
}

/**
 * The platform (Zingoo) details and the signed-in party. The platform details load before login (the login page shows
 * them); the identity loads after sign-in. Both also feed the browser title and the printed vouchers.
 */
@Injectable({ providedIn: 'root' })
export class PlatformStore {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private title = inject(Title);

  readonly platform = signal<PlatformInfo>({ name: 'Zingoo' });
  readonly identity = signal<Identity | null>(null);

  readonly platformLogo = computed(() => logoUrl(this.platform().logoId));
  readonly identityLogo = computed(() => logoUrl(this.identity()?.logoId));
  /** one line for the foot of documents: name · address · phone · email · website */
  readonly footer = computed(() => {
    const p = this.platform();
    return [p.name, richToPlain(p.address ?? '').replace(/\s*\n\s*/g, ', '), p.phone, p.email, p.website].filter(Boolean).join(' · ');
  });

  constructor() {
    this.loadPlatform();
    // a new sign-in (or switching to another login) shows that party
    effect(() => {
      const u = this.auth.user();
      this.identity.set(null);
      if (u) this.loadIdentity();
    });
    effect(() => this.title.setTitle(this.platform().name || 'Zingoo'));
    effect(() => {
      // documents are issued by the primary company; with none, by the platform
      const issuer = this.identity()?.issuer ?? null;
      setVoucherBrand({
        company: issuer?.name ?? this.platform().name,
        logo: logoUrl(issuer?.logoId) ?? this.platformLogo(),
        footer: this.footer(),
      });
    });
  }

  loadPlatform() {
    this.http.get<PlatformInfo>(`${environment.apiUrl}/platform`).subscribe({ next: (p) => this.platform.set(p), error: () => {} });
  }

  loadIdentity() {
    if (!this.auth.isLoggedIn) return;
    this.http.get<Identity>(`${environment.apiUrl}/platform/identity`).subscribe({ next: (i) => this.identity.set(i), error: () => {} });
  }

  /** after a company, partner or platform change */
  reload() {
    this.loadPlatform();
    this.loadIdentity();
  }
}
