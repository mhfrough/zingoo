import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, concat } from 'rxjs';
import { containersLabel, fmtMoney } from '../../shared/format';
import { Btn, Field, Help, IconComponent, Offcanvas, RichText } from '../../ui';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../../core/attachments.api';
import { errorText } from '../../shared/errors';
import { printVoucher } from '../../shared/print';
import { dispatchVoucherFor } from './vouchers';
import { FormModal } from '../ops/form-modal';
import { FactoryApi, ProductionOrder } from './factory.api';
import { OrderDetail } from './order-detail';

const today = () => new Date().toISOString().slice(0, 10);

/** "MO-001 · 2 containers of Z10-MAS · PKR 36,720", or "DO-001 · 3 products · PKR 90,000" for a combined order */
const subjectOf = (o: ProductionOrder | null, group: ProductionOrder[] = []) => {
  if (!o) return '';
  if (group.length > 1) {
    const value = group.reduce((n, x) => n + (x.value ?? 0), 0);
    return `${o.groupRef ?? o.refNo} · ${group.length} products (${group.map((x) => x.product.sku).join(', ')}) · ${fmtMoney(value)}`;
  }
  return `${o.refNo} · ${containersLabel(o.containers, o.containerUnit ?? o.product.containerUnit)} of ${o.product.sku} · ${fmtMoney(o.value)}`;
};
/** the ids to act on: every product of the combined order, or the one order */
const idsOf = (o: ProductionOrder, group: ProductionOrder[]) => (group.length ? group.map((x) => x.id) : [o.id]);

/** The manufacturer accepts an order, optionally with the date it expects the containers ready. */
@Component({
  selector: 'app-accept-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, OrderDetail],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Accept order" [subtitle]="subject()" split asideLabel="Order details" [dirty]="form.dirty"
      help="Accepting promises the goods by your ready date. Zen Foods and the distributor are told at once.">
      <app-order-detail offcanvasAside [orderId]="open() ? order()?.id : null" />
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Ready by" hint="When the containers will be ready" [wide]="true"
          help="Your best estimate. It shows as tentative until you report the last production step.">
          <input type="date" formControlName="readyDate" [min]="order()?.date ?? ''" />
        </app-field>
        <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Accept order</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AcceptOrderForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly order = input<ProductionOrder | null>(null);
  /** every product of the combined order: all are accepted together */
  readonly group = input<ProductionOrder[]>([]);
  readonly formId = 'form-accept-order';
  readonly form = this.fb.nonNullable.group({ readyDate: [''], note: [''] });
  protected subject = computed(() => subjectOf(this.order(), this.group()));

  protected reset() {
    this.form.reset({ readyDate: this.order()?.dueDate ?? '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.acceptGroup(idsOf(this.order()!, this.group()), { ...(v.readyDate ? { readyDate: v.readyDate } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) });
  }

  protected successMessage() {
    return 'Order accepted. The company is told.';
  }
}

/** Reject (manufacturer) or cancel (company) an order with a reason. */
@Component({
  selector: 'app-order-reason-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="heading()" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Reason" [wide]="true" [hint]="hint()" [required]="true" [error]="invalid('reason') ? 'Say why' : null">
          <app-rich-text formControlName="reason" [max]="500" [storeMax]="500" />
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Keep order</button>
        <button appBtn variant="danger" type="submit" [attr.form]="formId" [loading]="busy()">{{ actionLabel() }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderReasonForm extends FormModal {
  readonly order = input<ProductionOrder | null>(null);
  readonly heading = input('Reject order');
  readonly actionLabel = input('Reject order');
  readonly hint = input('The other side sees this');
  readonly run = input<(reason: string) => Observable<unknown>>();
  readonly done = input('Done.');
  readonly formId = 'form-order-reason';
  readonly form = this.fb.nonNullable.group({ reason: ['', Validators.required] });
  protected subject = computed(() => subjectOf(this.order()));

  protected reset() {
    this.form.reset({ reason: '' });
  }

  protected request() {
    return this.run()!(this.form.getRawValue().reason.trim());
  }

  protected successMessage() {
    return this.done();
  }
}

/** The manufacturer reports the production step it has reached (only later steps are offered). */
@Component({
  selector: 'app-order-stage-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, OrderDetail, Help, IconComponent],
  styles: `
    .dispatch {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    /* each part of the dispatch in its own numbered box */
    .dispatch > section {
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);
    }

    .num {
      display: inline-grid;
      place-items: center;
      inline-size: 1.25rem;
      block-size: 1.25rem;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-text);
      font-size: var(--text-2xs);
      letter-spacing: 0;
    }

    .totals {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      margin-block-start: var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }

    /* the production steps: done, now, and the ones that can be reported next */
    .steps {
      grid-column: 1 / -1;
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);

      & h4 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-3);
      }
    }

    .stepper {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;

      & li {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-block-size: 2.5rem;
        padding-inline-start: 0;
        font-size: var(--text-sm);
      }

      /* the line joining one step to the next */
      & li:not(:last-child)::after {
        content: '';
        position: absolute;
        inset-inline-start: calc(0.75rem - 1px);
        inset-block: calc(50% + 0.75rem) calc(-50% + 0.75rem);
        inline-size: 2px;
        background: var(--border);
      }

      & li[data-state='done']:not(:last-child)::after {
        background: var(--tone-success-fg);
      }

      & .dot {
        display: inline-grid;
        flex: none;
        place-items: center;
        inline-size: 1.5rem;
        block-size: 1.5rem;
        border: 2px solid var(--border-strong, var(--border));
        border-radius: 999px;
        background: var(--surface-card);
      }

      & li[data-state='done'] .dot {
        border-color: var(--tone-success-fg);
        background: var(--tone-success-fg);
        color: #fff;
      }

      & li[data-state='current'] .dot {
        border-color: var(--accent);
        box-shadow: inset 0 0 0 4px var(--surface-card);
        background: var(--accent);
      }

      & li[data-state='current'] {
        font-weight: var(--weight-semibold);
      }

      & small {
        color: var(--text-3);
        font-size: var(--text-xs);
      }

      & label {
        display: flex;
        flex: 1;
        align-items: center;
        gap: var(--space-3);
        margin-inline-start: calc(-1 * var(--space-2));
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
        cursor: pointer;

        & input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        &:hover {
          background: var(--surface-sunken);
        }

        &:has(input:checked) {
          background: var(--accent-soft);
          color: var(--accent-text);
          font-weight: var(--weight-semibold);

          & .dot {
            border-color: var(--accent);
          }
        }

        &:has(input:focus-visible) {
          box-shadow: var(--focus-ring);
        }
      }
    }

    .dispatch h4 {
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

      & input {
        inline-size: 6rem;
      }

      & th:not(:first-child),
      & td:not(:first-child) {
        text-align: end;
      }

      & .diff {
        font-size: var(--text-xs);
        color: var(--tone-warning-fg);
      }
    }

    .wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);
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
    <app-offcanvas #oc [(open)]="open" [title]="dispatching() ? 'Ready to dispatch' : 'Report progress'" [subtitle]="subject()" split asideLabel="Order details" [dirty]="form.dirty"
      [help]="dispatching() ? 'The vehicle of the distributor is at the factory. Record what each product made ready, the vehicle and the driver, and attach the signed handover proof. The distributor gets the dispatch voucher.' : 'Tell Zen Foods and the distributor which production step the order has reached. The last step is the dispatch.'">
      <app-order-detail offcanvasAside [orderId]="open() ? order()?.id : null" />
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="send()" class="form-grid" novalidate>
        @if (stages().length && notDispatched()) {
          <section class="steps" aria-label="Production steps">
            <h4>Production steps · pick the step reached</h4>
            <ol class="stepper">
              @for (s of stages(); track s; let i = $index) {
                <li [attr.data-state]="stepState(i)">
                  @if (stepState(i) === 'next') {
                    <label>
                      <input type="radio" formControlName="stage" [value]="s" />
                      <span class="dot" aria-hidden="true"></span>
                      <span>{{ s }}</span>
                      @if (s === lastStage()) { <small>· dispatch: load the vehicle</small> }
                    </label>
                  } @else {
                    <span class="dot" aria-hidden="true">@if (stepState(i) === 'done') { <app-icon name="check" [size]="12" /> }</span>
                    <span>{{ s }}</span>
                    <small>{{ stepState(i) === 'done' ? 'done' : 'now' }}</small>
                  }
                </li>
              }
            </ol>
          </section>
        } @else if (!dispatching()) {
          <p class="notice" style="grid-column: 1 / -1">Every production step is reported and the order was dispatched.</p>
        }

        @if (dispatching()) {
          <div class="dispatch">
            <section>
              <h4><span class="num">1</span> Quantities
                <app-help title="Quantities" text="Ordered is what the distributor asked for. Ready is what the factory made and loads now: it may be more or less than ordered, and it is what is paid for." />
              </h4>
              <div class="wrap">
                <table class="qty">
                  <thead><tr><th>Product</th><th>Ordered</th><th>Ready to load</th></tr></thead>
                  <tbody>
                    @for (o of lines(); track o.id) {
                      <tr>
                        <td><strong>{{ o.product.name }}</strong><small>{{ o.product.sku }} · {{ o.refNo }} · containers{{ unitOf(o) ? ' (' + unitOf(o) + ')' : '' }}</small></td>
                        <td>{{ o.containers }}<small>{{ o.containers * o.bundlesPerContainer }} bundles</small></td>
                        <td>
                          <input type="number" min="0" step="1" [value]="ready()[o.id]" (input)="setReady(o.id, $any($event.target).value)"
                            [attr.aria-label]="'Ready containers of ' + o.product.sku" />
                          @if (ready()[o.id] !== o.containers) { <small class="diff">{{ ready()[o.id] > o.containers ? '+' : '' }}{{ ready()[o.id] - o.containers }} vs ordered</small> }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="totals" aria-live="polite">
                <span>Ready: <strong class="info-figure">{{ readyTotal().containers }} containers</strong></span>
                <span>{{ readyTotal().bundles }} bundles</span>
                <span>{{ readyTotal().packets }} packets</span>
              </div>
            </section>

            <section>
              <h4><span class="num">2</span> Vehicle and driver
                <app-help title="Vehicle and driver" text="The distributor's vehicle that is being loaded: its registration number and the driver's name and phone. They are printed on the dispatch voucher and shown to the distributor." />
              </h4>
              <div class="form-grid">
                <app-field label="Vehicle registration no." [required]="true" [error]="invalid('vehicleNo') ? 'Enter the vehicle number' : null">
                  <input type="text" formControlName="vehicleNo" maxlength="30" placeholder="e.g. KHI-1234" />
                </app-field>
                <app-field label="Driver name" [required]="true" [error]="invalid('driverName') ? 'Enter the driver' : null">
                  <input type="text" formControlName="driverName" maxlength="80" />
                </app-field>
                <app-field label="Driver contact no." [required]="true" [error]="invalid('driverPhone') ? 'Enter the phone' : null">
                  <input type="tel" formControlName="driverPhone" maxlength="30" placeholder="03xx-xxxxxxx" />
                </app-field>
                <app-field label="Transporter" hint="Company of the vehicle (optional)"><input type="text" formControlName="transporter" maxlength="80" /></app-field>
                <app-field label="Bilty / waybill no." hint="Optional"
                  help="The transporter's goods receipt (bilty) number, if the goods travel with a transport company.">
                  <input type="text" formControlName="biltyNo" maxlength="60" />
                </app-field>
                <app-field label="Dispatch date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
              </div>
            </section>

            <section>
              <h4><span class="num">3</span> Proof of handover
                <app-help title="Proof of handover" text="The signed gate pass / delivery challan: the driver signs the printed dispatch voucher (or your own handover form) when the goods are loaded. Upload a photo or scan of it; at least one file is required." />
              </h4>
              <div class="files">
                @for (f of proofs(); track f.id) {
                  <span class="chip">{{ f.name }} <button type="button" (click)="dropProof(f.id)" [attr.aria-label]="'Remove ' + f.name"><app-icon name="x" [size]="12" /></button></span>
                }
                <label class="btn upload" data-size="sm">
                  <app-icon name="upload" [size]="14" /> {{ uploading() ? 'Uploading...' : 'Add signed gate pass / challan' }}
                  <input type="file" multiple [accept]="accept" (change)="upload($event)" [disabled]="uploading()" />
                </label>
                @if (!proofs().length) { <span>Required: a photo or scan of the signed handover</span> }
              </div>
            </section>
          </div>
        }

        <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        @if (dispatching()) {
          <button appBtn type="button" icon="download" (click)="voucher()" title="Print it for the driver to sign, or save it as PDF">Create voucher</button>
          <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="truck" [loading]="busy()">Ready to dispatch</button>
        } @else {
          <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()" [disabled]="!next().length">Report step</button>
        }
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderStageForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly order = input<ProductionOrder | null>(null);
  /** every product of the combined order: the step is reported for all of them */
  readonly group = input<ProductionOrder[]>([]);
  /** every production step, in order (Settings list) */
  readonly stages = input<string[]>([]);
  readonly formId = 'form-order-stage';
  protected maxDate = today();
  protected accept = ATTACHMENT_ACCEPT;
  readonly form = this.fb.nonNullable.group({
    stage: [''],
    note: [''],
    vehicleNo: [''],
    driverName: [''],
    driverPhone: [''],
    transporter: [''],
    biltyNo: [''],
    date: [today()],
  });
  private v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected subject = computed(() => subjectOf(this.order(), this.group()));
  /** the products of the order */
  protected lines = computed(() => (this.group().length ? this.group() : this.order() ? [this.order()!] : []));
  protected lastStage = computed(() => this.stages()[this.stages().length - 1] ?? null);
  /** only the steps after the current one */
  protected next = computed(() => {
    const all = this.stages();
    const now = this.order()?.stage ? all.indexOf(this.order()!.stage!) : -1;
    return all.slice(now + 1);
  });
  /** not dispatched yet (no ready quantity recorded) */
  protected notDispatched = computed(() => this.lines().every((o) => o.readyContainers == null));
  /** step i: done (before the current one), now, or one that can be reported next */
  protected stepState = (i: number): 'done' | 'current' | 'next' => {
    const now = this.order()?.stage ? this.stages().indexOf(this.order()!.stage!) : -1;
    return i < now ? 'done' : i === now ? 'current' : 'next';
  };
  /** what is loaded in total */
  protected readyTotal = computed(() => {
    const r = this.ready();
    return this.lines().reduce((t, o) => {
      const c = r[o.id] ?? 0;
      return { containers: t.containers + c, bundles: t.bundles + c * o.bundlesPerContainer, packets: t.packets + c * o.bundlesPerContainer * o.packetsPerBundle };
    }, { containers: 0, bundles: 0, packets: 0 });
  });
  /** the last step picked (or already reached and not dispatched): the form becomes the dispatch */
  protected dispatching = computed(() => this.notDispatched() && (this.next().length ? this.v().stage === this.lastStage() : true));

  protected ready = signal<Record<string, number>>({});
  protected proofs = signal<{ id: string; name: string }[]>([]);
  protected uploading = signal(false);
  protected unitOf = (o: ProductionOrder) => o.containerUnit ?? o.product.containerUnit ?? null;

  protected setReady(id: string, v: string) {
    this.ready.update((r) => ({ ...r, [id]: Math.max(0, Math.floor(Number(v) || 0)) }));
    this.form.markAsDirty();
  }

  /** each file goes up at once as a proof of handover on the order */
  protected upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const big = files.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (big) { this.error.set(`${big.name} is larger than 5 MB.`); return; }
    const lead = this.lines()[0];
    if (!lead || !files.length) return;
    this.error.set('');
    this.uploading.set(true);
    concat(...files.map((f) => this.factory.addOrderDoc(lead.id, f, 'HANDOVER'))).subscribe({
      next: (d) => this.proofs.update((p) => [...p, { id: d.id, name: d.name }]),
      error: (err) => { this.uploading.set(false); this.error.set(errorText(err)); },
      complete: () => this.uploading.set(false),
    });
  }

  protected dropProof(id: string) {
    const lead = this.lines()[0];
    this.proofs.update((p) => p.filter((f) => f.id !== id));
    if (lead) this.factory.removeOrderDoc(lead.id, id).subscribe({ error: () => undefined });
  }

  /** the dispatch voucher with what is typed now, to print for the driver to sign */
  protected voucher() {
    const v = this.form.getRawValue();
    printVoucher(dispatchVoucherFor(this.lines(), {
      ref: this.lines()[0]?.groupRef ?? this.lines()[0]?.refNo ?? '', date: v.date, ready: this.ready(), damaged: {},
      vehicleNo: v.vehicleNo, driverName: v.driverName, driverPhone: v.driverPhone, transporter: v.transporter, biltyNo: v.biltyNo,
    }));
  }

  /** the dispatch needs the vehicle, the driver, the proof and at least one ready container */
  protected send() {
    if (this.dispatching()) {
      const v = this.form.getRawValue();
      const miss = [!v.vehicleNo.trim() && 'the vehicle number', !v.driverName.trim() && 'the driver', !v.driverPhone.trim() && 'the driver\'s phone',
        !this.proofs().length && 'the proof of handover'].filter(Boolean);
      for (const c of ['vehicleNo', 'driverName', 'driverPhone'] as const) {
        this.form.controls[c].setValidators(Validators.required);
        this.form.controls[c].updateValueAndValidity({ emitEvent: false });
      }
      if (miss.length) { this.form.markAllAsTouched(); this.error.set(`Add ${miss.join(', ')}.`); return; }
      if (!this.lines().some((o) => (this.ready()[o.id] ?? 0) > 0)) { this.error.set('Enter the containers loaded for at least one product.'); return; }
    } else {
      for (const c of ['vehicleNo', 'driverName', 'driverPhone'] as const) {
        this.form.controls[c].clearValidators();
        this.form.controls[c].updateValueAndValidity({ emitEvent: false });
      }
    }
    this.submit();
  }

  protected reset() {
    const t = this.order()?.transport;
    this.form.reset({
      stage: this.next()[0] ?? '', note: '', vehicleNo: t?.vehicleNo ?? '', driverName: t?.driverName ?? '', driverPhone: t?.driverPhone ?? '',
      transporter: t?.transporter ?? '', biltyNo: '', date: today(),
    });
    this.ready.set(Object.fromEntries(this.lines().map((o) => [o.id, o.containers - (o.shippedContainers ?? 0)])));
    this.proofs.set([]);
  }

  protected request() {
    const v = this.form.getRawValue();
    const note = v.note.trim();
    if (this.dispatching()) {
      return this.factory.dispatchOrder({
        lines: this.lines().map((o) => ({ orderId: o.id, ready: this.ready()[o.id] ?? 0 })),
        date: v.date, vehicleNo: v.vehicleNo.trim(), driverName: v.driverName.trim(), driverPhone: v.driverPhone.trim(),
        ...(v.transporter.trim() ? { transporter: v.transporter.trim() } : {}), ...(v.biltyNo.trim() ? { biltyNo: v.biltyNo.trim() } : {}),
        ...(note ? { note } : {}), proofIds: this.proofs().map((p) => p.id),
      });
    }
    return this.factory.stageGroup(idsOf(this.order()!, this.group()), { stage: v.stage, ...(note ? { note } : {}) });
  }

  protected successMessage() {
    return this.dispatching() ? 'Dispatched. The distributor has the voucher and is told.' : 'Progress reported.';
  }
}

/** One order in full, read-only: the same details as the left pane of the order panels. */
@Component({
  selector: 'app-order-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, OrderDetail],
  template: `
    <app-offcanvas [(open)]="open" [title]="'Order ' + (refNo() ?? order()?.refNo ?? '')" [subtitle]="order()?.product?.name ?? ''" size="lg">
      <app-order-detail [orderId]="open() ? (orderId() ?? order()?.id) : null" />
    </app-offcanvas>
  `,
})
export class OrderTimeline {
  readonly open = model(false);
  readonly order = input<ProductionOrder | null>(null);
  /** or just the id and number (lists that do not carry the full order) */
  readonly orderId = input<string | null>(null);
  readonly refNo = input<string | null>(null);
}
