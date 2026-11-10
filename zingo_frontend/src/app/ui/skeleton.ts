import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';

/** one grey shimmering block: <app-skeleton shape="title" width="40%" /> */
@Component({
  selector: 'app-skeleton',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'skeleton',
    'aria-hidden': 'true',
    '[attr.data-shape]': 'shape()',
    '[style.inline-size]': 'width() ?? null',
    '[style.block-size]': 'height() ?? null',
  },
  template: '',
})
export class Skeleton {
  readonly shape = input<'line' | 'title' | 'circle' | 'rect' | 'button' | 'input'>('line');
  readonly width = input<string>();
  readonly height = input<string>();
}

/** a paragraph of lines, the last one shorter: <app-skeleton-text [lines]="3" /> */
@Component({
  selector: 'app-skeleton-text',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  host: { class: 'skeleton-stack', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading' },
  template: `
    @for (l of rows(); track l) {
      <app-skeleton [width]="l === lines() ? '60%' : '100%'" />
    }
  `,
})
export class SkeletonText {
  readonly lines = input(3);
  protected rows = computed(() => Array.from({ length: this.lines() }, (_, i) => i + 1));
}

/** placeholder for <app-kpi> while numbers load (or use <app-kpi [loading]="true">) */
@Component({
  selector: 'app-skeleton-kpi',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  host: { class: 'card kpi', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading' },
  template: `
    <div class="kpi__top"><app-skeleton width="45%" /><app-skeleton shape="circle" width="2.25rem" height="2.25rem" /></div>
    <app-skeleton shape="title" width="70%" />
    <app-skeleton width="85%" height="0.75rem" />
  `,
})
export class SkeletonKpi {}

/** rows x columns of bars in the shape of a data table: <app-skeleton-table [rows]="5" [cols]="5" /> */
@Component({
  selector: 'app-skeleton-table',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  host: { class: 'skeleton-table', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading table' },
  template: `
    <div class="skeleton-table__row skeleton-table__row--head" [style.--cols]="cols()">
      @for (c of colList(); track c) {
        <app-skeleton width="50%" height="0.625rem" />
      }
    </div>
    @for (r of rowList(); track r) {
      <div class="skeleton-table__row" [style.--cols]="cols()">
        @for (c of colList(); track c) {
          <app-skeleton [width]="widthFor(r, c)" />
        }
      </div>
    }
  `,
})
export class SkeletonTable {
  readonly rows = input(5);
  readonly cols = input(5);
  protected rowList = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
  protected colList = computed(() => Array.from({ length: this.cols() }, (_, i) => i));

  /** varied but stable widths, so the block reads like real data */
  protected widthFor(r: number, c: number) {
    return `${[72, 58, 84, 46, 66, 78][(r * 3 + c * 5) % 6]}%`;
  }
}

/** form-shaped placeholder: label + input pairs in the form grid */
@Component({
  selector: 'app-skeleton-form',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  host: { class: 'form-grid', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading form' },
  template: `
    @for (f of list(); track f) {
      <div class="field">
        <app-skeleton width="35%" height="0.75rem" />
        <app-skeleton shape="input" />
      </div>
    }
  `,
})
export class SkeletonForm {
  readonly fields = input(4);
  protected list = computed(() => Array.from({ length: this.fields() }, (_, i) => i));
}

/** a whole page while its data loads: header, KPI row, table card */
@Component({
  selector: 'app-page-skeleton',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, SkeletonKpi, SkeletonTable],
  host: { role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading page' },
  template: `
    <div class="page-head">
      <div>
        <app-skeleton width="6rem" height="0.75rem" />
        <app-skeleton shape="title" width="16rem" />
      </div>
      <app-skeleton shape="button" />
    </div>
    <div class="grid-auto" style="--grid-min: 14rem">
      @for (k of kpis; track k) {
        <app-skeleton-kpi />
      }
    </div>
    <div class="card" style="margin-block-start: var(--space-6)">
      <div class="card__head"><app-skeleton shape="title" width="12rem" height="1.125rem" /></div>
      <div class="card__body"><app-skeleton-table [rows]="5" [cols]="5" /></div>
    </div>
  `,
})
export class PageSkeleton {
  protected kpis = [1, 2, 3, 4];
}
