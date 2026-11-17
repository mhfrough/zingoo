import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { docDate, subLine, Tone, fmtDate, fmtNumber, productLabel, qtyLabel } from '../../shared/format';
import { Btn, DataTable, Field, Offcanvas, RichText, RowAction, RowActionEvent, TableColumn } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FactoryApi, IncomingOrder } from './factory.api';

const today = () => new Date().toISOString().slice(0, 10);

/** The distributor (or staff for it) collects containers of a ready order from the factory. */
@Component({
  selector: 'app-pickup-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="o() ? 'Collect ' + o()!.refNo : 'Collect from factory'" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <div class="notice"><span>The manufacturer and Zen Foods are told. Confirm receipt when the load reaches your warehouse.</span></div>
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Containers collected" [required]="true" [hint]="(o()?.left ?? 0) + ' left at the factory'"
                   [error]="invalid('containers') ? 'Between 1 and ' + (o()?.left ?? 0) : null">
          <input type="number" formControlName="containers" min="1" [max]="o()?.left ?? 1" step="1" />
        </app-field>
        <app-field label="Pickup date" [required]="true"><input type="date" formControlName="date" [min]="o()?.date ?? ''" [max]="maxDate" /></app-field>
        <app-field label="Vehicle no."><input type="text" formControlName="vehicle" maxlength="60" /></app-field>
        <app-field label="Collected by" hint="Driver or person"><input type="text" formControlName="collectedBy" maxlength="60" /></app-field>
        <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="truck" [loading]="busy()">Confirm pickup</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class PickupForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly o = input<IncomingOrder | null>(null);
  readonly formId = 'form-pickup';
  protected maxDate = today();
  readonly form = this.fb.nonNullable.group({
    containers: [1, [Validators.required, Validators.min(1)]],
    date: [today(), Validators.required],
    vehicle: [''],
    collectedBy: [''],
    note: [''],
  });
  protected subject = computed(() => {
    const o = this.o();
    return o ? `${o.product.sku} at ${o.manufacturer.name}` : '';
  });

  protected reset() {
    const left = this.o()?.left ?? 1;
    this.form.controls.containers.setValidators([Validators.required, Validators.min(1), Validators.max(left)]);
    this.form.reset({ containers: left, date: today(), vehicle: '', collectedBy: '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.pickup({
      orderId: this.o()!.id, containers: Number(v.containers), date: v.date,
      ...(v.vehicle.trim() ? { vehicle: v.vehicle.trim() } : {}), ...(v.collectedBy.trim() ? { collectedBy: v.collectedBy.trim() } : {}),
      ...(v.note.trim() ? { note: v.note.trim() } : {}),
    });
  }

  protected successMessage() {
    return 'Pickup recorded. Confirm receipt when it reaches your warehouse.';
  }
}

/**
 * Orders on their way to a distributor: waiting for the manufacturer, in production (with the ready date it gave),
 * and ready at the factory. A ready order can be collected by the distributor; otherwise the manufacturer dispatches it.
 */
@Component({
  selector: 'app-incoming-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTable, PickupForm],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>{{ showDistributor() ? 'Orders on the way to distributors' : 'Coming from the manufacturer' }}</h2>
          <p>Production orders for {{ showDistributor() ? 'distributors' : 'you' }}: accepted, in production, or ready to collect at the factory</p></div>
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="orders()" [actions]="actions" [loading]="loading()" [error]="error()" [searchable]="false"
          emptyTitle="Nothing on order" emptyText="Orders placed with the manufacturer for you appear here." (retry)="changed.emit()" (action)="onAction($event)" />
      </div>
    </div>
    <app-pickup-form [(open)]="pickupOpen" [o]="current()" (saved)="changed.emit()" />
  `,
})
export class IncomingPanel {
  readonly orders = input<IncomingOrder[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** may collect ready orders (the distributor, or Admin / Distribution for it) */
  readonly canPickup = input(false);
  readonly showDistributor = input(false);
  readonly changed = output<void>();

  protected pickupOpen = signal(false);
  protected current = signal<IncomingOrder | null>(null);

  private state = (o: IncomingOrder): [string, Tone] => {
    if (o.status === 'Sent') return ['Waiting', 'warning'];
    if (o.ready) return [o.shippedContainers ? `Ready · ${o.left} left` : 'Ready to collect', 'success'];
    return [o.stage ?? 'Accepted', 'info'];
  };

  protected columns = computed<TableColumn<IncomingOrder>[]>(() => [
    {
      id: 'product', label: this.showDistributor() ? 'Order / Distributor' : 'Order / Manufacturer', kind: 'title', value: (o) => productLabel(o.product),
      sub: (o) => (this.showDistributor() ? o.distributor?.name ?? '' : o.manufacturer.name),
    },
    {
      id: 'ref', label: 'Order no. / quantity', kind: 'mono', value: (o) => o.refNo, sortValue: (o) => o.date,
      sub: (o) => subLine(docDate(o), qtyLabel(o.containers, o.containers * o.bundlesPerContainer), o.shippedContainers ? `${fmtNumber(o.shippedContainers)} sent` : null),
    },
    {
      id: 'from', label: this.showDistributor() ? 'Route' : 'Manufacturer', priority: 2,
      value: (o) => (this.showDistributor() ? o.distributor?.name ?? '' : o.manufacturer.name),
      sub: (o) => (this.showDistributor() ? `from ${o.manufacturer.name}` : null),
    },
    {
      id: 'ready', label: 'Ready by', kind: 'date', priority: 2, value: (o) => o.readyDate,
      sub: (o) => (o.dueDate ? `Due ${fmtDate(o.dueDate)}` : null),
    },
    { id: 'status', label: 'Status', kind: 'tag', value: (o) => this.state(o)[0], tone: (o) => this.state(o)[1] },
  ]);

  protected actions = (o: IncomingOrder): RowAction[] => (this.canPickup() && o.ready ? [{ id: 'pickup', label: 'Confirm pickup', tone: 'success' }] : []);

  protected onAction(e: RowActionEvent<IncomingOrder>) {
    this.current.set(e.row);
    if (e.id === 'pickup') this.pickupOpen.set(true);
  }
}
