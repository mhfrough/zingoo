import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { errorText } from '../../shared/errors';
import { downloadBase64 } from '../../shared/files';
import { concatMap, from, toArray } from 'rxjs';
import { DamageLine, DamageLines, damagesBody, damagesValid } from './damage-lines';
import { docDate, subLine, Tone, fmtDate, fmtDateTime, fmtMoney, fmtNumber, productLabel } from '../../shared/format';
import { Btn, DataTable, Field, Help, Offcanvas, PlainPipe, RichText, RowAction, RowActionEvent, Select, SelectOption, TableColumn, Tag, ToastService } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { DeliveryClaim, FactoryApi, Shipment } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);
const KINDS = ['Damaged', 'Missing', 'Quality'] as const;
const KIND_TEXT: Record<string, string> = { Damaged: 'Damaged bundles', Missing: 'Missing bundles', Quality: 'Poor quality' };

/** the claims raised on one order the same day: one row, a product per claim */
type ClaimRow = DeliveryClaim & { group: DeliveryClaim[] };
const claimStatus = (c: DeliveryClaim) =>
  (c.status === 'Pending' ? 'Waiting' : c.status === 'Hold' ? 'On hold' : c.status === 'Rejected' ? 'Rejected' : c.resolution === 'Credit' ? 'Accepted · credit' : 'Accepted · replacement');
const claimTone = (c: DeliveryClaim): Tone => (c.status === 'Pending' ? 'warning' : c.status === 'Hold' ? 'info' : c.status === 'Rejected' ? 'danger' : 'success');

/** proof files of a claim (the new list, or the one older attachment) */
const proofCount = (c: DeliveryClaim) => (c.proofs?.length ?? 0) + (c.hasEvidence ? 1 : 0);

/**
 * One claim in full: what was claimed, the proof files (download), the decision so far and the messages between the
 * distributor, the manufacturer and Zen Foods. Anyone involved can add a message; the manufacturer's Owner / Manager
 * (or staff for it) can answer from here.
 */
@Component({
  selector: 'app-claim-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, Btn, Tag, PlainPipe, Help],
  styles: `
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr)); gap: var(--space-3); margin: 0 0 var(--space-4);
      & dt { font-size: var(--text-xs); color: var(--text-3); } & dd { margin: 2px 0 0; } }
    h4 { display: flex; align-items: center; gap: var(--space-1); margin: var(--space-4) 0 var(--space-2); font-size: var(--text-xs);
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
    .files { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .msgs { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none;
      & li { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--text-sm); }
      & li[data-side='Manufacturer'] { background: var(--surface-sunken); }
      & small { display: block; color: var(--text-3); font-size: var(--text-xs); } }
    .compose { display: flex; flex-direction: column; gap: var(--space-2); margin-block-start: var(--space-3);
      & textarea { min-block-size: 4.5rem; } }
    .decide { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--surface-sunken);
      & textarea { min-block-size: 3.5rem; } }
    .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); gap: var(--space-2);
      & label { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border);
        border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--text-sm); cursor: pointer; }
      & label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
      & strong { display: block; } }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="'Claim ' + (c()?.refNo ?? '')" [subtitle]="subject()" size="lg"
      help="Everything about this claim in one place: the proof, the decision and the messages between the distributor, the manufacturer and Zen Foods.">
      @if (c(); as c) {
        <dl class="facts">
          <div><dt>Status</dt><dd><app-tag [tone]="tone(c)">{{ state(c) }}</app-tag></dd></div>
          <div><dt>Load</dt><dd>{{ c.shipmentRef }}{{ c.atGate ? ' (at the gate)' : '' }}</dd></div>
          <div><dt>Raised</dt><dd>{{ c.raisedBy }} · {{ date(c.date) }}</dd></div>
          <div><dt>Distributor / manufacturer</dt><dd>{{ c.distributor }} · {{ c.manufacturer }}</dd></div>
          <div style="grid-column: 1 / -1"><dt>What happened</dt><dd>{{ c.note | plain }}</dd></div>
          @if (c.decisionNote) { <div style="grid-column: 1 / -1"><dt>{{ c.status === 'Hold' ? 'Why on hold' : 'Answer' }}</dt><dd>{{ c.decisionNote | plain }}</dd></div> }
        </dl>
        <h4>Proof <app-help title="Proof" text="Photos or PDFs the distributor attached: the damaged bundles, the signed voucher with the shortage written on it, a weighbridge slip." /></h4>
        <div class="files">
          @for (f of c.proofs ?? []; track f.id) {
            <button appBtn type="button" size="sm" icon="download" (click)="get(c.id, f)">{{ f.name }}</button>
          }
          @if (c.hasEvidence) { <button appBtn type="button" size="sm" icon="download" (click)="oldEvidence(c.id)">Earlier attachment</button> }
          @if (!(c.proofs?.length) && !c.hasEvidence) { <span class="muted">No proof attached.</span> }
        </div>
        @if (canDecide() && (c.status === 'Pending' || c.status === 'Hold')) {
          <h4>Your decision <app-help title="Decision" text="Accept with a credit (it comes off what Zen Foods owes you) or with replacement goods, put it on hold to check first, or reject it. A hold or a rejection needs a reason; the distributor and Zen Foods see it." /></h4>
          <div class="decide">
            <div class="choices" role="radiogroup" aria-label="Decision">
              <label><input type="radio" name="claim-decision" value="Credit" [checked]="decision() === 'Credit'" (change)="decision.set('Credit')" /> <span><strong>Accept · credit</strong> {{ money(c.value) }} off what Zen Foods owes</span></label>
              <label><input type="radio" name="claim-decision" value="Replace" [checked]="decision() === 'Replace'" (change)="decision.set('Replace')" /> <span><strong>Accept · replace</strong> send new goods</span></label>
              @if (c.status !== 'Hold') {
                <label><input type="radio" name="claim-decision" value="Hold" [checked]="decision() === 'Hold'" (change)="decision.set('Hold')" /> <span><strong>Hold</strong> check it first</span></label>
              }
              <label><input type="radio" name="claim-decision" value="Reject" [checked]="decision() === 'Reject'" (change)="decision.set('Reject')" /> <span><strong>Reject</strong></span></label>
            </div>
            <textarea maxlength="500" [value]="reason()" (input)="reason.set($any($event.target).value)" aria-label="Reason for the decision"
              [placeholder]="needsReason() ? 'Say why (required): the distributor sees it' : 'Note (optional)'"></textarea>
            @if (decideErr()) { <div class="notice" data-tone="danger" role="alert">{{ decideErr() }}</div> }
            <div>
              <button appBtn type="button" [variant]="decision() === 'Reject' ? 'danger' : 'primary'" icon="check" [loading]="deciding()" (click)="saveDecision(c.id)">
                {{ decision() === 'Reject' ? 'Reject claim' : decision() === 'Hold' ? 'Put on hold' : 'Accept claim' }}
              </button>
            </div>
          </div>
        }
        <h4>Messages</h4>
        <ul class="msgs">
          @for (m of c.thread ?? []; track m.id) {
            <li [attr.data-side]="m.side"><small>{{ m.by }} · {{ m.side === 'Company' ? 'Zen Foods' : m.side.toLowerCase() }} · {{ when(m.createdAt) }}</small>{{ m.text | plain }}</li>
          } @empty {
            <li><small>No messages yet.</small>Ask a question or explain the damage; the other side and Zen Foods are told.</li>
          }
        </ul>
        @if (c.status === 'Pending' || c.status === 'Hold') {
          <div class="compose">
            <textarea maxlength="1000" [value]="text()" (input)="text.set($any($event.target).value)" placeholder="Write a message" aria-label="Message"></textarea>
            @if (err()) { <div class="notice" data-tone="danger" role="alert">{{ err() }}</div> }
            <div><button appBtn type="button" icon="send" size="sm" [loading]="sending()" [disabled]="!text().trim()" (click)="send(c.id)">Send message</button></div>
          </div>
        }
      }
    </app-offcanvas>
  `,
})
export class ClaimThread {
  private factory = inject(FactoryApi);
  private toast = inject(ToastService);
  readonly open = model(false);
  readonly c = input<DeliveryClaim | null>(null);
  readonly canDecide = input(false);
  readonly changed = output<void>();
  protected text = signal('');
  // ───────── the decision, in the same panel as the proof ─────────
  protected decision = signal<'Credit' | 'Replace' | 'Hold' | 'Reject'>('Credit');
  protected reason = signal('');
  protected deciding = signal(false);
  protected decideErr = signal('');
  protected needsReason = computed(() => this.decision() === 'Reject' || this.decision() === 'Hold');
  protected money = fmtMoney;

  constructor() {
    // another claim opened: start the decision afresh
    effect(() => {
      this.c()?.id;
      this.decision.set('Credit');
      this.reason.set('');
      this.decideErr.set('');
    });
  }

  protected saveDecision(id: string) {
    const note = this.reason().trim();
    if (this.needsReason() && !note) { this.decideErr.set('Give a reason: the distributor sees it.'); return; }
    this.decideErr.set('');
    this.deciding.set(true);
    const d = this.decision();
    this.factory.decideClaim(id, d === 'Reject' || d === 'Hold' ? { decision: d, note } : { decision: 'Accept', resolution: d, ...(note ? { note } : {}) }).subscribe({
      next: () => {
        this.deciding.set(false);
        this.toast.success('Decision saved. The distributor and Zen Foods are notified.');
        this.changed.emit();
      },
      error: (e) => {
        this.deciding.set(false);
        this.decideErr.set(errorText(e));
      },
    });
  }
  protected sending = signal(false);
  protected err = signal('');
  protected date = fmtDate;
  protected when = fmtDateTime;
  protected subject = computed(() => {
    const c = this.c();
    return c ? `${fmtNumber(c.bundles)} ${c.kind.toLowerCase()} bundles of ${c.sku}` : '';
  });
  protected state = (c: DeliveryClaim) => (c.status === 'Pending' ? 'Waiting' : c.status === 'Hold' ? 'On hold' : c.status === 'Rejected' ? 'Rejected' : c.resolution === 'Credit' ? 'Accepted · credit' : 'Accepted · replacement');
  protected tone = (c: DeliveryClaim): Tone => (c.status === 'Pending' ? 'warning' : c.status === 'Hold' ? 'info' : c.status === 'Rejected' ? 'danger' : 'success');

  protected get(id: string, f: { id: string; name: string }) {
    this.factory.downloadClaimProof(id, f).subscribe({ error: (e) => this.toast.error(errorText(e)) });
  }

  protected oldEvidence(id: string) {
    this.factory.claimEvidence(id).subscribe({ next: (f) => downloadBase64(f.name, f.mime, f.data), error: (e) => this.toast.error(errorText(e)) });
  }

  protected send(id: string) {
    this.err.set('');
    this.sending.set(true);
    this.factory.addClaimNote(id, this.text().trim()).subscribe({
      next: () => {
        this.sending.set(false);
        this.text.set('');
        this.toast.success('Message sent.');
        this.changed.emit();
      },
      error: (e) => {
        this.sending.set(false);
        this.err.set(errorText(e));
      },
    });
  }
}

/** The distributor (or staff for it) reports faulty bundles in a received delivery from the manufacturer. */
@Component({
  selector: 'app-delivery-claim-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select, DamageLines],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report faulty goods" subtitle="The manufacturer the goods came from decides; Zen Foods sees it too." size="lg" [dirty]="form.dirty"
      help="Each line becomes a claim the manufacturer answers: accept (credit or replacement), reject or hold. Attach photos or PDFs as proof. The claim's value stays out of what is due until it is decided.">
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
              @if (perBundle()) { · PKR {{ fmtNumber(perBundle()) }} a bundle }</span>
          </div>
        }
        <app-field label="Date" [required]="true"><input type="date" formControlName="date" [min]="picked()?.receivedDate ?? ''" [max]="maxDate" /></app-field>
        <app-damage-lines [(lines)]="lines" [maxBundles]="received()" title="Faulty bundles" />
        @if (perBundle() && total()) {
          <p class="muted" style="grid-column: 1 / -1; margin: 0">Worth {{ money(total() * perBundle()) }} at the manufacturer's rate.</p>
        }
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
  /** one claim per line */
  protected lines = signal<DamageLine[]>([]);
  protected total = computed(() => this.lines().reduce((n, l) => n + (Number(l.bundles) || 0), 0));
  readonly form = this.fb.nonNullable.group({
    shipmentId: ['', Validators.required],
    date: [today(), Validators.required],
  });
  private v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected lotOptions = computed<SelectOption<string>[]>(() => this.lots().map((s) => ({
    value: s.id, label: `${s.refNo} · ${s.product.sku}`, sub: `${s.receivedContainers ?? 0} container${s.receivedContainers === 1 ? '' : 's'} · received ${fmtDate(s.receivedDate)} · ${s.manufacturer.name}`,
  })));
  protected picked = computed(() => this.lots().find((s) => s.id === this.v().shipmentId) ?? null);
  protected received = computed(() => (this.picked() ? (this.picked()!.receivedContainers ?? 0) * this.picked()!.bundlesPerContainer : 0));
  /** staff only: a distributor login never receives the manufacturer's rate the claim is valued at */
  protected perBundle = computed(() => (this.picked()?.rate ? Math.round(this.picked()!.packetsPerBundle * Number(this.picked()!.rate) * 100) / 100 : 0));


  protected reset() {
    this.form.reset({ shipmentId: this.lots()[0]?.id ?? '', date: today() });
    this.lines.set([{ kind: 'Damaged', bundles: 1, note: '', proofs: [] }]);
  }

  protected override submit() {
    if (!this.lines().length || !damagesValid(this.lines())) {
      this.error.set('Add a line with the bundles and what happened.');
      return;
    }
    super.submit();
  }

  /** one claim per line, one after the other */
  protected request() {
    const x = this.form.getRawValue();
    return from(damagesBody(this.lines())).pipe(
      concatMap((l) => this.factory.raiseClaim({ shipmentId: x.shipmentId, date: x.date, ...l })),
      toArray(),
    );
  }

  protected successMessage() {
    return 'Claim sent. The manufacturer and Zen Foods are notified.';
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
  imports: [Btn, DataTable, DeliveryClaimForm, ClaimThread],
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
        <app-data-table [columns]="columns()" [rows]="rows()" [actions]="actions" [loading]="claims.isLoading()"
          [error]="claims.error() ? 'The server did not answer.' : null" searchPlaceholder="Search claims"
          emptyTitle="No claims" emptyText="Faulty goods reported on a delivery appear here." (retry)="reload()" (action)="onAction($event)" />
      </div>
    </div>

    <app-delivery-claim-form [(open)]="raiseOpen" [lots]="lots()" (saved)="saved()" />
    <app-claim-thread [(open)]="threadOpen" [c]="current()" [canDecide]="canDecide()" (changed)="saved()" />
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
  protected threadOpen = signal(false);
  /** the claim open in a panel, read from the list so a reload shows its new messages and status */
  private currentId = signal<string | null>(null);
  protected current = computed(() => (this.claims.value() ?? []).find((c) => c.id === this.currentId()) ?? null);

  protected claims = rxResource({
    params: () => ({ t: this.tick(), l: this.local(), d: this.distributorId() ?? undefined, m: this.manufacturerId() ?? undefined }),
    stream: ({ params }) => this.factory.deliveryClaims({ distributorId: params.d, manufacturerId: params.m }),
  });
  protected lots = computed(() => this.shipments().filter((s) => s.status === 'Received' && s.destination === 'Distributor' && (s.receivedContainers ?? 0) > 0));

  /** one row per order and day: the products of a combined order are claimed together */
  protected rows = computed<ClaimRow[]>(() => {
    const map = new Map<string, DeliveryClaim[]>();
    for (const c of this.claims.value() ?? []) {
      const k = `${c.orderRef ?? c.shipmentRef ?? c.id}|${c.date}`;
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return [...map.values()].map((g) => {
      const sorted = [...g].sort((a, b) => a.refNo.localeCompare(b.refNo));
      return { ...sorted[0], group: sorted };
    });
  });

  protected columns = computed<TableColumn<ClaimRow>[]>(() => [
    {
      id: 'what', label: 'Faulty goods', kind: 'title',
      value: (r) => {
        const products = new Set(r.group.map((c) => c.sku)).size;
        return products > 1 ? `${products} products` : productLabel({ name: r.productName, sku: r.sku ?? '' });
      },
      sub: (r) => subLine(
        r.group.map((c) => `${r.group.length > 1 ? `${c.sku}: ` : ''}${fmtNumber(c.bundles)} bundles ${(KIND_TEXT[c.kind] ?? c.kind).toLowerCase()}`).join(' · '),
        r.atGate ? 'at the factory gate' : null,
        (() => { const n = r.group.reduce((s, c) => s + proofCount(c), 0); return n ? `${n} proof file${n === 1 ? '' : 's'}` : 'no proof'; })()),
    },
    {
      id: 'ref', label: 'Order / claim no.', kind: 'mono', value: (r) => r.orderRef ?? r.refNo, sortValue: (r) => r.date,
      sub: (r) => subLine(docDate(r), r.group.map((c) => c.refNo).join(', '), `by ${r.raisedBy}`),
    },
    {
      id: 'party', label: this.mode() === 'factory' ? 'Distributor' : this.mode() === 'distributor' ? 'From' : 'Distributor / manufacturer', priority: 2,
      value: (r) => (this.mode() === 'factory' ? r.distributor : this.mode() === 'distributor' ? r.manufacturer : r.distributor) ?? '',
      sub: (r) => (this.mode() === 'company' ? `from ${r.manufacturer}` : r.note),
    },
    ...(this.mode() === 'distributor' ? [] : [{ id: 'value', label: 'Value', kind: 'money', value: (r: ClaimRow) => r.group.reduce((n, c) => n + Number(c.value), 0), priority: 2 } as TableColumn<ClaimRow>]),
    {
      id: 'status', label: 'Status', kind: 'tag',
      value: (r) => (new Set(r.group.map(claimStatus)).size > 1 ? 'Mixed' : claimStatus(r)),
      tone: (r): Tone => (new Set(r.group.map(claimStatus)).size > 1 ? 'info' : claimTone(r)),
      sub: (r) => (r.group.length > 1 && new Set(r.group.map(claimStatus)).size > 1
        ? r.group.map((c) => `${c.sku}: ${claimStatus(c)}`).join(' · ')
        : r.decidedBy ? `${r.decidedBy} · ${fmtDate(r.decidedDate)}${r.decisionNote ? ` · ${r.decisionNote}` : ''}` : null),
    },
  ]);

  /** each product's actions; with several products the action names the SKU */
  protected actions = (r: ClaimRow): RowAction[] => r.group.flatMap((c) => {
    const tag = r.group.length > 1 ? ` · ${c.sku}` : '';
    return [
      (c.status === 'Pending' || c.status === 'Hold') && this.canDecide()
        ? { id: `thread:${c.id}`, label: `Review and decide${tag}`, tone: 'success' as const }
        : { id: `thread:${c.id}`, label: `${proofCount(c) ? `Proof & messages (${proofCount(c)})` : 'Messages'}${tag}` },
      ...(c.hasEvidence ? [{ id: `evidence:${c.id}`, label: `Download old photo / PDF${tag}` }] : []),
    ];
  });

  protected onAction(e: RowActionEvent<ClaimRow>) {
    const [what, id] = e.id.split(':');
    this.currentId.set(id);
    if (what === 'thread') this.threadOpen.set(true);
    if (what === 'evidence') {
      this.factory.claimEvidence(id).subscribe({
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

