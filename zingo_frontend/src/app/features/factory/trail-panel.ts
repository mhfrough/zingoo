import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Tone, fmtAmount, fmtDate, fmtNumber } from '../../shared/format';
import { DataTable, TableColumn } from '../../ui';
import { StatementRow, TrailRow } from './factory.api';

/**
 * Each delivery (container lot) from shipment to cash: shipped, received, sold, still on hand, its cost, the sales
 * booked on it and the money collected.
 */
@Component({
  selector: 'app-trail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTable],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>Batch trail</h2><p>Each delivery from shipment to cash: received, sold, on hand, sales and collected</p></div>
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns()" [rows]="rows()" [totals]="totals()" [loading]="loading()"
          searchPlaceholder="Search deliveries" emptyTitle="No deliveries yet" emptyText="Shipments appear here once a manufacturer sends them." />
      </div>
    </div>
  `,
})
export class TrailPanel {
  readonly rows = input<TrailRow[]>([]);
  readonly loading = input(false);
  /** show the distributor column (staff) */
  readonly showDistributor = input(true);

  protected columns = computed<TableColumn<TrailRow>[]>(() => [
    { id: 'ref', label: 'Delivery', value: (r) => `${r.refNo} · ${r.sku}`, sub: (r) => `${r.orderRef} · ${r.manufacturer}` },
    ...(this.showDistributor()
      ? [{ id: 'to', label: 'Held by', priority: 2, value: (r: TrailRow) => r.distributor ?? 'Warehouse', sub: (r: TrailRow) => (r.sellBy ? `Sell by ${fmtDate(r.sellBy)}` : null) } as TableColumn<TrailRow>]
      : []),
    {
      id: 'flow', label: 'Containers', value: (r) => `${fmtNumber(r.received)} received · ${fmtNumber(r.sold)} sold`,
      sub: (r) => `${fmtNumber(r.shipped)} shipped · ${fmtNumber(r.onHand)} on hand`,
    },
    { id: 'cost', label: 'Cost', kind: 'money', priority: 3, value: (r) => r.cost },
    { id: 'sales', label: 'Sales', kind: 'money', value: (r) => r.sales, sub: (r) => (r.collected ? `Collected ${fmtAmount(r.collected)}` : null) },
    {
      id: 'state', label: 'Status', kind: 'tag', value: (r) => stateOf(r), tone: (r): Tone => (r.overdue ? 'danger' : r.status === 'In transit' ? 'warning' : r.onHand ? 'info' : 'success'),
    },
  ]);
  protected totals = computed(() => {
    const rows = this.rows();
    return rows.length ? {
      ref: 'Total', cost: fmtAmount(rows.reduce((n, r) => n + r.cost, 0)), sales: fmtAmount(rows.reduce((n, r) => n + r.sales, 0)),
    } : undefined;
  });
}

const stateOf = (r: TrailRow) =>
  r.status === 'In transit' ? 'In transit' : r.overdue ? 'Past sell-by' : r.onHand ? 'Selling' : r.receivable > 0.01 ? 'Sold, not paid' : r.sold ? 'Sold and paid' : 'Received';

/** The manufacturer's account: goods received and payments made, with a running balance. */
@Component({
  selector: 'app-mfr-statement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTable],
  template: `
    <div class="card" data-flush>
      <div class="card__head">
        <div><h2>Account statement</h2><p>Goods received (owed to you) and payments made. A negative balance is advance not yet covered by goods</p></div>
      </div>
      <div class="card__body">
        <app-data-table [columns]="columns" [rows]="rows()" [totals]="totals()" [loading]="loading()" [searchable]="false"
          emptyTitle="Nothing yet" emptyText="Payments and goods received appear here." />
      </div>
    </div>
  `,
})
export class MfrStatement {
  readonly rows = input<StatementRow[]>([]);
  readonly loading = input(false);
  protected columns: TableColumn<StatementRow>[] = [
    { id: 'date', label: 'Date', value: (r) => fmtDate(r.date), sub: (r) => r.ref },
    { id: 'what', label: 'Entry', value: (r) => r.kind, sub: (r) => r.description },
    { id: 'owed', label: 'Goods received', kind: 'money', value: (r) => r.owed || null },
    { id: 'paid', label: 'Paid', kind: 'money', value: (r) => r.paid || null },
    { id: 'balance', label: 'Balance', kind: 'money', value: (r) => r.balance },
  ];
  protected totals = computed(() => {
    const rows = this.rows();
    return rows.length ? {
      date: 'Total', owed: fmtAmount(rows.reduce((n, r) => n + r.owed, 0)), paid: fmtAmount(rows.reduce((n, r) => n + r.paid, 0)),
      balance: fmtAmount(rows[rows.length - 1].balance),
    } : undefined;
  });
}
