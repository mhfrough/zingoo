import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, booleanAttribute, effect, inject,
  input, signal, untracked,
} from '@angular/core';
import { IconComponent, IconName } from './icon';
import { tokenMs } from './motion';
import { Skeleton } from './skeleton';

/** Title row at the top of every page. Buttons go in a [pageActions] element. */
@Component({
  selector: 'app-page-header',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page-head' },
  template: `
    <div>
      @if (eyebrow()) {
        <div class="page-head__eyebrow">{{ eyebrow() }}</div>
      }
      <h1>{{ title() }}</h1>
      @if (description()) {
        <p class="page-head__desc">{{ description() }}</p>
      }
    </div>
    <div class="page-head__actions"><ng-content select="[pageActions]" /></div>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly eyebrow = input<string>();
  readonly description = input<string>();
}

/**
 * One number with a label: <app-kpi label="Cash" value="PKR 1,897,000" icon="wallet" tone="success" />
 * The first number in `value` counts up from 0 (and from the old figure when it changes); text around it, thousands
 * separators and decimals are kept. No animation under prefers-reduced-motion. [loading]="true" shows a skeleton.
 */
@Component({
  selector: 'app-kpi',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, Skeleton],
  host: { class: 'card kpi' },
  template: `
    <div class="kpi__top">
      <span class="kpi__label">{{ label() }}</span>
      <span class="kpi__icon" [attr.data-tone]="tone()"><app-icon [name]="icon()" [size]="18" /></span>
    </div>
    <div class="kpi__value">
      @if (loading()) {
        <app-skeleton shape="title" width="70%" />
      } @else {
        <span aria-hidden="true">{{ shown() }}</span>
        <span class="sr-only">{{ value() }}</span>
      }
    </div>
    @if (foot()) {
      <div class="kpi__foot">{{ foot() }}</div>
    }
  `,
})
export class Kpi {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly icon = input.required<IconName>();
  readonly tone = input<'accent' | 'success' | 'info' | 'warning' | 'danger'>('accent');
  readonly foot = input<string>();
  readonly loading = input(false, { transform: booleanAttribute });

  protected shown = signal('');
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private lastNumber: number | null = null;
  private raf = 0;

  constructor() {
    effect(() => {
      const value = this.value();
      untracked(() => this.countTo(value));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  private countTo(value: string) {
    cancelAnimationFrame(this.raf);
    const m = /-?\d[\d,]*(?:\.\d+)?/.exec(value);
    const ms = tokenMs(this.host, '--dur-count');
    if (!m || ms === 0) {
      this.shown.set(value);
      this.lastNumber = m ? parseFloat(m[0].replace(/,/g, '')) : null;
      return;
    }
    const target = parseFloat(m[0].replace(/,/g, ''));
    const from = this.lastNumber ?? 0;
    this.lastNumber = target;
    if (from === target) {
      this.shown.set(value);
      return;
    }
    const decimals = m[0].includes('.') ? m[0].length - m[0].indexOf('.') - 1 : 0;
    const grouped = m[0].includes(',');
    const fmt = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      this.shown.set(t >= 1 ? value : value.replace(m[0], fmt(from + (target - from) * eased)));
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** Shown when a list is empty, an error happened, or a page is not built yet. Actions go in [emptyActions]. */
@Component({
  selector: 'app-empty-state',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'empty' },
  template: `
    <span class="empty__icon"><app-icon [name]="icon()" [size]="22" /></span>
    <h3>{{ title() }}</h3>
    @if (text()) {
      <p>{{ text() }}</p>
    }
    <div class="empty__actions"><ng-content select="[emptyActions]" /></div>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly text = input<string>();
  readonly icon = input<IconName>('inbox');
}
