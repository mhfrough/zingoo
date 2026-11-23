import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, AttachmentsApi } from '../../core/attachments.api';
import { errorText } from '../../shared/errors';
import { fmtDate, fmtNumber } from '../../shared/format';
import { printVoucher } from '../../shared/print';
import { Btn, Field, Help, IconComponent, Offcanvas, RichText, richToPlain } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FactoryApi, Shipment } from './factory.api';
import { OrderDetail } from './order-detail';
import { dispatchVoucherFor } from './vouchers';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The distributor receives a dispatch: every product the factory loaded on one vehicle (one DC- number). It sees
 * what was ordered, delivered and damaged at the factory, enters any bundles damaged on arrival with photos, and
 * either accepts the delivery or opens a dispute the manufacturer answers (accept, reject or hold).
 */
@Component({
  selector: 'app-dispatch-receive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, OrderDetail, Help, IconComponent],
  styles: `
    .stack4 {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }

    h4 {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      margin: 0 0 var(--space-2);
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
      gap: var(--space-3) var(--space-4);
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);

      & dt {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & dd {
        margin: 2px 0 0;
        overflow-wrap: anywhere;
      }
    }

    .wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);
    }

    .qty {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;

      & th {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
        text-align: start;
      }

      & td {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        vertical-align: middle;
      }

      & td small {
        display: block;
        color: var(--text-3);
        font-size: var(--text-xs);
      }

      & th:not(:first-child),
      & td:not(:first-child) {
        text-align: end;
      }

      & input {
        inline-size: 4.5rem;
      }

      & tr.damage-row td {
        padding-block-start: 0;
        text-align: start;
      }

      & tr:first-child td {
        border-block-end: 0;
      }
    }

    /* damage on arrival: containers, bundles and loose pieces in one line under the product */
    .damage {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      padding: var(--space-2);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);

      & label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-xs);
        color: var(--text-2);
      }
    }

    .damage__label {
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      color: var(--text-2);
    }

    .files {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-xs);
      color: var(--text-3);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px var(--space-2);
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-2);

      & button {
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        cursor: pointer;
      }
    }

    .upload {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      cursor: pointer;

      & input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="'Receive ' + ref()" [subtitle]="subject()" split asideLabel="Order details" [dirty]="form.dirty"
      help="Check the goods against what the factory loaded. No damage: accept the delivery. Damage: enter the bundles, add photos and open a dispute; the manufacturer accepts, rejects or holds it.">
      <app-order-detail offcanvasAside [orderId]="open() ? loads()[0]?.orderId : null" />
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="send()" class="form-grid" novalidate>
        <div class="stack4">
          @if (loads()[0]; as l) {
            <section>
              <h4>Delivery
                <app-help title="Delivery" text="The vehicle and driver the factory recorded when loading, and the dispatch voucher the driver signed." />
              </h4>
              <dl class="facts">
                <div><dt>Dispatch</dt><dd>{{ ref() }} · {{ date(l.shipDate) }}</dd></div>
                <div><dt>Vehicle</dt><dd>{{ l.vehicle || '-' }}</dd></div>
                <div><dt>Driver</dt><dd>{{ l.driverName || '-' }}{{ l.driverPhone ? ' · ' + l.driverPhone : '' }}</dd></div>
                <div><dt>Transporter</dt><dd>{{ l.transporter || '-' }}{{ l.waybill ? ' · bilty ' + l.waybill : '' }}</dd></div>
              </dl>
              <div style="margin-block-start: var(--space-2)">
                <button appBtn type="button" size="sm" icon="download" (click)="voucher()">Dispatch voucher</button>
              </div>
            </section>
          }

          <section>
            <h4>Quantities
              <app-help title="Quantities" text="Ordered: what you asked for. Delivered: what the factory loaded. Damaged by the manufacturer: found at the factory and not sent. Damaged on arrival: what you found damaged, in whole containers, bundles and loose pieces; leave it empty when there is none. The claim counts whole bundles; loose pieces go in its note." />
            </h4>
            <div class="wrap">
              <table class="qty">
                <thead>
                  <tr><th>Product</th><th>Ordered</th><th>Delivered</th><th>Damaged by manufacturer</th></tr>
                </thead>
                @for (l of loads(); track l.id) {
                  <tbody>
                    <tr>
                      <td><strong>{{ l.product.name }}</strong><small>{{ l.product.sku }} · {{ l.refNo }}</small></td>
                      <td>{{ num(l.order.containers) }}<small>{{ unitOf(l) }}</small></td>
                      <td>{{ num(l.containers) }}<small>{{ num(l.containers * l.bundlesPerContainer) }} bundles</small></td>
                      <td>{{ l.order.productionDamaged ? num(l.order.productionDamaged) : '-' }}</td>
                    </tr>
                    <tr class="damage-row">
                      <td colspan="4">
                        <div class="damage">
                          <span class="damage__label">Damaged on arrival</span>
                          @for (k of parts; track k) {
                            <label>
                              <input type="number" min="0" step="1" [value]="damage()[l.id]?.[k] ?? ''" placeholder="0"
                                (input)="setDamage(l.id, k, $any($event.target).value)" [attr.aria-label]="partLabel(l, k) + ' damaged on arrival of ' + l.product.sku" />
                              <span>{{ partLabel(l, k) }}</span>
                            </label>
                          }
                          @if (bundlesOf(l) > 0) { <strong class="info-figure">= {{ num(bundlesOf(l)) }} bundles claimed</strong> }
                        </div>
                      </td>
                    </tr>
                  </tbody>
                }
              </table>
            </div>
          </section>

          @if (anyDamage()) {
            <section>
              <h4>Dispute
                <app-help title="Dispute" text="Each damaged product becomes a claim the manufacturer answers: accept (credit or replacement), reject or hold. Until then its value is held out of what the manufacturer is paid." />
              </h4>
              <app-field label="What was damaged" [wide]="true" [required]="true" [error]="invalid('note') ? 'Say what was damaged' : null">
                <app-rich-text formControlName="note" [max]="500" [storeMax]="500" />
              </app-field>
              <div class="files" style="margin-block-start: var(--space-2)">
                @for (f of proofs(); track f.id) {
                  <span class="chip">{{ f.name }} <button type="button" (click)="dropProof(f.id)" [attr.aria-label]="'Remove ' + f.name"><app-icon name="x" [size]="12" /></button></span>
                }
                <label class="btn upload" data-size="sm">
                  <app-icon name="upload" [size]="14" /> {{ uploading() ? 'Uploading...' : 'Add photos of the damage' }}
                  <input type="file" multiple [accept]="accept" (change)="upload($event)" [disabled]="uploading()" />
                </label>
                @if (!proofs().length) { <span>Photos help the manufacturer decide</span> }
              </div>
            </section>
          }

          <app-field label="Date received" [required]="true"><input type="date" formControlName="date" [max]="maxDate" [min]="loads()[0]?.shipDate ?? ''" /></app-field>
        </div>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        @if (anyDamage()) {
          <button appBtn variant="danger" type="submit" [attr.form]="formId" icon="alert" [loading]="busy()">Receive and open dispute</button>
        } @else {
          <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Accept delivery</button>
        }
      </ng-container>
    </app-offcanvas>
  `,
})
export class DispatchReceive extends FormModal {
  private factory = inject(FactoryApi);
  private files = inject(AttachmentsApi);
  /** the loads of one dispatch (one per product) */
  readonly loads = input<Shipment[]>([]);
  readonly formId = 'form-dispatch-receive';
  protected maxDate = today();
  protected accept = ATTACHMENT_ACCEPT;
  readonly form = this.fb.nonNullable.group({ date: [today(), Validators.required], note: [''] });
  /** damage on arrival per load: whole containers, bundles and loose pieces */
  protected damage = signal<Record<string, { containers?: number; bundles?: number; pieces?: number }>>({});
  protected parts = ['containers', 'bundles', 'pieces'] as const;
  protected partLabel = (l: Shipment, k: 'containers' | 'bundles' | 'pieces') => (k === 'containers' ? this.unitOf(l) : k === 'bundles' ? 'Bundles' : 'Pieces');
  /** Bora / Carton / container: what the first load's containers are called */
  protected unitOf = (l: Shipment | undefined) => l?.order?.containerUnit || l?.product?.containerUnit || 'Containers';
  /** the damage of one load in whole bundles (loose pieces count once they make a whole bundle) */
  protected bundlesOf(l: Shipment): number {
    const d = this.damage()[l.id] ?? {};
    const piecesPerBundle = Math.max(1, (l.order?.piecesPerPacket ?? 1) * l.packetsPerBundle);
    return (d.containers ?? 0) * l.bundlesPerContainer + (d.bundles ?? 0) + Math.floor((d.pieces ?? 0) / piecesPerBundle);
  }
  /** what each claim is not counting: loose pieces short of a whole bundle */
  private damageText(): string {
    return this.loads().map((l) => {
      const d = this.damage()[l.id] ?? {};
      const bits = [d.containers ? `${d.containers} ${this.unitOf(l)}` : '', d.bundles ? `${d.bundles} bundles` : '', d.pieces ? `${d.pieces} pieces` : ''].filter(Boolean);
      return bits.length ? `${l.product.sku}: ${bits.join(', ')}` : '';
    }).filter(Boolean).join(' · ');
  }
  protected proofs = signal<{ id: string; name: string }[]>([]);
  protected uploading = signal(false);
  protected num = fmtNumber;
  protected date = fmtDate;

  protected ref = computed(() => this.loads()[0]?.dispatchRef ?? this.loads()[0]?.refNo ?? '');
  protected subject = computed(() => {
    const l = this.loads();
    return l.length ? `${l.map((x) => `${x.containers} × ${x.product.sku}`).join(', ')} from ${l[0].manufacturer.name}` : '';
  });
  protected anyDamage = computed(() => Object.values(this.damage()).some((v) => (v.containers ?? 0) + (v.bundles ?? 0) + (v.pieces ?? 0) > 0));

  protected setDamage(id: string, k: 'containers' | 'bundles' | 'pieces', v: string) {
    this.damage.update((d) => ({ ...d, [id]: { ...d[id], [k]: v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0)) } }));
    this.form.markAsDirty();
  }

  protected upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    const big = picked.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (big) { this.error.set(`${big.name} is larger than 5 MB.`); return; }
    this.error.set('');
    const next = (k: number) => {
      if (k >= picked.length) { this.uploading.set(false); return; }
      this.uploading.set(true);
      this.files.upload(picked[k]).subscribe({
        next: (m) => { this.proofs.update((p) => [...p, { id: m.id, name: m.name }]); next(k + 1); },
        error: (err) => { this.uploading.set(false); this.error.set(errorText(err)); },
      });
    };
    next(0);
  }

  protected dropProof(id: string) {
    this.proofs.update((p) => p.filter((f) => f.id !== id));
    this.files.remove(id).subscribe({ error: () => undefined });
  }

  protected voucher() {
    const l = this.loads();
    if (!l.length) return;
    printVoucher(dispatchVoucherFor(l.map((x) => ({ ...x.order, product: x.product, manufacturer: x.manufacturer, distributor: x.distributor ?? x.order.distributor })), {
      ref: l[0].order.groupRef ?? l[0].order.refNo, date: l[0].shipDate,
      ready: Object.fromEntries(l.map((x) => [x.order.id, x.containers])),
      damaged: Object.fromEntries(l.map((x) => [x.order.id, x.order.productionDamaged ?? null])),
      vehicleNo: l[0].vehicle ?? '', driverName: l[0].driverName ?? '', driverPhone: l[0].driverPhone ?? '',
      transporter: l[0].transporter ?? '', biltyNo: l[0].waybill ?? '',
    }));
  }

  /** a dispute needs to say what was damaged */
  protected send() {
    const c = this.form.controls.note;
    c.setValidators(this.anyDamage() ? Validators.required : null);
    c.updateValueAndValidity({ emitEvent: false });
    this.submit();
  }

  protected reset() {
    this.form.reset({ date: today(), note: '' });
    this.damage.set({});
    this.proofs.set([]);
  }

  protected request() {
    const v = this.form.getRawValue();
    const note = [richToPlain(v.note).trim(), this.anyDamage() ? `Damaged on arrival: ${this.damageText()}` : ''].filter(Boolean).join(' · ').slice(0, 500);
    return this.factory.receiveDispatch({
      date: v.date, lines: this.loads().map((l) => ({ shipmentId: l.id, damaged: this.bundlesOf(l) || null })),
      ...(note ? { note } : {}), ...(this.proofs().length ? { proofIds: this.proofs().map((p) => p.id) } : {}),
    });
  }

  protected successMessage() {
    return this.anyDamage() ? 'Received. The dispute went to the manufacturer.' : 'Delivery accepted. The goods are in your stock.';
  }
}
