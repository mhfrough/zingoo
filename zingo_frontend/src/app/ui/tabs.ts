/**
 * tabs.ts - the tab strip that splits a page into sections (app-tabs) and the optional panel directive.
 * Owned by the design-system session. The active tab lives in the URL (?tab=id) and is remembered per page.
 */
import {
  ChangeDetectionStrategy, Component, Directive, ElementRef, TemplateRef, ViewEncapsulation, afterEveryRender,
  contentChildren, effect, inject, input, model, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent, IconName } from './icon';
import { lastTab, rememberTab } from './tab-memory';

/** One tab: `count` shows a small number badge (records in that section). */
export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  count?: number | null;
}

let nextTabsId = 0;

/**
 * Marks the content of one tab: <ng-template appTabPanel="orders"> ... </ng-template> inside <app-tabs>.
 * Only the active tab's template is rendered, so hidden sections cost nothing.
 */
@Directive({ selector: 'ng-template[appTabPanel]' })
export class TabPanel {
  /** the tab id this content belongs to */
  readonly id = input.required<string>({ alias: 'appTabPanel' });
  /** the template the tab strip renders while this tab is active */
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * Accessible tab strip (role tablist, arrow keys / Home / End, automatic activation) with a sliding underline.
 * The active tab is kept in the URL as ?tab=<id> (so links and the back button work) and the last tab of each page is
 * remembered. On phones the strip scrolls sideways without a visible scrollbar.
 *
 *   <app-tabs [tabs]="tabs" [(active)]="tab">
 *     <ng-template appTabPanel="orders"> ...orders table... </ng-template>
 *     <ng-template appTabPanel="batches"> ...batches table... </ng-template>
 *   </app-tabs>
 *
 * Without panel templates the page can render its own sections with @switch (tab()).
 */
@Component({
  selector: 'app-tabs',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, NgTemplateOutlet],
  host: { class: 'tabs' },
  template: `
    <div #list class="tabs__list" role="tablist" [attr.aria-label]="ariaLabel()" (keydown)="onKey($event)">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="tabs__tab"
          [id]="tabDomId(t.id)"
          [attr.aria-selected]="t.id === active()"
          [attr.aria-controls]="panels().length ? panelDomId(t.id) : null"
          [attr.tabindex]="t.id === active() ? 0 : -1"
          (click)="select(t.id)"
        >
          @if (t.icon) {
            <app-icon [name]="t.icon" [size]="16" />
          }
          <span>{{ t.label }}</span>
          @if (t.count !== undefined && t.count !== null) {
            <span class="tabs__count">{{ t.count }}</span>
          }
        </button>
      }
      <span class="tabs__bar" aria-hidden="true" [style.--x.px]="bar().x" [style.--w.px]="bar().w"></span>
    </div>
    @for (p of panels(); track p.id()) {
      @if (p.id() === active()) {
        <div class="tabs__panel" role="tabpanel" [id]="panelDomId(p.id())" [attr.aria-labelledby]="tabDomId(p.id())" tabindex="0">
          <ng-container [ngTemplateOutlet]="p.template" />
        </div>
      }
    }
  `,
})
export class Tabs {
  /** the tabs, in order */
  readonly tabs = input.required<TabItem[]>();
  /** two-way: id of the active tab */
  readonly active = model('');
  /** name of the tab group for screen readers */
  readonly ariaLabel = input('Sections');
  /** query-string key that holds the active tab */
  readonly param = input('tab');
  /** keep the active tab in the URL and remember it per page */
  readonly remember = input(true);

  protected panels = contentChildren(TabPanel);
  protected bar = signal({ x: 0, w: 0 });

  private uid = nextTabsId++;
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private list = viewChild.required<ElementRef<HTMLElement>>('list');
  private query = toSignal(this.route.queryParamMap);
  private started = false;

  constructor() {
    // URL -> active (first run: URL, then the remembered tab, then the one the page set, then the first tab)
    effect(() => {
      const tabs = this.tabs();
      const fromUrl = this.query()?.get(this.param()) ?? null;
      untracked(() => {
        const valid = (id: string | null | undefined) => !!id && tabs.some((t) => t.id === id);
        if (!tabs.length) return;
        if (valid(fromUrl)) {
          if (this.active() !== fromUrl) this.active.set(fromUrl!);
        } else if (!this.started || !valid(this.active())) {
          const remembered = this.remember() ? lastTab(this.pageKey()) : null;
          const next = valid(remembered) ? remembered! : valid(this.active()) ? this.active() : tabs[0].id;
          this.active.set(next);
          if (this.remember()) this.writeUrl(next);
        }
        this.started = true;
      });
    });

    afterEveryRender(() => this.measure());
  }

  protected tabDomId(id: string) {
    return `tabs-${this.uid}-tab-${id}`;
  }

  protected panelDomId(id: string) {
    return `tabs-${this.uid}-panel-${id}`;
  }

  /** the page path without the query string: the key the last tab is remembered under */
  private pageKey() {
    return this.router.url.split('?')[0].split('#')[0];
  }

  private writeUrl(id: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [this.param()]: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** make a tab active (click or keyboard) */
  protected select(id: string) {
    if (id === this.active()) return;
    this.active.set(id);
    if (this.remember()) {
      rememberTab(this.pageKey(), id);
      this.writeUrl(id);
    }
  }

  protected onKey(event: KeyboardEvent) {
    const tabs = this.tabs();
    const i = tabs.findIndex((t) => t.id === this.active());
    let next = i;
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    this.select(tabs[next].id);
    queueMicrotask(() => this.list().nativeElement.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus());
  }

  /** place the underline under the active tab and scroll that tab into view on narrow screens */
  private measure() {
    const list = this.list().nativeElement;
    const el = list.querySelector<HTMLElement>('[aria-selected=true]');
    if (!el) return;
    const next = { x: el.offsetLeft, w: el.offsetWidth };
    const cur = this.bar();
    if (cur.x !== next.x || cur.w !== next.w) {
      this.bar.set(next);
      const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }
}
