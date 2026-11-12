import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Tone, fmtAmount, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, DataTable, EmptyState, IconComponent, Kpi, PageHeader, TableColumn, Tag } from '../../ui';
import { Alert, Dashboard } from '../ops/models';
import { OpsApi } from '../ops/ops.api';

type LatestOrder = Dashboard['latestOrders'][number];

const ALERT_ICON = { approval: 'lock', stock: 'boxes', order: 'truck', batch: 'factory', cheque: 'banknote', return: 'clock' } as const;

@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Btn, DataTable, EmptyState, IconComponent, Kpi, PageHeader, Tag],
  templateUrl: './overview.html',
  styleUrl: './overview.css',
})
export class Overview {
  private api = inject(OpsApi);
  protected auth = inject(AuthService);

  protected data = rxResource({ stream: () => this.api.dashboard() });

  protected d = computed(() => this.data.value());
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
    { id: 'order', label: 'Order', value: (o) => o.refNo, sub: (o) => fmtDate(o.date) },
    { id: 'distributor', label: 'Distributor', value: (o) => o.distributor, sub: (o) => o.sku },
    { id: 'cartons', label: 'Bundles', kind: 'number', value: (o) => o.cartons, priority: 3 },
    { id: 'value', label: 'Value (PKR)', kind: 'money', value: (o) => o.value },
    {
      id: 'status', label: 'Status', kind: 'tag', value: (o) => o.status, priority: 2,
      tone: (o): Tone => (o.status === 'Dispatched' ? 'success' : 'warning'),
    },
  ];
}
