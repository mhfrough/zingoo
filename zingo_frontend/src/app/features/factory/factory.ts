import { recall, remember } from '../../shared/remember';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { fmtMoney, fmtNumber } from '../../shared/format';
import { Kpi, PageHeader, SelectOption, TabItem, TabPanel, Tabs, ViewAs } from '../../ui';
import { OpsApi } from '../ops/ops.api';
import { FactoryApi } from './factory.api';
import { OrdersPanel } from './orders-panel';
import { RequestsPanel } from './requests-panel';
import { ShipmentsPanel } from './shipments-panel';
import { DeliveryClaimsPanel } from './delivery-claims-panel';
import { MfrStatement } from './trail-panel';

/**
 * Manufacturer portal. A Manufacturer login sees only its own orders: it accepts or rejects each one and reports
 * every production step, and Zen Foods sees the progress at once. Staff open the same page to look at (or answer
 * for) any manufacturer.
 */
@Component({
  selector: 'app-factory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Kpi, PageHeader, ViewAs, Tabs, TabPanel, OrdersPanel, RequestsPanel, ShipmentsPanel, DeliveryClaimsPanel, MfrStatement],
  styles: `
    .terms {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
      gap: var(--space-3) var(--space-5);
      margin: 0;

      & dt {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & dd {
        margin: var(--space-1) 0 0;
      }
    }

  `,
  template: `
    <app-page-header eyebrow="Zingoo · Manufacturer portal" [title]="profile.value()?.manufacturer?.name ?? 'Manufacturer portal'"
      description="Orders from Zen Foods: accept or reject them, then report each production step." />

    <div class="stack">
      @if (!isManufacturer()) {
        <app-view-as kind="Manufacturer" icon="factory" [options]="manufacturerOptions()"
          [value]="picked() ?? profile.value()?.manufacturer?.id" (valueChange)="pickManufacturer($event)" />
      }

      <div class="grid-auto">
        <app-kpi label="Waiting for your answer" [value]="num(profile.value()?.waiting ?? 0)" icon="clock" tone="warning" foot="Accept or reject" />
        <app-kpi label="In production" [value]="num(profile.value()?.inProduction ?? 0)" icon="factory" tone="info"
          [foot]="num(profile.value()?.containersInProduction ?? 0) + ' containers'" />
        <app-kpi label="Completed orders" [value]="num(completed().length)" icon="check" tone="success"
          [foot]="num(completedContainers()) + ' containers dispatched'" />
        <app-kpi label="Payments received" [value]="money(position.value()?.totals?.paid ?? 0)" icon="coins" tone="success"
          [foot]="'Still to receive ' + money(position.value()?.totals?.toPay ?? 0)" />
        <app-kpi label="Invoices sent" [value]="num(invoices().length)" icon="file" tone="accent"
          [foot]="money(invoicedAmount()) + ' invoiced'" />
      </div>

      <app-tabs [tabs]="tabs()" [(active)]="tab" ariaLabel="Manufacturer portal sections">
        <ng-template appTabPanel="orders">
          <app-orders-panel mode="factory" [orders]="visibleOrders()" [loading]="orders.isLoading()"
            [error]="orders.error() ? 'The server did not answer.' : null" [stages]="profile.value()?.stages ?? []"
            [canAnswer]="canAnswer()" [requests]="requests.value() ?? []" [position]="position.value() ?? null"
            [manufacturer]="profile.value()?.manufacturer ?? null" (changed)="reload()" />
        </ng-template>
        <ng-template appTabPanel="deliveries">
          <app-shipments-panel mode="factory" [shipments]="shipments.value() ?? []" [orders]="orders.value() ?? []"
            [loading]="shipments.isLoading()" [error]="shipments.error() ? 'The server did not answer.' : null"
            [canShip]="canAnswer()" (changed)="reload()" />
        </ng-template>
        <ng-template appTabPanel="claims">
          <app-delivery-claims-panel mode="factory" [manufacturerId]="isManufacturer() ? null : (profile.value()?.manufacturer?.id ?? null)"
            [tick]="tick()" [canDecide]="canAnswer()" (changed)="reload()" />
        </ng-template>
        <ng-template appTabPanel="payments">
          <app-requests-panel mode="factory" [requests]="requests.value() ?? []" [position]="position.value() ?? null"
            [loading]="requests.isLoading()" [error]="requests.error() ? 'The server did not answer.' : null"
            [manufacturer]="profile.value()?.manufacturer ?? null" [canRequest]="canAnswer()" (changed)="reload()" />
        </ng-template>
        <ng-template appTabPanel="statement">
          <app-mfr-statement [rows]="statement.value()?.entries ?? []" [loading]="statement.isLoading()" />
        </ng-template>
      </app-tabs>
    </div>
  `,
})
export class Factory {
  private api = inject(FactoryApi);
  private ops = inject(OpsApi);
  private auth = inject(AuthService);

  protected isManufacturer = computed(() => this.auth.user()?.role === 'Manufacturer');
  /** the manufacturer itself, or staff who may write production data */
  protected canAnswer = computed(() => this.isManufacturer() || this.auth.can('manufacturing'));

  protected tick = signal(0);
  /** staff: the manufacturer picked in the selector (empty = the first one); kept in this browser */
  protected picked = signal<string | null>(recall('factory-manufacturer'));

  protected pickManufacturer(id: string | null | undefined) {
    this.picked.set(id ?? null);
    remember('factory-manufacturer', id);
  }

  protected profile = rxResource({
    params: () => ({ t: this.tick(), m: this.picked() }),
    stream: ({ params }) => this.api.profile(params.m ?? undefined),
  });
  protected orders = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.orders(params.m) : of([])),
  });
  protected shipments = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.shipments({ manufacturerId: params.m }) : of([])),
  });
  protected statement = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.statement(params.m) : of(null)),
  });
  protected requests = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.requests(params.m) : of([])),
  });
  protected position = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.position(params.m) : of(null)),
  });
  /** what the manufacturer sees: never the company's drafts (staff looking at the portal see the same) */
  protected visibleOrders = computed(() => (this.orders.value() ?? []).filter((o) => o.status !== 'Draft'));
  private manufacturers = rxResource({
    params: () => (this.isManufacturer() ? undefined : true),
    stream: () => this.ops.manufacturers(),
  });
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    (this.manufacturers.value() ?? []).map((m) => ({ value: m.id, label: m.name, sub: m.poc || m.contact || undefined })));

  protected num = fmtNumber;
  protected money = fmtMoney;

  // ───────── counters and sections ─────────
  /** orders whose goods all left the factory (Ready to dispatch done, or everything delivered) */
  protected completed = computed(() => this.visibleOrders().filter((o) => o.status === 'Accepted'
    && ((o.readyContainers != null && o.shippedContainers >= o.readyContainers) || o.receivedContainers >= o.containers)));
  protected completedContainers = computed(() => this.completed().reduce((n, o) => n + (o.shippedContainers || o.receivedContainers), 0));
  /** invoices (payment requests) sent to Zen Foods, rejected ones left out */
  protected invoices = computed(() => (this.requests.value() ?? []).filter((r) => r.status !== 'Rejected'));
  protected invoicedAmount = computed(() => this.invoices().reduce((n, r) => n + Number(r.amount), 0));
  protected tab = signal('orders');
  protected tabs = computed<TabItem[]>(() => [
    { id: 'orders', label: 'Orders', icon: 'package', count: this.profile.value()?.waiting || null },
    { id: 'deliveries', label: 'Deliveries', icon: 'truck' },
    { id: 'claims', label: 'Faulty goods claims', icon: 'alert' },
    { id: 'payments', label: 'Invoices & payments', icon: 'banknote', count: this.invoices().length || null },
    { id: 'statement', label: 'Statement', icon: 'file' },
  ]);

  protected reload() {
    this.tick.update((n) => n + 1);
  }
}
