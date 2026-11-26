import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { PlatformStore } from '../../core/platform.store';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { Btn, ConfirmService, Field, LogoInput, RichText, ToastService, UnsavedChanges } from '../../ui';
import { SettingsApi } from './settings.api';

/**
 * Settings > Zingo: the platform's own fixed details (name, logo, tagline, address and contacts). They show on the
 * sidebar, the login page, the browser title and the foot of every printed document. Only the super admin changes
 * them; the super admin also has the tools that delete companies and clear the business data.
 */
@Component({
  selector: 'app-settings-platform',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Field, Btn, LogoInput, RichText],
  template: `
    <div class="stack">
      <form class="card" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="card__head">
          <div><h2>Zingo platform</h2><p>Fixed details of the platform: shown on the sidebar, the login page and the foot of printed documents</p></div>
        </div>
        <div class="card__body form-grid">
          @if (error()) {
            <div class="notice field--wide" data-tone="danger" role="alert">{{ error() }}</div>
          }
          <app-field label="Logo" [wide]="true"><app-logo-input formControlName="logoId" /></app-field>
          <app-field label="Platform name" [required]="true" [error]="bad('name') ? 'Enter the platform name' : null">
            <input type="text" formControlName="name" maxlength="80" />
          </app-field>
          <app-field label="Tagline" hint="One short line under the name"><input type="text" formControlName="tagline" maxlength="150" /></app-field>
          <app-field label="Tax number (NTN)"><input type="text" formControlName="taxNo" maxlength="40" /></app-field>
          <app-field label="Phone"><input type="tel" formControlName="phone" maxlength="60" /></app-field>
          <app-field label="Email" [error]="bad('email') ? 'Enter a valid email' : null"><input type="email" formControlName="email" maxlength="120" /></app-field>
          <app-field label="Website"><input type="text" formControlName="website" maxlength="150" placeholder="zingoo.com" /></app-field>
          <app-field label="Address" [wide]="true">
            <app-rich-text formControlName="address" [max]="500" [storeMax]="5000" placeholder="Street, city, country" />
          </app-field>
        </div>
        <div class="card__body cluster platform-actions">
          @if (isSuperAdmin()) {
            <button appBtn variant="primary" type="submit" icon="check" [loading]="busy()" [disabled]="form.pristine">Save platform details</button>
            <button appBtn type="button" [disabled]="form.pristine" (click)="fill()">Discard changes</button>
          } @else {
            <span class="muted">View only. Only the super admin changes the platform details.</span>
          }
        </div>
      </form>

      @if (isSuperAdmin()) {
        <div class="card danger-zone">
          <div class="card__head"><div><h2>Super admin tools</h2><p>These cannot be undone. Type DELETE to switch the buttons on</p></div></div>
          <div class="card__body stack">
            <div class="danger-row">
              <div>
                <strong>Delete business data</strong>
                <p class="muted">Removes products, manufacturers, distributors, every order, request, invoice, payment, claim, export,
                  finance entry, voucher and ledger line, notifications and partner logins. Keeps the companies, these settings,
                  every list, currencies, categories, cost centers, container types, the chart of accounts and staff logins.</p>
              </div>
              <button appBtn variant="danger" icon="trash" [disabled]="!typed()" [loading]="clearing()" (click)="clearData()">Delete business data</button>
            </div>
            <div class="danger-row">
              <div>
                <strong>Delete all companies</strong>
                <p class="muted">Removes every company of the group, the primary one too. The platform name then names the business.</p>
              </div>
              <button appBtn variant="danger" icon="trash" [disabled]="!typed()" [loading]="deleting()" (click)="deleteCompanies()">Delete all companies</button>
            </div>
            <app-field label="Type DELETE to confirm">
              <input type="text" autocomplete="off" [value]="confirmText()" (input)="confirmText.set($any($event.target).value)" />
            </app-field>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .danger-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
      padding-block-end: var(--space-3);
      border-block-end: 1px solid var(--border);

      & p {
        margin-block-start: var(--space-1);
        max-inline-size: 70ch;
      }

      & > button {
        flex: none;
      }
    }

    .platform-actions {
      padding-block-start: 0;
    }

    .danger-zone app-field {
      max-inline-size: 18rem;
    }
  `,
})
export class SettingsPlatform {
  private fb = inject(FormBuilder);
  private api = inject(SettingsApi);
  private auth = inject(AuthService);
  private platform = inject(PlatformStore);
  private store = inject(SettingsStore);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  /** the root account itself (not an Admin viewing as someone) */
  protected isSuperAdmin = computed(() => !!this.auth.user()?.isRoot && !this.auth.user()?.viewAs);
  protected busy = signal(false);
  protected error = signal('');
  protected confirmText = signal('');
  protected typed = computed(() => this.confirmText().trim() === 'DELETE');
  protected clearing = signal(false);
  protected deleting = signal(false);

  protected form = this.fb.nonNullable.group({
    logoId: this.fb.control<string | null>(null),
    name: ['', Validators.required],
    tagline: [''],
    taxNo: [''],
    phone: [''],
    email: ['', Validators.email],
    website: [''],
    address: [''],
  });

  constructor() {
    // changed platform details not saved yet: leaving the page or closing the tab asks first
    inject(UnsavedChanges).watch(() => this.form.dirty, inject(DestroyRef));
    // fill once the platform details arrive (and again after a save), unless the person is mid-edit
    effect(() => {
      this.platform.platform();
      untracked(() => { if (this.form.pristine) this.fill(); });
    });
    effect(() => {
      const off = !this.isSuperAdmin();
      untracked(() => (off ? this.form.disable({ emitEvent: false }) : this.form.enable({ emitEvent: false })));
    });
  }

  protected fill() {
    const p = this.platform.platform();
    this.form.reset({
      logoId: p.logoId ?? null, name: p.name ?? '', tagline: p.tagline ?? '', taxNo: p.taxNo ?? '', phone: p.phone ?? '',
      email: p.email ?? '', website: p.website ?? '', address: p.address ?? '',
    });
    this.error.set('');
  }

  protected bad(name: string) {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  protected save() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    this.api.updatePlatform({ ...v, name: v.name.trim(), logoId: v.logoId ?? '' }).subscribe({
      next: () => {
        this.busy.set(false);
        this.form.markAsPristine();
        this.platform.reload();
        this.toast.success('Platform details saved.');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err));
      },
    });
  }

  protected async clearData() {
    const ok = await this.confirm.ask({
      title: 'Delete all business data?',
      message: 'Products, partners, orders, payments, invoices and the ledger are removed for good. Setup and staff logins stay.',
      confirmLabel: 'Delete business data', tone: 'danger',
    });
    if (!ok) return;
    this.clearing.set(true);
    this.api.clearBusinessData().subscribe({
      next: (r) => {
        this.clearing.set(false);
        this.confirmText.set('');
        const rows = Object.values(r.removed).reduce((s, n) => s + n, 0);
        this.toast.success(`Business data deleted: ${rows} rows. ${r.usersKept} staff logins kept.`);
        this.store.reload();
        this.platform.reload();
      },
      error: (err) => {
        this.clearing.set(false);
        this.toast.error(errorText(err));
      },
    });
  }

  protected async deleteCompanies() {
    const ok = await this.confirm.ask({
      title: 'Delete every company?',
      message: 'All companies of the group are removed for good, the primary one too.',
      confirmLabel: 'Delete all companies', tone: 'danger',
    });
    if (!ok) return;
    this.deleting.set(true);
    this.api.deleteAllCompanies().subscribe({
      next: (r) => {
        this.deleting.set(false);
        this.confirmText.set('');
        this.toast.success(`${r.deleted} companies deleted.`);
        this.store.reload();
        this.platform.reload();
      },
      error: (err) => {
        this.deleting.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
