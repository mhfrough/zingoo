import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Tone, fmtAmount, fmtDate, fmtMoney, fmtNumber, productLabel } from '../../shared/format';
import { Btn, DataTable, EmptyState, IconComponent, Kpi, PageHeader, TableColumn, Tag } from '../../ui';
import { Alert, Dashboard } from '../ops/models';
import { OpsApi } from '../ops/ops.api';
import { FactoryApi } from '../factory/factory.api';
import { Chain } from './chain';
import { SettingsStore } from '../../core/settings.store';
import { ManufacturerForm } from '../settings/manufacturer-form';

type LatestOrder = Dashboard['latestOrders'][number];

/** where a distributor order stands: waiting for Zingo, with the manufacturer, in production, declined */
const latestState = (o: LatestOrder): [string, Tone] => {
  const p = o.productionOrder;
  if (!p) return o.status === 'Requested' ? ['Waiting for Zingo', 'warning'] : [o.status, o.status === 'Rejected' ? 'danger' : 'neutral'];
  if (p.status === 'Sent') return ['With the manufacturer', 'warning'];
  if (p.status === 'Accepted') return [p.stage ?? 'In production', 'info'];
  if (p.status === 'Rejected') return ['Manufacturer declined', 'danger'];
  if (p.status === 'Cancelled') return ['Cancelled', 'danger'];
  return [p.status, 'neutral'];
};

const ALERT_ICON = {
  approval: 'lock', stock: 'boxes', order: 'truck', batch: 'factory', cheque: 'banknote', return: 'clock',
  production: 'factory', payment: 'banknote', delivery: 'truck', sellout: 'clock', invoice: 'receipt', receivable: 'wallet',
} as const;

@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Btn, DataTable, EmptyState, IconComponent, Kpi, PageHeader, Tag, Chain, ManufacturerForm],
  templateUrl: './overview.html',
  styleUrl: './overview.css',
})
export class Overview {
  private api = inject(OpsApi);
  protected auth = inject(AuthService);

  protected data = rxResource({ stream: () => this.api.dashboard() });
  /** live figures of investor -> company -> manufacturer -> distributor -> customer */
  private factory = inject(FactoryApi);
  /** the earlier sales-order flow is switched on in Settings */
  private store = inject(SettingsStore);
  protected legacy = computed(() => !!this.store.settings()?.salesOrdersEnabled);
  protected chain = rxResource({ stream: () => this.factory.chain() });

  protected d = computed(() => this.data.value());
  /** Admin: add a manufacturer here (the same form as Settings & Data) */
  protected manufacturerOpen = signal(false);
  protected alerts = computed(() => this.d()?.alerts.slice(0, 6) ?? []);
  protected raisedPct = computed(() => {
    const d = this.d();
    return d ? Math.min(100, Math.round((d.capitalRaised / Math.max(1, d.capitalTarget)) * 100)) : 0;
  });

  protected money = fmtMoney;
  protected amount = fmtAmount;
  protected number = fmtNumber;
  protected alertIcon = (a: Alert) => ALERT_ICON[a.kind];

  protected orderColumns: TableColumn<LatestOrder>[] = [
    { id: 'order', label: 'Order / Distributor', kind: 'title', value: (o) => productLabel(o), sub: (o) => o.distributor },
    { id: 'ref', label: 'Order no. / bundles', kind: 'mono', value: (o) => o.refNo, sub: (o) => `${fmtDate(o.date)} · ${fmtNumber(o.cartons)} bundles`, priority: 2 },
    { id: 'mfr', label: 'Manufacturer', value: (o) => o.productionOrder?.manufacturer ?? '-', sub: (o) => o.productionOrder?.refNo ?? null, priority: 2 },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (o) => latestState(o)[0], tone: (o) => latestState(o)[1],
      sub: (o) => (o.productionOrder?.readyDate ? `Ready ${fmtDate(o.productionOrder.readyDate)}` : null),
    },
  ];
}
