import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Tone, fmtDate, fmtNumber } from '../../shared/format';
import { Btn, DataTable, Field, Offcanvas, RowAction, RowActionEvent, Select, SelectOption, TableColumn } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { DistDispatch, FactoryApi, Shipment } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);

/** bundles of a received delivery that can still go out: arrived in good order, less dispatches not returned */
const bundlesLeft = (s: Shipment, dispatches: DistDispatch[]) =>
  (s.receivedContainers ?? 0) * s.bundlesPerContainer
  - dispatches.filter((d) => d.shipmentId === s.id && d.status !== 'Returned').reduce((n, d) => n + d.bundles, 0);

/** The distributor (or staff for it) sends bundles of a received delivery to one of its customers. */
@Component({
  selector: 'app-dispatch-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Dispatch to a customer" subtitle="Goods leaving your warehouse for a shop, wholesaler or sub-distributor." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="From delivery (batch)" [wide]="true" [required]="true" [error]="invalid('shipmentId') ? 'Choose a delivery' : null">
          <app-select formControlName="shipmentId" [options]="lotOptions()" placeholder="Choose a delivery" [clearable]="false" />
        </app-field>
        <app-field label="Bundles" [required]="true" [hint]="left() + ' bundles available'" [error]="invalid('bundles') ? 'Between 1 and ' + left() : null">
          <input type="number" formControlName="bundles" min="1" [max]="left()" step="1" />
        </app-field>
        <app-field label="Dispatch date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Customer" [required]="true" [error]="invalid('customer') ? 'Who is it for?' : null">
          <input type="text" formControlName="customer" maxlength="120" />
        </app-field>
        <app-field label="Area / route"><input type="text" formControlName="area" maxlength="120" /></app-field>
        <app-field label="Vehicle no."><input type="text" formControlName="vehicle" maxlength="60" /></app-field>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="truck" [loading]="busy()">Dispatch</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class DispatchForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly shipments = input<Shipment[]>([]);
  readonly dispatches = input<DistDispatch[]>([]);
  readonly formId = 'form-dist-dispatch';
  protected maxDate = today();

  readonly form = this.fb.nonNullable.group({
    shipmentId: ['', Validators.required],
    bundles: [1, [Validators.required, Validators.min(1)]],
    date: [today(), Validators.required],
    customer: ['', [Validators.required, Validators.maxLength(120)]],
    area: [''],
    vehicle: [''],
    note: [''],
  });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  private lots = computed(() => this.shipments()
    .filter((s) => s.status === 'Received' && s.destination === 'Distributor' && bundlesLeft(s, this.dispatches()) > 0));
  protected lotOptions = computed<SelectOption<string>[]>(() => this.lots().map((s) => ({
    value: s.id, label: `${s.refNo} · ${s.product.sku}`, sub: `${fmtNumber(bundlesLeft(s, this.dispatches()))} bundles available · received ${fmtDate(s.receivedDate)}`,
  })));
  protected left = computed(() => {
    const s = this.lots().find((x) => x.id === this.value().shipmentId);
    return s ? bundlesLeft(s, this.dispatches()) : 0;
  });

  constructor() {
    super();
    this.form.controls.shipmentId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => queueMicrotask(() => {
      const c = this.form.controls.bundles;
      c.setValidators([Validators.required, Validators.min(1), Validators.max(Math.max(1, this.left()))]);
      c.updateValueAndValidity();
    }));
  }

  protected reset() {
    this.form.reset({ shipmentId: this.lots()[0]?.id ?? '', bundles: 1, date: today(), customer: '', area: '', vehicle: '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.dispatch({
      shipmentId: v.shipmentId, bundles: Number(v.bundles), date: v.date, customer: v.customer.trim(),
      ...(v.area.trim() ? { area: v.area.trim() } : {}), ...(v.vehicle.trim() ? { vehicle: v.vehicle.trim() } : {}),
      ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Dispatch recorded. Mark it delivered when the customer has it.';
  }
}

/** The dispatch reached the customer, or came back (a return needs a reason). */
@Component({
  selector: 'app-close-dispatch-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="(outcome() === 'Returned' ? 'Returned: ' : 'Delivered: ') + (d()?.refNo ?? '')" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field [label]="outcome() === 'Returned' ? 'Date it came back' : 'Date delivered'" [wide]="true" [required]="true">
          <input type="date" formControlName="date" [min]="d()?.date ?? ''" [max]="maxDate" />
        </app-field>
        <app-field [label]="outcome() === 'Returned' ? 'Why it came back' : 'Note'" [wide]="true" [required]="outcome() === 'Returned'"
                   [error]="invalid('note') ? 'Say why it came back' : null">
          <textarea formControlName="note" rows="2" maxlength="500"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">{{ outcome() === 'Returned' ? 'Record return' : 'Mark delivered' }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class CloseDispatchForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly d = input<DistDispatch | null>(null);
  readonly outcome = input<'Delivered' | 'Returned'>('Delivered');
  readonly formId = 'form-close-dispatch';
  protected maxDate = today();
  readonly form = this.fb.nonNullable.group({ date: [today(), Validators.required], note: [''] });
  protected subject = computed(() => {
    const d = this.d();
    return d ? `${fmtNumber(d.bundles)} bundles of ${d.product.sku} for ${d.customer}` : '';
  });

  protected reset() {
    this.form.controls.note.setValidators(this.outcome() === 'Returned' ? [Validators.required] : []);
    this.form.reset({ date: today(), note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    const note = v.note.trim();
    return this.factory.closeDispatch(this.d()!.id, this.outcome() === 'Returned'
      ? { outcome: 'Returned', date: v.date, note }
      : { outcome: 'Delivered', date: v.date, ...(note ? { deliveredNote: note } : {}) });
  }

  protected successMessage() {
    return this.outcome() === 'Returned' ? 'Return recorded. The bundles can go out again.' : 'Marked delivered.';
  }
}

const TONE: Record<DistDispatch['status'], Tone> = { Dispatched: 'warning', Delivered: 'success', Returned: 'danger' };

/** What a distributor sent to its own customers and whether it arrived. Zen Foods sees the same. */
@Component({
  selector: 'app-dispatches-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, DispatchForm, CloseDispatchForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>Dispatches to customers</h2><p>Goods sent out of received deliveries to shops, wholesalers and sub-distributors</p></div>
        @if (canDispatch()) {
          <button appBtn variant="primary" icon="truck" (click)="formOpen.set(true)" [disabled]="!hasStock()">Dispatch</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="dispatches()" [actions]="actions" [loading]="loading()" [error]="error()"
          searchPlaceholder="Search dispatches" emptyTitle="No dispatches yet" emptyText="Record goods as they leave for a customer." (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>
    <app-dispatch-form [(open)]="formOpen" [shipments]="shipments()" [dispatches]="dispatches()" (saved)="changed.emit()" />
    <app-close-dispatch-form [(open)]="closeOpen" [d]="current()" [outcome]="outcome()" (saved)="changed.emit()" />
  `,
})
export class DispatchesPanel {
  readonly dispatches = input<DistDispatch[]>([]);
  /** the distributor's deliveries (received ones can be dispatched from) */
  readonly shipments = input<Shipment[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly canDispatch = input(false);
  readonly showDistributor = input(false);
  readonly changed = output<void>();

  protected formOpen = signal(false);
  protected closeOpen = signal(false);
  protected current = signal<DistDispatch | null>(null);
  protected outcome = signal<'Delivered' | 'Returned'>('Delivered');
  protected hasStock = computed(() => this.shipments().some((s) => s.status === 'Received' && s.destination === 'Distributor' && bundlesLeft(s, this.dispatches()) > 0));

  protected columns = computed<TableColumn<DistDispatch>[]>(() => [
    { id: 'ref', label: 'Dispatch', value: (d) => d.refNo, sub: (d) => `${fmtDate(d.date)} · from ${d.shipment.refNo}` },
    { id: 'goods', label: 'Goods', value: (d) => `${fmtNumber(d.bundles)} bundles`, sub: (d) => d.product.sku },
    {
      id: 'to', label: 'Customer', value: (d) => d.customer, priority: 2,
      sub: (d) => [this.showDistributor() ? `by ${d.distributor.name}` : null, d.area, d.vehicle].filter(Boolean).join(' · ') || null,
    },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (d) => d.status, tone: (d) => TONE[d.status],
      sub: (d) => (d.closedDate ? [fmtDate(d.closedDate), d.closedNote].filter(Boolean).join(' · ') : null),
    },
  ]);

  protected actions = (d: DistDispatch): RowAction[] => (this.canDispatch() && d.status === 'Dispatched'
    ? [{ id: 'Delivered', label: 'Delivered', tone: 'success' }, { id: 'Returned', label: 'Came back', tone: 'danger' }] : []);

  protected onAction(e: RowActionEvent<DistDispatch>) {
    this.current.set(e.row);
    this.outcome.set(e.id as 'Delivered' | 'Returned');
    this.closeOpen.set(true);
  }
}
