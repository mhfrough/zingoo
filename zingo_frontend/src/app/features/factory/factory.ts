import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { fmtMoney, fmtNumber } from '../../shared/format';
import { Field, Kpi, PageHeader, Select, SelectOption } from '../../ui';
import { OpsApi } from '../ops/ops.api';
import { FactoryApi } from './factory.api';
import { OrdersPanel } from './orders-panel';
import { RequestsPanel } from './requests-panel';

/**
 * Manufacturer portal. A Manufacturer login sees only its own orders: it accepts or rejects each one and reports
 * every production step, and Zen Foods sees the progress at once. Staff open the same page to look at (or answer
 * for) any manufacturer.
 */
@Component({
  selector: 'app-factory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Field, Kpi, PageHeader, Select, OrdersPanel, RequestsPanel],
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

    .picker {
      max-inline-size: 24rem;
    }
  `,
  template: `
    <app-page-header eyebrow="Zingoo · Manufacturer portal" [title]="profile.value()?.manufacturer?.name ?? 'Manufacturer portal'"
      description="Orders from Zen Foods: accept or reject them, then report each production step." />

    <div class="stack">
      @if (!isManufacturer()) {
        <div class="picker">
          <app-field label="Manufacturer" hint="Staff view: pick whose portal to look at">
            <app-select [options]="manufacturerOptions()" [ngModel]="picked() ?? profile.value()?.manufacturer?.id"
              (ngModelChange)="picked.set($event)" [clearable]="false" placeholder="Choose a manufacturer" />
          </app-field>
        </div>
      }

      <div class="grid-auto">
        <app-kpi label="Waiting for your answer" [value]="num(profile.value()?.waiting ?? 0)" icon="clock" tone="warning" foot="Accept or reject" />
        <app-kpi label="In production" [value]="num(profile.value()?.inProduction ?? 0)" icon="factory" tone="info"
          [foot]="num(profile.value()?.containersInProduction ?? 0) + ' containers'" />
        <app-kpi label="Value in production" [value]="money(profile.value()?.valueInProduction ?? 0)" icon="coins" tone="accent" foot="Accepted orders" />
        <app-kpi label="Paid to you" [value]="money(position.value()?.totals?.paid ?? 0)" icon="coins" tone="success"
          [foot]="'Still to pay ' + money(position.value()?.totals?.toPay ?? 0)" />
        <app-kpi label="Advance on order" [value]="(profile.value()?.manufacturer?.advancePct ?? 0) + '%'" icon="landmark" tone="success"
          [foot]="'Balance in ' + (profile.value()?.manufacturer?.paymentDays ?? 0) + ' days'" />
      </div>

      <div class="card">
        <div class="card__head"><div><h2>Payment details</h2><p>Where Zen Foods pays you. Ask Zen Foods to change them</p></div></div>
        <div class="card__body">
          <dl class="terms">
            @for (b of profile.value()?.manufacturer?.bankAccounts ?? []; track b.account) {
              <div>
                <dt>{{ b.isDefault ? 'Default account' : 'Other account' }}</dt>
                <dd>{{ b.bank }} · {{ b.account }}<br />{{ b.title }}{{ b.branch ? ' · ' + b.branch : '' }}</dd>
              </div>
            } @empty {
              <div><dt>Bank account</dt><dd>None on file yet</dd></div>
            }
          </dl>
        </div>
      </div>

      <app-orders-panel mode="factory" [orders]="orders.value() ?? []" [loading]="orders.isLoading()"
        [error]="orders.error() ? 'The server did not answer.' : null" [stages]="profile.value()?.stages ?? []"
        [canAnswer]="canAnswer()" (changed)="reload()" />

      <app-requests-panel mode="factory" [requests]="requests.value() ?? []" [position]="position.value() ?? null"
        [loading]="requests.isLoading()" [error]="requests.error() ? 'The server did not answer.' : null"
        [manufacturer]="profile.value()?.manufacturer ?? null" [canRequest]="canAnswer()" (changed)="reload()" />
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

  private tick = signal(0);
  /** staff: the manufacturer picked in the selector (empty = the first one) */
  protected picked = signal<string | null>(null);

  protected profile = rxResource({
    params: () => ({ t: this.tick(), m: this.picked() }),
    stream: ({ params }) => this.api.profile(params.m ?? undefined),
  });
  protected orders = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.orders(params.m) : of([])),
  });
  protected requests = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.requests(params.m) : of([])),
  });
  protected position = rxResource({
    params: () => ({ t: this.tick(), m: this.profile.value()?.manufacturer?.id }),
    stream: ({ params }) => (params.m ? this.api.position(params.m) : of(null)),
  });
  private manufacturers = rxResource({
    params: () => (this.isManufacturer() ? undefined : true),
    stream: () => this.ops.manufacturers(),
  });
  protected manufacturerOptions = computed<SelectOption<string>[]>(() =>
    (this.manufacturers.value() ?? []).map((m) => ({ value: m.id, label: m.name })));

  protected num = fmtNumber;
  protected money = fmtMoney;

  protected reload() {
    this.tick.update((n) => n + 1);
  }
}
