import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Tone, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, DataTable, Field, Offcanvas, RowAction, RowActionEvent, Select, SelectOption, TableColumn } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { DistributorStock, DistributorStockRow, FactoryApi, ProductionOrder, Shipment } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);

/** where a shipment goes */
const destinationOf = (s: { destination: string; distributor: { name: string } | null }) =>
  s.destination === 'Warehouse' ? 'Zen Foods warehouse' : s.distributor?.name ?? 'distributor';

/** The manufacturer (or staff for it) sends containers of an accepted order to its distributor or the warehouse. */
@Component({
  selector: 'app-ship-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, Select],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Ship containers" subtitle="Send finished containers of an accepted order." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Order" [wide]="true" [required]="true" [error]="invalid('orderId') ? 'Choose an order' : null">
          <app-select formControlName="orderId" [options]="orderOptions()" placeholder="Choose an order" [clearable]="false" />
        </app-field>
        @if (picked(); as o) {
          <div class="notice" style="grid-column: 1 / -1">
            <span>Goes to <strong>{{ o.destination === 'Warehouse' ? 'Zen Foods warehouse' : o.distributor?.name }}</strong> ·
              {{ left() }} of {{ o.containers }} container{{ o.containers > 1 ? 's' : '' }} still to ship</span>
          </div>
        }
        <app-field label="Containers" [required]="true" [error]="invalid('containers') ? 'At least 1' : null">
          <input type="number" formControlName="containers" min="1" [max]="left()" step="1" />
        </app-field>
        <app-field label="Ship date" [required]="true"><input type="date" formControlName="date" [max]="maxDate" /></app-field>
        <app-field label="Vehicle / container no."><input type="text" formControlName="vehicle" maxlength="60" /></app-field>
        <app-field label="Waybill / bilty no."><input type="text" formControlName="waybill" maxlength="60" /></app-field>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="truck" [loading]="busy()">Ship containers</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ShipForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly orders = input<ProductionOrder[]>([]);
  readonly formId = 'form-ship';
  protected maxDate = today();

  readonly form = this.fb.nonNullable.group({
    orderId: ['', Validators.required],
    containers: [1, [Validators.required, Validators.min(1)]],
    date: [today(), Validators.required],
    vehicle: [''],
    waybill: [''],
    note: [''],
  });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** accepted orders with containers still to ship */
  private open$ = computed(() => this.orders().filter((o) => o.status === 'Accepted' && o.shippedContainers < o.containers));
  protected orderOptions = computed<SelectOption<string>[]>(() => this.open$().map((o) => ({
    value: o.id, label: `${o.refNo} · ${o.product.sku}`, sub: `${o.containers - o.shippedContainers} left · to ${destinationOf(o)}`,
  })));
  protected picked = computed(() => this.orders().find((o) => o.id === this.value().orderId) ?? null);
  protected left = computed(() => (this.picked() ? this.picked()!.containers - this.picked()!.shippedContainers : 0));

  constructor() {
    super();
    this.form.controls.orderId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => queueMicrotask(() => this.form.controls.containers.setValue(Math.max(1, this.left()))));
  }

  protected reset() {
    this.form.reset({ orderId: this.open$()[0]?.id ?? '', containers: 1, date: today(), vehicle: '', waybill: '', note: '' });
    queueMicrotask(() => this.form.controls.containers.setValue(Math.max(1, this.left())));
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.ship({
      orderId: v.orderId, containers: Number(v.containers), date: v.date,
      ...(v.vehicle.trim() ? { vehicle: v.vehicle.trim() } : {}), ...(v.waybill.trim() ? { waybill: v.waybill.trim() } : {}),
      ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Shipment sent. The receiver confirms it on arrival.';
  }
}

/** The distributor (or the warehouse) confirms what arrived. Fewer than sent needs a note. */
@Component({
  selector: 'app-receive-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="s() ? 'Receive ' + s()!.refNo : 'Receive shipment'" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Containers received in good order" [wide]="true" [required]="true" [hint]="'Sent: ' + (s()?.containers ?? 0)">
          <input type="number" formControlName="receivedContainers" min="0" [max]="s()?.containers ?? 0" step="1" />
        </app-field>
        <app-field label="Date received" [wide]="true" [required]="true"><input type="date" formControlName="date" [min]="s()?.shipDate ?? ''" [max]="maxDate" /></app-field>
        <app-field label="Note" [wide]="true" [required]="short()" [hint]="short() ? 'Say what was short or damaged' : ''"
                   [error]="short() && invalid('note') ? 'Say what was short or damaged' : null">
          <textarea formControlName="note" rows="2" maxlength="500"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Confirm receipt</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class ReceiveForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly s = input<Shipment | null>(null);
  readonly formId = 'form-receive';
  protected maxDate = today();
  readonly form = this.fb.nonNullable.group({ receivedContainers: [0, [Validators.required, Validators.min(0)]], date: [today(), Validators.required], note: [''] });
  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected short = computed(() => Number(this.value().receivedContainers ?? 0) < (this.s()?.containers ?? 0));
  protected subject = computed(() => {
    const s = this.s();
    return s ? `${fmtNumber(s.containers)} × ${s.product.sku} from ${s.manufacturer.name}` : '';
  });

  constructor() {
    super();
    this.form.controls.receivedContainers.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const c = this.form.controls.note;
      c.setValidators(this.short() ? Validators.required : null);
      c.updateValueAndValidity({ emitEvent: false });
    });
  }

  protected reset() {
    this.form.reset({ receivedContainers: this.s()?.containers ?? 0, date: today(), note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.receive(this.s()!.id, { receivedContainers: Number(v.receivedContainers), date: v.date, ...(v.note.trim() ? { note: v.note.trim() } : {}) });
  }

  protected successMessage() {
    return 'Receipt confirmed. The stock and what is owed are updated.';
  }
}

/**
 * Shipments and the stock they become, for every side:
 * - `factory`: the manufacturer ships containers and follows them;
 * - `distributor`: the distributor receives them and sees the Zen Foods stock it holds, with sell-by dates;
 * - `company`: staff see everything, may ship for a manufacturer and receive for a distributor or the warehouse.
 */
@Component({
  selector: 'app-shipments-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, DataTable, ShipForm, ReceiveForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div>
          <h2>{{ mode() === 'distributor' ? 'Deliveries from the manufacturer' : 'Shipments' }}</h2>
          <p>{{ mode() === 'distributor'
            ? 'Confirm what arrived. The goods stay Zen Foods stock until you sell them'
            : 'Containers sent to distributors or the warehouse, and what arrived' }}</p>
        </div>
        @if (canShip()) {
          <button appBtn variant="primary" icon="truck" (click)="shipOpen.set(true)" [disabled]="!shippable()">Ship containers</button>
        }
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="shipments()" [actions]="actions" [loading]="loading()" [error]="error()"
          searchPlaceholder="Search shipments" emptyTitle="No shipments yet" [emptyText]="emptyText()" (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>

    @if (mode() !== 'factory') {
      <div class="card" data-flush>
        <div class="card__head">
          <div><h2>{{ mode() === 'distributor' ? 'Zen Foods stock with you' : 'Stock held by distributors' }}</h2>
            <p>Consignment: received and not yet sold, valued at the manufacturer's price, with the date to sell it by</p></div>
        </div>
        <div class="card__body">
          <app-data-table [columns]="stockColumns()" [rows]="stock()?.byProduct ?? []" [totals]="stockTotals()" [loading]="loading()" [searchable]="false"
            emptyTitle="No stock held" emptyText="Received deliveries appear here until they are sold." />
        </div>
      </div>
    }

    <app-ship-form [(open)]="shipOpen" [orders]="orders()" (saved)="changed.emit()" />
    <app-receive-form [(open)]="receiveOpen" [s]="current()" (saved)="changed.emit()" />
  `,
})
export class ShipmentsPanel {
  readonly mode = input<'company' | 'factory' | 'distributor'>('company');
  readonly shipments = input<Shipment[]>([]);
  readonly stock = input<DistributorStock | null>(null);
  /** orders that can be shipped from (factory and company) */
  readonly orders = input<ProductionOrder[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly canShip = input(false);
  readonly canReceive = input(false);
  /** may receive warehouse deliveries (Admin, Manufacturing) */
  readonly canReceiveWarehouse = input(false);
  readonly changed = output<void>();

  protected shipOpen = signal(false);
  protected receiveOpen = signal(false);
  protected current = signal<Shipment | null>(null);
  protected shippable = computed(() => this.orders().some((o) => o.status === 'Accepted' && o.shippedContainers < o.containers));
  protected emptyText = computed(() => (this.mode() === 'factory' ? 'Ship an accepted order when it is ready.' : 'Shipments from the manufacturer appear here.'));

  protected columns = computed<TableColumn<Shipment>[]>(() => [
    { id: 'ref', label: 'Shipment', value: (s) => s.refNo, sub: (s) => `Sent ${fmtDate(s.shipDate)}${s.waybill ? ` · ${s.waybill}` : ''}` },
    { id: 'product', label: 'Product', value: (s) => `${fmtNumber(s.containers)} × ${s.product.sku}`, sub: (s) => `${fmtNumber(s.packets)} packets · ${s.order.refNo}` },
    {
      id: 'route', label: this.mode() === 'distributor' ? 'From' : 'Route', priority: 2,
      value: (s) => (this.mode() === 'distributor' ? s.manufacturer.name : destinationOf(s)),
      sub: (s) => (this.mode() === 'company' ? `from ${s.manufacturer.name}` : s.vehicle),
    },
    { id: 'value', label: 'Value', kind: 'money', priority: 2, value: (s) => (s.status === 'Received' ? s.receivedValue : s.value) },
    {
      id: 'status', label: 'Status', kind: 'tag', tone: (s): Tone => (s.status === 'In transit' ? 'warning' : s.overdue ? 'danger' : 'success'),
      value: (s) => (s.status === 'In transit' ? 'In transit' : s.receivedContainers === s.containers ? 'Received' : `Received ${s.receivedContainers}/${s.containers}`),
      sub: (s) => (s.soldContainers ? `${s.soldContainers} sold · ` : '') + (s.sellBy ? `Sell by ${fmtDate(s.sellBy)}${s.daysLeft !== null && s.onHandContainers ? ` · ${s.daysLeft < 0 ? `${-s.daysLeft} days late` : `${s.daysLeft} days left`}` : ''}` : s.receiptNote ?? ''),
    },
  ]);

  protected actions = (s: Shipment): RowAction[] => {
    if (s.status !== 'In transit') return [];
    const ok = s.destination === 'Warehouse' ? this.canReceiveWarehouse() : this.canReceive();
    return ok ? [{ id: 'receive', label: this.mode() === 'company' ? 'Receive for the receiver' : 'Confirm receipt', tone: 'success' }] : [];
  };

  protected stockColumns = computed<TableColumn<DistributorStockRow>[]>(() => [
    { id: 'sku', label: 'Product', value: (r) => r.sku, sub: (r) => (this.mode() === 'company' ? `${r.name} · ${r.distributor}` : r.name) },
    { id: 'containers', label: 'Containers', kind: 'number', value: (r) => r.containers, sub: (r) => `${fmtNumber(r.bundles)} bundles · ${fmtNumber(r.packets)} packets` },
    { id: 'value', label: 'Value at cost', kind: 'money', value: (r) => r.value, priority: 2 },
    {
      id: 'sellBy', label: 'Sell by', kind: 'tag', value: (r) => (r.nextSellBy ? fmtDate(r.nextSellBy) : '-'),
      tone: (r): Tone => (r.overdue ? 'danger' : 'info'), sub: (r) => (r.overdue ? 'Past the sell-out date' : null),
    },
  ]);
  protected stockTotals = computed(() => {
    const rows = this.stock()?.byProduct ?? [];
    return rows.length ? { sku: 'Total', containers: fmtNumber(rows.reduce((n, r) => n + r.containers, 0)), value: fmtMoney(rows.reduce((n, r) => n + r.value, 0)) } : undefined;
  });

  protected onAction(e: RowActionEvent<Shipment>) {
    this.current.set(e.row);
    if (e.id === 'receive') this.receiveOpen.set(true);
  }
}
