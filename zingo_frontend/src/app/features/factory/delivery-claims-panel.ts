import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { errorText } from '../../shared/errors';
import { ProofFile, downloadBase64, readProof } from '../../shared/files';
import { Tone, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, DataTable, Field, Offcanvas, RowAction, RowActionEvent, Select, SelectOption, TableColumn, ToastService } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { DeliveryClaim, FactoryApi, Shipment } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);
const KINDS = ['Damaged', 'Missing', 'Quality'] as const;
const KIND_TEXT: Record<string, string> = { Damaged: 'Damaged bundles', Missing: 'Missing bundles', Quality: 'Poor quality' };

/** The distributor (or staff for it) reports faulty bundles in a received delivery from the manufacturer. */
@Component({
  selector: 'app-delivery-claim-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report faulty goods" subtitle="The manufacturer the goods came from decides; Zen Foods sees it too." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Delivery" [wide]="true" [required]="true" [error]="invalid('shipmentId') ? 'Choose a delivery' : null">
          <app-select formControlName="shipmentId" [options]="lotOptions()" placeholder="Choose a received delivery" [clearable]="false" />
        </app-field>
        @if (picked(); as s) {
          <div class="notice" style="grid-column: 1 / -1">
            <span>From <strong>{{ s.manufacturer.name }}</strong> · {{ fmtNumber(received()) }} bundles received on {{ fmtDate(s.receivedDate) }}
              · PKR {{ fmtNumber(perBundle()) }} a bundle</span>
          </div>
        }
        <app-field label="What is wrong" [required]="true">
          <select formControlName="kind">
            @for (k of kinds; track k) {
              <option [value]="k">{{ kindText[k] }}</option>
            }
          </select>
        </app-field>
        <app-field label="Faulty bundles" [required]="true" [hint]="value() ? 'Worth ' + money(value()) : ''" [error]="invalid('bundles') ? 'At least 1' : null">
          <input type="number" formControlName="bundles" min="1" [max]="received()" step="1" />
        </app-field>
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" [min]="picked()?.receivedDate ?? ''" [max]="maxDate" /></app-field>
        <app-field label="What happened" [wide]="true" [required]="true" [error]="invalid('note') ? 'Describe the fault' : null">
          <textarea formControlName="note" rows="3" maxlength="500"></textarea>
        </app-field>
        <app-field label="Photo or PDF" [wide]="true" [hint]="file() ? file()!.proofName : 'Image or PDF, under 450 KB'" [error]="fileError() || null">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" (change)="pick($event)" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="send" [loading]="busy()">Send claim</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DeliveryClaimForm extends FormModal {
  private factory = inject(FactoryApi);
  /** received deliveries to a distributor */
  readonly lots = input<Shipment[]>([]);
  readonly formId = 'form-delivery-claim';
  protected maxDate = today();
  protected kinds = KINDS;
  protected kindText = KIND_TEXT;
  protected fmtNumber = fmtNumber;
  protected fmtDate = fmtDate;
  protected money = (v: number) => fmtMoney(v);
  protected file = signal<ProofFile | null>(null);
  protected fileError = signal('');

  readonly form = this.fb.nonNullable.group({
    shipmentId: ['', Validators.required],
    kind: ['Damaged' as string, Validators.required],
    bundles: [1, [Validators.required, Validators.min(1)]],
    date: [today(), Validators.required],
    note: ['', Validators.required],
  });
  private v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected lotOptions = computed<SelectOption<string>[]>(() => this.lots().map((s) => ({
    value: s.id, label: `${s.refNo} · ${s.product.sku}`, sub: `${s.receivedContainers ?? 0} container${s.receivedContainers === 1 ? '' : 's'} · received ${fmtDate(s.receivedDate)} · ${s.manufacturer.name}`,
  })));
  protected picked = computed(() => this.lots().find((s) => s.id === this.v().shipmentId) ?? null);
  protected received = computed(() => (this.picked() ? (this.picked()!.receivedContainers ?? 0) * this.picked()!.bundlesPerContainer : 0));
  protected perBundle = computed(() => (this.picked() ? Math.round(this.picked()!.packetsPerBundle * Number(this.picked()!.rate) * 100) / 100 : 0));
  protected value = computed(() => Math.round(Number(this.v().bundles ?? 0) * this.perBundle() * 100) / 100);

  protected reset() {
    this.file.set(null);
    this.fileError.set('');
    this.form.reset({ shipmentId: this.lots()[0]?.id ?? '', kind: 'Damaged', bundles: 1, date: today(), note: '' });
  }

  protected pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.fileError.set('');
    this.file.set(null);
    if (!f) return;
    readProof(f).then((p) => this.file.set(p), (err: Error) => this.fileError.set(err.message));
  }

  protected request() {
    const x = this.form.getRawValue();
    return this.factory.raiseClaim({
      shipmentId: x.shipmentId, kind: x.kind, bundles: Number(x.bundles), date: x.date, note: x.note.trim(), ...(this.file() ?? {}),
    });
  }

  protected successMessage() {
    return 'Claim sent. The manufacturer and Zen Foods are notified.';
  }
}

/** The manufacturer (or Admin / Manufacturing for it) accepts with a credit or a replacement, or rejects with a reason. */
@Component({
  selector: 'app-delivery-claim-decide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="'Decide ' + (c()?.refNo ?? 'claim')" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      @if (c(); as c) {
        <div class="notice" style="margin-block-end: var(--space-4)"><span><strong>{{ c.distributor }}</strong>: {{ c.note }}</span></div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Decision" [wide]="true" [required]="true">
          <select formControlName="decision">
            <option value="Credit">Accept: take it off what Zen Foods owes ({{ money(c()?.value ?? 0) }})</option>
            <option value="Replace">Accept: send replacement goods</option>
            <option value="Reject">Reject</option>
          </select>
        </app-field>
        <app-field label="Note" [wide]="true" [required]="rejecting()" [hint]="rejecting() ? 'Say why; the distributor sees it' : 'Optional'"
                   [error]="rejecting() && invalid('note') ? 'Give a reason' : null">
          <textarea formControlName="note" rows="3" maxlength="500"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn [variant]="rejecting() ? 'danger' : 'primary'" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">{{ rejecting() ? 'Reject claim' : 'Accept claim' }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DeliveryClaimDecide extends FormModal {
  private factory = inject(FactoryApi);
  readonly c = input<DeliveryClaim | null>(null);
  readonly formId = 'form-delivery-claim-decide';
  protected money = (v: number) => fmtMoney(v);
  readonly form = this.fb.nonNullable.group({ decision: ['Credit', Validators.required], note: [''] });
  private v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected rejecting = computed(() => this.v().decision === 'Reject');
  protected subject = computed(() => {
    const c = this.c();
    return c ? `${fmtNumber(c.bundles)} ${c.kind.toLowerCase()} bundles of ${c.sku} on ${c.shipmentRef}` : '';
  });

  constructor() {
    super();
    this.form.controls.decision.valueChanges.subscribe(() => {
      this.form.controls.note.setValidators(this.rejecting() ? Validators.required : null);
      this.form.controls.note.updateValueAndValidity({ emitEvent: false });
    });
  }

  protected reset() {
    this.form.reset({ decision: 'Credit', note: '' });
  }

  protected request() {
    const x = this.form.getRawValue();
    const note = x.note.trim();
    return this.factory.decideClaim(this.c()!.id, x.decision === 'Reject'
      ? { decision: 'Reject', note }
      : { decision: 'Accept', resolution: x.decision, ...(note ? { note } : {}) });
  }

  protected successMessage() {
    return 'Decision saved. The distributor and Zen Foods are notified.';
  }
}

/**
 * Faulty-goods claims on manufacturer deliveries, for every side:
 * - `distributor`: raise a claim on a delivery it received and follow the answer;
 * - `factory`: the manufacturer answers claims about its goods;
 * - `company`: staff see every claim; Admin / Distribution may raise one for a distributor, Admin / Manufacturing
 *   may answer for a manufacturer.
 */
@Component({
  selector: 'app-delivery-claims-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, DeliveryClaimForm, DeliveryClaimDecide],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>Faulty goods claims</h2>
          <p>{{ mode() === 'factory'
            ? 'Distributors report damaged, missing or poor-quality bundles in your deliveries. Accept with a credit or a replacement, or reject with a reason'
            : mode() === 'distributor'
              ? 'Report faulty bundles in a delivery; the manufacturer answers and Zen Foods is told at every step'
              : 'Claims on manufacturer deliveries: the distributor raises, the manufacturer decides' }}</p>
        </div>
        @if (canRaise()) {
          <button appBtn variant="primary" icon="alert" (click)="raiseOpen.set(true)" [disabled]="!lots().length">Report faulty goods</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="claims.value() ?? []" [actions]="actions" [loading]="claims.isLoading()"
          [error]="claims.error() ? 'The server did not answer.' : null" searchPlaceholder="Search claims"
          emptyTitle="No claims" emptyText="Faulty goods reported on a delivery appear here." (retry)="reload()" (action)="onAction($event)" />
      </div>
    </div>

    <app-delivery-claim-form [(open)]="raiseOpen" [lots]="lots()" (saved)="saved()" />
    <app-delivery-claim-decide [(open)]="decideOpen" [c]="current()" (saved)="saved()" />
  `,
})
export class DeliveryClaimsPanel {
  private factory = inject(FactoryApi);
  private toast = inject(ToastService);

  readonly mode = input<'company' | 'factory' | 'distributor'>('company');
  /** deliveries a claim can be raised on (received at a distributor) */
  readonly shipments = input<Shipment[]>([]);
  /** staff filters (ignored for partner logins) */
  readonly distributorId = input<string | null | undefined>(null);
  readonly manufacturerId = input<string | null | undefined>(null);
  readonly canRaise = input(false);
  readonly canDecide = input(false);
  /** bump to reload */
  readonly tick = input(0);
  readonly changed = output<void>();

  private local = signal(0);
  protected raiseOpen = signal(false);
  protected decideOpen = signal(false);
  protected current = signal<DeliveryClaim | null>(null);

  protected claims = rxResource({
    params: () => ({ t: this.tick(), l: this.local(), d: this.distributorId() ?? undefined, m: this.manufacturerId() ?? undefined }),
    stream: ({ params }) => this.factory.deliveryClaims({ distributorId: params.d, manufacturerId: params.m }),
  });
  protected lots = computed(() => this.shipments().filter((s) => s.status === 'Received' && s.destination === 'Distributor' && (s.receivedContainers ?? 0) > 0));

  protected columns = computed<TableColumn<DeliveryClaim>[]>(() => [
    { id: 'ref', label: 'Claim', value: (c) => c.refNo, sub: (c) => `${fmtDate(c.date)} · by ${c.raisedBy}` },
    { id: 'what', label: 'Faulty goods', value: (c) => `${fmtNumber(c.bundles)} × ${c.sku}`, sub: (c) => `${KIND_TEXT[c.kind] ?? c.kind} · ${c.shipmentRef}` },
    {
      id: 'party', label: this.mode() === 'factory' ? 'Distributor' : this.mode() === 'distributor' ? 'Manufacturer' : 'Distributor / manufacturer', priority: 2,
      value: (c) => (this.mode() === 'factory' ? c.distributor : this.mode() === 'distributor' ? c.manufacturer : c.distributor) ?? '',
      sub: (c) => (this.mode() === 'company' ? `from ${c.manufacturer}` : c.note),
    },
    { id: 'value', label: 'Value', kind: 'money', value: (c) => c.value, priority: 2 },
    {
      id: 'status', label: 'Status', kind: 'tag',
      value: (c) => (c.status === 'Pending' ? `Waiting for ${this.mode() === 'factory' ? 'you' : c.manufacturer}` : c.status === 'Rejected' ? 'Rejected' : c.resolution === 'Credit' ? 'Accepted · credit' : 'Accepted · replacement'),
      tone: (c): Tone => (c.status === 'Pending' ? 'warning' : c.status === 'Rejected' ? 'danger' : 'success'),
      sub: (c) => (c.decidedBy ? `${c.decidedBy} · ${fmtDate(c.decidedDate)}${c.decisionNote ? ` · ${c.decisionNote}` : ''}` : null),
    },
  ]);

  protected actions = (c: DeliveryClaim): RowAction[] => [
    ...(c.status === 'Pending' && this.canDecide() ? [{ id: 'decide', label: 'Accept or reject', tone: 'success' as const }] : []),
    ...(c.hasEvidence ? [{ id: 'evidence', label: 'Download photo / PDF' }] : []),
  ];

  protected onAction(e: RowActionEvent<DeliveryClaim>) {
    this.current.set(e.row);
    if (e.id === 'decide') this.decideOpen.set(true);
    if (e.id === 'evidence') {
      this.factory.claimEvidence(e.row.id).subscribe({
        next: (f) => downloadBase64(f.name, f.mime, f.data),
        error: (err) => this.toast.error(errorText(err)),
      });
    }
  }

  protected reload() {
    this.local.update((n) => n + 1);
  }

  protected saved() {
    this.reload();
    this.changed.emit();
  }
}

