import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AttachmentMeta } from '../../core/attachments.api';
import { AuthService } from '../../core/auth.service';
import { SettingsStore } from '../../core/settings.store';
import { countryOptions } from '../../shared/countries';
import { fmtAmount2 } from '../../shared/format';
import { Btn, Field, FileInput, FilesInput, Offcanvas, Select, SelectOption } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Product } from '../ops/models';
import { ExportClaim, ExportRow, MarketApproval } from './models';

const today = () => new Date().toISOString().slice(0, 10);
const t = (s: string | null | undefined) => (s ?? '').trim() || null;

/** The actual logistics of a container: booking, container, seal, BL / AWB, vessel, dates, status, documents and batch. */
@Component({
  selector: 'app-logistics-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, FileInput],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Logistics & documents" [subtitle]="shipment() ? shipment()!.refNo + ' · ' + shipment()!.buyer : ''" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <h4 class="form-section" style="grid-column: 1 / -1">Batch (traceability)</h4>
        <app-field label="Batch / lot" [hint]="shipped() ? 'Part of the shipped record' : 'Needed before an order for a distributor ships'"><input type="text" formControlName="batchRef" maxlength="60" /></app-field>
        <app-field label="Made on"><input type="date" formControlName="mfgDate" /></app-field>
        <app-field label="Best before" hint="Checked against the market's minimum shelf life"><input type="date" formControlName="expiryDate" /></app-field>
        <h4 class="form-section" style="grid-column: 1 / -1">Shipment</h4>
        <app-field label="Discharge port"><input type="text" formControlName="dischargePort" maxlength="120" /></app-field>
        <app-field label="Mode">
          <select formControlName="shippingMode"><option value="">-</option><option>Sea</option><option>Air</option><option>Road</option></select>
        </app-field>
        <app-field label="Booking no."><input type="text" formControlName="bookingNo" maxlength="60" /></app-field>
        <app-field label="Container no."><input type="text" formControlName="containerNo" maxlength="30" /></app-field>
        <app-field label="Seal no."><input type="text" formControlName="sealNo" maxlength="30" /></app-field>
        <app-field label="BL / AWB no."><input type="text" formControlName="blNo" maxlength="60" /></app-field>
        <app-field label="Vessel / flight"><input type="text" formControlName="vessel" maxlength="80" /></app-field>
        <app-field label="ETD"><input type="date" formControlName="etd" /></app-field>
        <app-field label="ETA"><input type="date" formControlName="eta" /></app-field>
        @if (shipped()) {
          <app-field label="Status">
            <select formControlName="shippingStatus"><option value="">Shipped</option><option>Loaded</option><option>Sailed</option><option>Arrived</option><option>Delivered</option></select>
          </app-field>
        }
        <h4 class="form-section" style="grid-column: 1 / -1">Export documents</h4>
        <div formArrayName="documents" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2)">
          @for (d of docs.controls; track d; let i = $index) {
            <div [formGroupName]="i" style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto; gap: var(--space-2); align-items: end">
              <app-field label="Document">
                <select formControlName="type">
                  @for (x of docTypes(); track x) { <option [value]="x">{{ x }}</option> }
                </select>
              </app-field>
              <app-field label="File"><app-file-input formControlName="file" /></app-field>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="docs.removeAt(i); form.markAsDirty()" [attr.aria-label]="'Remove document ' + (i + 1)"></button>
            </div>
          }
          <div><button appBtn type="button" size="sm" icon="plus" (click)="addDoc()">Add document</button></div>
        </div>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class LogisticsForm extends FormModal {
  readonly shipment = input<ExportRow | null>(null);
  readonly formId = 'form-logistics';
  private http = inject(ApiService);
  private store = inject(SettingsStore);
  protected docTypes = computed(() => this.store.options('EXPORT_DOC_TYPE'));
  protected shipped = computed(() => this.shipment()?.status === 'Shipped');

  readonly form = this.fb.nonNullable.group({
    batchRef: [''], mfgDate: [''], expiryDate: [''], dischargePort: [''], shippingMode: [''], bookingNo: [''], containerNo: [''],
    sealNo: [''], blNo: [''], vessel: [''], etd: [''], eta: [''], shippingStatus: [''], documents: this.fb.array<FormGroup>([]),
  });
  protected get docs() {
    return this.form.controls.documents as FormArray<FormGroup>;
  }

  protected addDoc(type?: string, file: AttachmentMeta | null = null) {
    this.docs.push(this.fb.nonNullable.group({ type: [type ?? this.docTypes()[0] ?? ''], file: [file] }));
    this.form.markAsDirty();
  }

  protected reset() {
    const x = this.shipment();
    this.docs.clear();
    for (const d of x?.documents ?? []) this.docs.push(this.fb.nonNullable.group({ type: [d.type], file: [d.file as AttachmentMeta | null] }));
    this.form.reset({
      batchRef: x?.batchRef ?? '', mfgDate: x?.mfgDate ?? '', expiryDate: x?.expiryDate ?? '', dischargePort: x?.dischargePort ?? '',
      shippingMode: x?.shippingMode ?? '', bookingNo: x?.bookingNo ?? '', containerNo: x?.containerNo ?? '', sealNo: x?.sealNo ?? '',
      blNo: x?.blNo ?? '', vessel: x?.vessel ?? '', etd: x?.etd ?? '', eta: x?.eta ?? '', shippingStatus: x?.shippingStatus ?? '',
    });
    (x?.documents ?? []).forEach((d, i) => this.docs.at(i).reset({ type: d.type, file: d.file }));
    for (const k of ['batchRef', 'mfgDate', 'expiryDate'] as const) {
      if (this.shipped()) this.form.controls[k].disable({ emitEvent: false });
      else this.form.controls[k].enable({ emitEvent: false });
    }
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.http.patch(`exports/${this.shipment()!.id}/logistics`, {
      ...(this.shipped() ? {} : { batchRef: t(v.batchRef), mfgDate: t(v.mfgDate), expiryDate: t(v.expiryDate) }),
      dischargePort: t(v.dischargePort), shippingMode: t(v.shippingMode), bookingNo: t(v.bookingNo), containerNo: t(v.containerNo),
      sealNo: t(v.sealNo), blNo: t(v.blNo), vessel: t(v.vessel), etd: t(v.etd), eta: t(v.eta),
      ...(this.shipped() ? { shippingStatus: t(v.shippingStatus) } : {}),
      documents: (v.documents as { type: string; file: AttachmentMeta | null }[]).filter((d) => d.type && d.file),
    });
  }

  protected successMessage() {
    return 'Logistics saved.';
  }
}

/** Raise a damage, shortage, quality or return claim on a shipped container. */
@Component({
  selector: 'app-claim-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, FilesInput],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Raise a claim" [subtitle]="shipment() ? shipment()!.refNo + ' · ' + shipment()!.cartons + ' bundles' : ''" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Kind">
          <select formControlName="kind"><option>Damage</option><option>Shortage</option><option>Quality</option><option>Return</option></select>
        </app-field>
        <app-field label="Bundles" [required]="true"><input type="number" formControlName="quantity" min="1" step="1" /></app-field>
        <app-field label="Batch"><input type="text" formControlName="batchRef" maxlength="60" /></app-field>
        <app-field label="What happened" [required]="true" [wide]="true"><textarea formControlName="description" rows="3" maxlength="2000"></textarea></app-field>
        <app-field label="Photos" [wide]="true"><app-files-input formControlName="photos" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Raise claim</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ClaimForm extends FormModal {
  readonly shipment = input<ExportRow | null>(null);
  readonly formId = 'form-claim';
  private http = inject(ApiService);
  readonly form = this.fb.nonNullable.group({
    date: [today()], kind: ['Damage'], quantity: [1], batchRef: [''], description: [''], photos: [[] as AttachmentMeta[]],
  });
  protected reset() {
    this.form.reset({ date: today(), kind: 'Damage', quantity: 1, batchRef: this.shipment()?.batchRef ?? '', description: '', photos: [] });
  }
  protected request() {
    const v = this.form.getRawValue();
    return this.http.post(`exports/${this.shipment()!.id}/claims`, {
      date: v.date, kind: v.kind, quantity: Number(v.quantity) || 1, batchRef: t(v.batchRef) ?? undefined, description: v.description.trim(), photos: v.photos,
    });
  }
  protected successMessage() {
    return 'Claim raised. Finance decides it.';
  }
}

/** Finance decides a claim: a credit note (amount), a replacement, or a rejection with the reason. */
@Component({
  selector: 'app-claim-decision-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Decide claim" [subtitle]="claim() ? claim()!.refNo + ' · ' + claim()!.kind + ' · ' + claim()!.quantity + ' bundle(s)' : ''" size="md" [dirty]="form.dirty">
      @if (claim(); as c) {
        <div class="notice"><span>{{ c.description }}{{ c.photos.length ? ' · ' + c.photos.length + ' photo(s)' : '' }} · raised by {{ c.raisedBy }}</span></div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Decision">
          <select formControlName="decision"><option value="Approve">Approve</option><option value="Reject">Reject</option></select>
        </app-field>
        @if (form.controls.decision.value === 'Approve') {
          <app-field label="Settle by">
            <select formControlName="resolution"><option>Credit note</option><option>Replacement</option></select>
          </app-field>
          @if (form.controls.resolution.value === 'Credit note') {
            <app-field label="Credit" [hint]="'In the invoice currency; at most ' + maxCredit()"><input type="number" formControlName="creditAmount" min="0" step="any" /></app-field>
          }
        }
        <app-field label="Inspection result" [wide]="true"><input type="text" formControlName="inspection" maxlength="2000" /></app-field>
        <app-field label="Note" [wide]="true" [required]="form.controls.decision.value === 'Reject'"><input type="text" formControlName="note" maxlength="1000" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Save decision</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ClaimDecisionForm extends FormModal {
  readonly claim = input<ExportClaim | null>(null);
  /** the shipment the claim is on (for the credit limit) */
  readonly shipment = input<ExportRow | null>(null);
  readonly formId = 'form-claim-decision';
  private http = inject(ApiService);
  protected maxCredit = computed(() => {
    const c = this.claim();
    const x = this.shipment();
    return c && x ? `${x.currency} ${fmtAmount2((x.revenueForeign * c.quantity) / x.cartons)}` : '';
  });
  readonly form = this.fb.nonNullable.group({
    decision: ['Approve'], resolution: ['Credit note'], creditAmount: [0], inspection: [''], note: [''],
  });
  protected reset() {
    this.form.reset({ decision: 'Approve', resolution: 'Credit note', creditAmount: 0, inspection: '', note: '' });
  }
  protected request() {
    const v = this.form.getRawValue();
    return this.http.post(`export-claims/${this.claim()!.id}/decide`, {
      decision: v.decision, ...(v.decision === 'Approve' ? { resolution: v.resolution, ...(v.resolution === 'Credit note' ? { creditAmount: Number(v.creditAmount) || 0 } : {}) } : {}),
      inspection: t(v.inspection) ?? undefined, note: t(v.note) ?? undefined,
    });
  }
  protected successMessage() {
    return 'Claim decided.';
  }
}

/** A product's eligibility for one market: label, allergens, registration, certificates, shelf life, restrictions; the Admin reviews it. */
@Component({
  selector: 'app-market-approval-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, FileInput, Select],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="approval() ? 'Market approval · ' + approval()!.country : 'New market approval'"
                   [subtitle]="approval() ? approval()!.product.sku + ' · ' + approval()!.status : 'Checked by the compliance reviewer before any order ships there'" size="lg" [dirty]="form.dirty">
      @if (approval()?.status === 'Approved') {
        <div class="notice"><span>Saving a change sends it back to Pending: orders to {{ approval()!.country }} cannot ship until it is approved again.</span></div>
      }
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        @if (!approval()) {
          <app-field label="Product" [required]="true">
            <select formControlName="productId">
              @for (p of products(); track p.id) { <option [value]="p.id">{{ p.sku }} · {{ p.name }}</option> }
            </select>
          </app-field>
          <app-field label="Market (country)" [required]="true"><app-select formControlName="country" [options]="countries" placeholder="Country" /></app-field>
        }
        <app-field label="Label version"><input type="text" formControlName="labelVersion" maxlength="40" /></app-field>
        <app-field label="Label languages"><input type="text" formControlName="labelLanguages" maxlength="120" placeholder="English, Arabic" /></app-field>
        <app-field label="Approved artwork" [wide]="true"><app-file-input formControlName="labelFile" label="Upload the label" /></app-field>
        <app-field label="Allergens / nutrition panel" [wide]="true"><input type="text" formControlName="allergens" maxlength="2000" /></app-field>
        <app-field label="Registration authority"><input type="text" formControlName="registrationAuthority" maxlength="150" /></app-field>
        <app-field label="Registration no."><input type="text" formControlName="registrationNo" maxlength="80" /></app-field>
        <app-field label="Registration expiry"><input type="date" formControlName="registrationExpiry" /></app-field>
        <app-field label="Minimum shelf life at dispatch (days)" hint="0 = no check"><input type="number" formControlName="minShelfLifeDays" min="0" step="1" /></app-field>
        <app-field label="Restricted ingredients / rules" [wide]="true"><input type="text" formControlName="restrictions" maxlength="2000" /></app-field>
        <h4 class="form-section" style="grid-column: 1 / -1">Certificates</h4>
        <div formArrayName="certificates" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2)">
          @for (c of certs.controls; track c; let i = $index) {
            <div [formGroupName]="i" style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr) auto; gap: var(--space-2); align-items: end">
              <app-field label="Type"><select formControlName="type">@for (x of certTypes(); track x) { <option [value]="x">{{ x }}</option> }</select></app-field>
              <app-field label="File"><app-file-input formControlName="file" /></app-field>
              <app-field label="Expiry"><input type="date" formControlName="expiry" /></app-field>
              <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="certs.removeAt(i); form.markAsDirty()" [attr.aria-label]="'Remove certificate ' + (i + 1)"></button>
            </div>
          }
          <div><button appBtn type="button" size="sm" icon="plus" (click)="addCert()">Add certificate</button></div>
        </div>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">{{ approval() ? 'Save (back to review)' : 'Send for review' }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class MarketApprovalForm extends FormModal {
  readonly approval = input<MarketApproval | null>(null);
  readonly products = input<Product[]>([]);
  readonly formId = 'form-market-approval';
  private http = inject(ApiService);
  private store = inject(SettingsStore);
  protected auth = inject(AuthService);
  protected countries: SelectOption<string>[] = countryOptions();
  protected certTypes = computed(() => this.store.options('CERT_TYPE'));
  readonly form = this.fb.nonNullable.group({
    productId: [''], country: [''], labelVersion: [''], labelLanguages: [''], labelFile: [null as AttachmentMeta | null], allergens: [''],
    registrationAuthority: [''], registrationNo: [''], registrationExpiry: [''], minShelfLifeDays: [0], restrictions: [''],
    certificates: this.fb.array<FormGroup>([]),
  });
  protected get certs() {
    return this.form.controls.certificates as FormArray<FormGroup>;
  }
  protected addCert() {
    this.certs.push(this.fb.nonNullable.group({ type: [this.certTypes()[0] ?? ''], file: [null as AttachmentMeta | null], expiry: [''] }));
    this.form.markAsDirty();
  }
  protected reset() {
    const a = this.approval();
    this.certs.clear();
    for (const c of a?.certificates ?? []) this.certs.push(this.fb.nonNullable.group({ type: [c.type], file: [c.file as AttachmentMeta | null], expiry: [c.expiry ?? ''] }));
    this.form.reset({
      productId: a?.productId ?? this.products()[0]?.id ?? '', country: a?.country ?? '', labelVersion: a?.labelVersion ?? '',
      labelLanguages: a?.labelLanguages ?? '', labelFile: a?.labelFile ?? null, allergens: a?.allergens ?? '',
      registrationAuthority: a?.registrationAuthority ?? '', registrationNo: a?.registrationNo ?? '', registrationExpiry: a?.registrationExpiry ?? '',
      minShelfLifeDays: a?.minShelfLifeDays ?? 0, restrictions: a?.restrictions ?? '',
    });
    (a?.certificates ?? []).forEach((c, i) => this.certs.at(i).reset({ type: c.type, file: c.file, expiry: c.expiry ?? '' }));
  }
  protected request() {
    const v = this.form.getRawValue();
    const body = {
      labelVersion: t(v.labelVersion), labelLanguages: t(v.labelLanguages), labelFile: v.labelFile, allergens: t(v.allergens),
      registrationAuthority: t(v.registrationAuthority), registrationNo: t(v.registrationNo), registrationExpiry: t(v.registrationExpiry),
      minShelfLifeDays: Number(v.minShelfLifeDays) || 0, restrictions: t(v.restrictions),
      certificates: (v.certificates as { type: string; file: AttachmentMeta | null; expiry: string }[]).filter((c) => c.type && c.file).map((c) => ({ ...c, expiry: c.expiry || null })),
    };
    const a = this.approval();
    return a ? this.http.patch(`market-approvals/${a.id}`, body) : this.http.post('market-approvals', { ...body, productId: v.productId, country: v.country });
  }
  protected successMessage() {
    return 'Market approval sent for review.';
  }
}
