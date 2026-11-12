import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fmtMoney, fmtNumber } from '../../shared/format';
import { IconComponent, IconName } from '../../ui';
import { ChainSummary } from '../factory/factory.api';

/** one box of the chain */
interface Link {
  key: string;
  title: string;
  icon: IconName;
  path: string;
  /** the label on the arrow into the next box */
  arrow?: string;
}

const LINKS: Link[] = [
  { key: 'investors', title: 'Investors', icon: 'users', path: '/admin/finance', arrow: 'Investment' },
  { key: 'company', title: 'Zen Foods', icon: 'building', path: '/admin/finance', arrow: 'Production orders' },
  { key: 'manufacturers', title: 'Manufacturers', icon: 'factory', path: '/admin/manufacturing', arrow: 'Containers delivered' },
  { key: 'distributors', title: 'Distributors', icon: 'truck', path: '/admin/distribution', arrow: 'Sales' },
  { key: 'customers', title: 'Customers', icon: 'receipt', path: '/admin/distribution' },
];

/**
 * The business as one chain: Investor -> Zen Foods -> Manufacturer -> Distributor -> Customer, with the live
 * figures of each link (money invested, cash, what is on order and owed, stock held, sales and collections).
 * Each box opens the page where that link is managed. Boxes stack on narrow screens.
 */
@Component({
  selector: 'app-chain',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }

    /* five boxes in a row when there is room, otherwise one under the other */
    .chain {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-5);
      margin: 0;
      padding: 0;
      list-style: none;

      @container (min-width: 70rem) {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: var(--space-8, 2.5rem);
      }
    }

    .link {
      position: relative;
      display: flex;
    }

    .box {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      background: var(--surface-card);
      color: var(--text);
      text-decoration: none;
      box-shadow: var(--elev-1);
      transition: border-color var(--dur-fast) var(--ease-out), translate var(--dur-fast) var(--ease-out);

      &:hover {
        border-color: var(--orange-300);
        translate: 0 -2px;
      }

      &[data-main] {
        border-color: var(--orange-300);
        background: var(--accent-soft);
      }
    }

    .box__head {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: var(--weight-semibold);

      & app-icon {
        color: var(--accent-text);
      }
    }

    /* figures flow into columns when the box is wide (stacked layout), one column when narrow */
    .figures {
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
      gap: var(--space-1) var(--space-6);
      font-size: var(--text-sm);

      & div {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        column-gap: var(--space-2);
      }

      & dt {
        color: var(--text-3);
      }

      & dd {
        margin: 0 0 0 auto;
        font-variant-numeric: tabular-nums;
        text-align: end;
        white-space: nowrap;
      }
    }

    /* the arrow into the next box: below it when stacked, beside it in a row */
    .arrow {
      position: absolute;
      inset-inline-start: 50%;
      inset-block-start: 100%;
      block-size: var(--space-5);
      display: grid;
      place-items: center;
      translate: -50% 0;
      rotate: 90deg;
      color: var(--text-3);

      @container (min-width: 70rem) {
        inset-inline-start: 100%;
        inset-block-start: 50%;
        inline-size: var(--space-8, 2.5rem);
        block-size: auto;
        translate: 0 -50%;
        rotate: none;
      }
    }

    /* what moves along the arrow, in small type under each box title */
    .box__flow {
      font-size: var(--text-xs);
      color: var(--text-3);
    }
  `,
  template: `
    <ol class="chain" aria-label="Business chain">
      @for (l of links; track l.key; let last = $last) {
        <li class="link">
          <a class="box" [routerLink]="l.path" [attr.data-main]="l.key === 'company' ? '' : null">
            <span class="box__head"><app-icon [name]="l.icon" [size]="18" />{{ l.title }}</span>
            @if (l.arrow) {
              <span class="box__flow">{{ l.arrow }} →</span>
            }
            <dl class="figures">
              @for (f of figures(l.key); track f[0]) {
                <div><dt>{{ f[0] }}</dt><dd>{{ f[1] }}</dd></div>
              }
            </dl>
          </a>
          @if (!last) {
            <span class="arrow" aria-hidden="true"><app-icon name="arrow-right" [size]="18" /></span>
          }
        </li>
      }
    </ol>
  `,
})
export class Chain {
  readonly data = input<ChainSummary | null>(null);
  protected links = LINKS;

  /** the [label, value] pairs shown in one box */
  protected figures(key: string): [string, string][] {
    const c = this.data();
    if (!c) return [['Loading', '...']];
    const m = fmtMoney;
    const n = fmtNumber;
    switch (key) {
      case 'investors':
        return [['Invested', m(c.investors.capital)], ['Investors', n(c.investors.investors)]];
      case 'company':
        return [['Cash', m(c.company.cash)], ['Margin on sales', m(c.customers.margin)]];
      case 'manufacturers':
        return [
          ['Containers on order', n(c.manufacturers.containersOnOrder)], ['Waiting answer', n(c.manufacturers.waiting)],
          ['Advances held', m(c.manufacturers.advances)], ['We owe', m(c.manufacturers.owed)],
        ];
      case 'distributors':
        return [
          ['In transit', n(c.manufacturers.inTransit)], ['Containers held', n(c.distributors.containersHeld)],
          ['Stock value', m(c.distributors.stockValue)], ['Past sell-by', n(c.distributors.overdueLots)],
        ];
      default:
        return [
          ['Containers sold', n(c.customers.containersSold)], ['Invoiced', m(c.customers.invoiced)],
          ['Collected', m(c.customers.collected)], ['Receivable', m(c.customers.receivable)],
        ];
    }
  }
}
