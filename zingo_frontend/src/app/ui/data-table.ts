/**
 * data-table.ts - the merged-column data table (app-data-table): search, column filters, click-to-sort headers,
 * pagination with a "Showing a-b of N records" footer, optional server-side paging, and the phone card layout.
 * Owned by the design-system session. Styling lives in styles/components/table.css.
 */
import {
  ChangeDetectionStrategy, Component, ViewEncapsulation, booleanAttribute, computed, effect, inject, input, output,
  signal, untracked,
} from '@angular/core';
import { Tone, fmtAmount, fmtDate, fmtNumber } from '../shared/format';
import { Btn } from './button';
import { EmptyState } from './blocks';
import { IconComponent, IconName } from './icon';
import { SearchBox } from './search';
import { Skeleton } from './skeleton';
import { TABLE_DEFAULTS, loadTableState, saveTableState } from './table-state';
import { Tag } from './tag';

/** One column of a data table. */
export interface TableColumn<T> {
  id: string;
  label: string;
  /** main value of the cell */
  value: (row: T) => string | number | null | undefined;
  kind?: 'text' | 'money' | 'number' | 'date' | 'mono' | 'tag';
  /** MERGE: a second line under the main value, so one column carries two fields */
  sub?: (row: T) => string | null | undefined;
  /** colour of the tag when kind = 'tag' */
  tone?: (row: T) => Tone;
  /** 1 = always visible, 3 = folds into the first column on tablets, shown as a label:value line on phones */
  priority?: 1 | 2 | 3;
  align?: 'start' | 'end';
  /** header click sorts by this column (default true); set false for a column that should not sort */
  sortable?: boolean;
  /** value to sort by when it differs from the shown value (a date shown as text, a status rank) */
  sortValue?: (row: T) => string | number | null | undefined;
}

/** A row action button (the first two show as buttons, the rest go into a "more" menu). */
export interface RowAction {
  id: string;
  label: string;
  tone?: 'danger' | 'success';
  /** optional icon shown before the label (not shown inside the overflow menu) */
  icon?: IconName;
}

/** Payload of the (action) output. */
export interface RowActionEvent<T> {
  id: string;
  row: T;
}

/** Definition of one column filter. `id` is the id of the column it filters. */
export interface TableFilter {
  id: string;
  type: 'text' | 'select' | 'date-range' | 'number-range';
  /** label above the control (default: the column label) */
  label?: string;
  /** choices of a select filter (default: the distinct values found in the rows) */
  options?: { value: string; label: string }[];
}

/** The value of one filter: which fields are used depends on its type. */
export interface TableFilterValue {
  text?: string;
  value?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
}

/** Everything a server needs to return the right page; emitted by (query) in serverMode. */
export interface TableQuery {
  page: number;
  pageSize: number;
  search: string;
  sort: { column: string; dir: 'asc' | 'desc' } | null;
  filters: Record<string, TableFilterValue>;
}

/** page numbers with gaps shown as '…': 1 … 4 5 6 … 20 */
export function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/**
 * Merged-column table. Never scrolls sideways: see styles/components/table.css.
 *
 *   <app-data-table [columns]="cols" [rows]="orders()" [actions]="rowActions" (action)="onAction($event)" />
 *
 * Existing inputs stay (columns, rows, actions, totals, loading, error, searchable, searchPlaceholder, emptyTitle,
 * emptyText) as do the (action) and (retry) outputs. New, all optional:
 *   tableId          remember page size, sort and filters under this id
 *   pageSizes        rows-per-page choices (default 10, 20, 50, 100)
 *   defaultPageSize  starting page size (default: the user preference via TABLE_DEFAULTS, else 20)
 *   filters          column filter definitions (text, select, date range, number range)
 *   serverMode       the page is cut on the server: pass the current page as `rows` and the record count as `total`,
 *                    and listen to (query) for page, search, sort and filter changes
 * Footer: "Showing 21-40 of 134 records", rows per page, first / previous / numbers / next / last, "Page 2 of 7".
 */
@Component({
  selector: 'app-data-table',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, Tag, Btn, EmptyState, SearchBox, Skeleton],
  host: { '(document:click)': 'closeMenus($event)', '(keydown.escape)': 'closeMenus()' },
  template: `
    <div class="dt">
      @if (searchable() || filterDefs().length) {
        <div class="dt__bar toolbar">
          @if (searchable()) {
            <app-search class="toolbar__grow" [(value)]="q" [placeholder]="searchPlaceholder()"
                        ariaLabel="Search this table" />
          }
          @if (filterDefs().length) {
            <button appBtn size="sm" icon="filter" [attr.aria-expanded]="filtersOpen()" aria-controls="dt-filters"
                    (click)="filtersOpen.set(!filtersOpen())">
              Filters
              @if (activeCount()) {
                <span class="dt__badge">{{ activeCount() }}</span>
              }
            </button>
          }
          <ng-content select="[tableTools]" />
        </div>
      }

      @if (filtersOpen() && filterDefs().length) {
        <div class="dt__filters" id="dt-filters" role="group" aria-label="Column filters">
          @for (f of filterDefs(); track f.id) {
            <div class="dt__filter">
              <span class="dt__filter-label">{{ f.label }}</span>
              @switch (f.type) {
                @case ('text') {
                  <input class="control" type="search" autocomplete="off" [attr.aria-label]="f.label"
                         [value]="fv(f.id).text ?? ''" (input)="setFilter(f.id, { text: val($event) })" />
                }
                @case ('select') {
                  <select class="control" [attr.aria-label]="f.label" (change)="setFilter(f.id, { value: val($event) })">
                    <option value="" [selected]="!fv(f.id).value">All</option>
                    @for (o of f.options; track o.value) {
                      <option [value]="o.value" [selected]="fv(f.id).value === o.value">{{ o.label }}</option>
                    }
                  </select>
                }
                @case ('date-range') {
                  <div class="dt__range">
                    <input class="control" type="date" [attr.aria-label]="f.label + ' from'" [value]="fv(f.id).from ?? ''"
                           (input)="setFilter(f.id, { from: val($event) })" />
                    <span aria-hidden="true">to</span>
                    <input class="control" type="date" [attr.aria-label]="f.label + ' to'" [value]="fv(f.id).to ?? ''"
                           (input)="setFilter(f.id, { to: val($event) })" />
                  </div>
                }
                @case ('number-range') {
                  <div class="dt__range">
                    <input class="control" type="number" placeholder="Min" [attr.aria-label]="f.label + ' minimum'"
                           [value]="fv(f.id).min ?? ''" (input)="setFilter(f.id, { min: val($event) })" />
                    <span aria-hidden="true">to</span>
                    <input class="control" type="number" placeholder="Max" [attr.aria-label]="f.label + ' maximum'"
                           [value]="fv(f.id).max ?? ''" (input)="setFilter(f.id, { max: val($event) })" />
                  </div>
                }
              }
            </div>
          }
        </div>
      }

      @if (chips().length) {
        <div class="dt__chips">
          @for (c of chips(); track c.id) {
            <span class="dt__chip">
              {{ c.label }}: <b>{{ c.summary }}</b>
              <button type="button" [attr.aria-label]="'Remove filter ' + c.label" (click)="clearFilter(c.id)">
                <app-icon name="x" [size]="12" />
              </button>
            </span>
          }
          <button appBtn variant="ghost" size="sm" (click)="clearAll()">Clear filters</button>
        </div>
      }

      <table class="table" [attr.aria-busy]="loading() ? 'true' : null">
        <thead>
          <tr>
            @for (c of columns(); track c.id) {
              <th scope="col" [attr.data-priority]="c.priority ?? 1" [attr.data-end]="isEnd(c) ? '' : null"
                  [attr.aria-sort]="ariaSort(c)">
                @if (isSortable(c)) {
                  <button type="button" class="dt__sort" (click)="toggleSort(c)">
                    <span>{{ c.label }}</span>
                    <app-icon [name]="sortIcon(c)" [size]="14" />
                  </button>
                } @else {
                  {{ c.label }}
                }
              </th>
            }
            @if (actions()) {
              <th scope="col" data-end><span class="sr-only">Actions</span></th>
            }
          </tr>
        </thead>

        <tbody>
          @if (loading()) {
            @for (r of skeletonRows; track r) {
              <tr class="is-skeleton" aria-hidden="true">
                @for (c of columns(); track c.id; let first = $first) {
                  <td [attr.data-label]="c.label" [attr.data-priority]="c.priority ?? 1"
                      [attr.data-end]="isEnd(c) ? '' : null" [attr.data-primary]="first ? '' : null">
                    <app-skeleton [width]="barWidth(r, $index, c)" [height]="c.kind === 'tag' ? '1.25rem' : undefined" />
                    @if (first || c.sub) {
                      <app-skeleton class="cell__skeleton-sub" width="45%" height="0.625rem" />
                    }
                  </td>
                }
                @if (actions()) {
                  <td class="cell-actions-td" data-end><app-skeleton shape="button" width="5rem" height="2rem" /></td>
                }
              </tr>
            }
            <tr class="sr-only"><td [attr.colspan]="span()" role="status">Loading rows</td></tr>
          } @else if (error()) {
            <tr>
              <td [attr.colspan]="span()">
                <app-empty-state icon="circle-alert" title="Could not load this table" [text]="error()!">
                  <button emptyActions appBtn size="sm" icon="undo" (click)="retry.emit()">Try again</button>
                </app-empty-state>
              </td>
            </tr>
          } @else {
            @for (row of pageRows(); track $index) {
              @let acts = actions() ? actions()!(row) : [];
              <tr [style.--i]="$index">
                @for (c of columns(); track c.id; let first = $first) {
                  <td [attr.data-label]="c.label" [attr.data-priority]="c.priority ?? 1"
                      [attr.data-end]="isEnd(c) ? '' : null" [attr.data-primary]="first ? '' : null">
                    <div class="cell">
                      @if (c.kind === 'tag') {
                        <app-tag [tone]="c.tone ? c.tone(row) : 'neutral'">{{ text(c, row) }}</app-tag>
                      } @else {
                        <div class="cell__main" [class.mono]="c.kind === 'mono'">{{ text(c, row) }}</div>
                      }
                      @if (c.sub && c.sub(row); as sub) {
                        <div class="cell__sub">{{ sub }}</div>
                      }
                      @if (first && folded().length) {
                        <div class="cell__fold">
                          @for (f of folded(); track f.id) {
                            <span><b>{{ f.label }}</b> {{ text(f, row) }}</span>
                          }
                        </div>
                      }
                    </div>
                  </td>
                }
                @if (actions()) {
                  <td class="cell-actions-td" data-end>
                    <div class="cell-actions">
                      @for (a of acts; track a.id; let i = $index) {
                        @if (i < 2) {
                          <button appBtn size="sm" [variant]="a.tone ?? 'secondary'" [icon]="a.icon"
                                  (click)="emit(a.id, row)">{{ a.label }}</button>
                        }
                      }
                      @if (acts.length > 2) {
                        <details class="menu">
                          <summary class="btn btn-icon" data-variant="ghost" data-size="sm" aria-label="More actions">
                            <app-icon name="more" [size]="18" />
                          </summary>
                          <div class="menu__list">
                            @for (a of acts; track a.id; let i = $index) {
                              @if (i >= 2) {
                                <button type="button" class="menu__item" [attr.data-tone]="a.tone"
                                        (click)="pick($event, a.id, row)">{{ a.label }}</button>
                              }
                            }
                          </div>
                        </details>
                      }
                    </div>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="span()">
                  <app-empty-state [title]="hasQuery() ? 'No matches' : emptyTitle()"
                                   [text]="hasQuery() ? 'Nothing matches the search and filters.' : emptyText()">
                    @if (hasQuery()) {
                      <button emptyActions appBtn size="sm" (click)="clearAll()">Clear search and filters</button>
                    }
                  </app-empty-state>
                </td>
              </tr>
            }
          }
        </tbody>

        @if (totals() && filtered().length) {
          <tfoot>
            <tr>
              @for (c of columns(); track c.id; let first = $first) {
                <td [attr.data-label]="c.label" [attr.data-priority]="c.priority ?? 1"
                    [attr.data-end]="isEnd(c) ? '' : null">
                  <div class="cell"><div class="cell__main">{{ totals()![c.id] ?? (first ? 'Total' : '') }}</div></div>
                </td>
              }
              @if (actions()) {
                <td></td>
              }
            </tr>
          </tfoot>
        }
      </table>

      @if (!loading() && !error() && totalCount() > 0) {
        <div class="dt__foot">
          <p class="dt__showing" aria-live="polite">
            Showing {{ from() }}-{{ to() }} of {{ totalCount() }} records
            @if (!serverMode() && totalCount() < rows().length) {
              <span class="muted">(filtered from {{ rows().length }})</span>
            }
          </p>
          <div class="dt__foot-right">
            <label class="dt__size">
              <span>Rows per page</span>
              <select class="control" (change)="setSize(val($event))">
                @for (n of pageSizes(); track n) {
                  <option [value]="n" [selected]="n === size()">{{ n }}</option>
                }
              </select>
            </label>
            <nav class="dt__pager" aria-label="Pagination">
              <button type="button" class="dt__page" aria-label="First page" [disabled]="currentPage() === 1" (click)="goto(1)">
                <app-icon name="chevrons-left" [size]="16" />
              </button>
              <button type="button" class="dt__page" aria-label="Previous page" [disabled]="currentPage() === 1"
                      (click)="goto(currentPage() - 1)">
                <app-icon name="chevron-left" [size]="16" />
              </button>
              @for (p of pages(); track $index) {
                @if (p === '…') {
                  <span class="dt__gap" aria-hidden="true">…</span>
                } @else {
                  <button type="button" class="dt__page dt__page--num" [attr.aria-current]="p === currentPage() ? 'page' : null"
                          [attr.aria-label]="'Page ' + p" (click)="goto(+p)">{{ p }}</button>
                }
              }
              <button type="button" class="dt__page" aria-label="Next page" [disabled]="currentPage() === pageCount()"
                      (click)="goto(currentPage() + 1)">
                <app-icon name="chevron-right" [size]="16" />
              </button>
              <button type="button" class="dt__page" aria-label="Last page" [disabled]="currentPage() === pageCount()"
                      (click)="goto(pageCount())">
                <app-icon name="chevrons-right" [size]="16" />
              </button>
            </nav>
            <span class="dt__page-of">Page {{ currentPage() }} of {{ pageCount() }}</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class DataTable<T> {
  /** column definitions */
  readonly columns = input.required<TableColumn<T>[]>();
  /** the rows (in serverMode: the current page only) */
  readonly rows = input.required<T[]>();
  /** row action buttons per row */
  readonly actions = input<(row: T) => RowAction[]>();
  /** column id -> text shown in the footer row */
  readonly totals = input<Record<string, string | undefined>>();
  /** show skeleton rows */
  readonly loading = input(false);
  /** show an error state with a retry button */
  readonly error = input<string | null>(null);
  /** show the search box */
  readonly searchable = input(true);
  /** placeholder of the search box */
  readonly searchPlaceholder = input('Search...');
  /** title of the empty state when the table has no rows */
  readonly emptyTitle = input('Nothing here yet');
  /** text of the empty state when the table has no rows */
  readonly emptyText = input('Records you add will appear here.');
  /** remember page size, sort and filters under this id */
  readonly tableId = input<string>();
  /** rows-per-page choices */
  readonly pageSizes = input<number[]>([10, 20, 50, 100]);
  /** starting page size (default: user preference via TABLE_DEFAULTS, else 20) */
  readonly defaultPageSize = input<number>();
  /** column filter definitions */
  readonly filters = input<TableFilter[]>([]);
  /** paging, sorting and filtering happen on the server: see (query) and `total` */
  readonly serverMode = input(false, { transform: booleanAttribute });
  /** server mode: the number of records over all pages */
  readonly total = input<number>(0);

  /** a row action button was pressed */
  readonly action = output<RowActionEvent<T>>();
  /** the Try again button of the error state was pressed */
  readonly retry = output<void>();
  /** server mode: page, search, sort or filters changed (also fires once on load) */
  readonly query = output<TableQuery>();

  protected skeletonRows = [0, 1, 2, 3, 4];
  /** search text (two-way with the search box) */
  protected q = signal('');
  protected size = signal(20);
  protected page = signal(1);
  protected sort = signal<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  protected filterValues = signal<Record<string, TableFilterValue>>({});
  protected filtersOpen = signal(false);

  private defaults = inject(TABLE_DEFAULTS, { optional: true });
  private loaded = false;

  protected folded = computed(() => this.columns().filter((c) => c.priority === 3));
  protected span = computed(() => this.columns().length + (this.actions() ? 1 : 0));

  /** filter definitions with labels and select options filled in */
  protected filterDefs = computed(() =>
    this.filters().map((f) => {
      const col = this.columns().find((c) => c.id === f.id);
      const options =
        f.type === 'select'
          ? (f.options ?? [...new Set(this.rows().map((r) => String(col?.value(r) ?? '')).filter(Boolean))].sort().map((v) => ({ value: v, label: v })))
          : undefined;
      return { ...f, label: f.label ?? col?.label ?? f.id, options };
    }),
  );

  /** rows that pass search and filters, sorted (not yet cut to a page); in serverMode the rows as given */
  protected filtered = computed(() => {
    if (this.serverMode()) return this.rows();
    const cols = this.columns();
    const q = this.q().trim().toLowerCase();
    let list = this.rows();
    if (q) list = list.filter((row) => cols.some((c) => `${c.value(row) ?? ''} ${c.sub?.(row) ?? ''}`.toLowerCase().includes(q)));
    const fvs = this.filterValues();
    for (const f of this.filterDefs()) {
      const v = fvs[f.id];
      const col = cols.find((c) => c.id === f.id);
      if (!v || !col) continue;
      list = list.filter((row) => this.matches(f.type, v, col.value(row)));
    }
    const s = this.sort();
    const sc = s && cols.find((c) => c.id === s.column);
    if (s && sc) {
      const dir = s.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => dir * this.compare(sc.sortValue ? sc.sortValue(a) : sc.value(a), sc.sortValue ? sc.sortValue(b) : sc.value(b)));
    }
    return list;
  });

  protected totalCount = computed(() => (this.serverMode() ? this.total() : this.filtered().length));
  protected pageCount = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.size())));
  protected currentPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected from = computed(() => (this.totalCount() ? (this.currentPage() - 1) * this.size() + 1 : 0));
  protected to = computed(() => Math.min(this.totalCount(), this.currentPage() * this.size()));
  protected pages = computed(() => pageList(this.currentPage(), this.pageCount()));
  protected pageRows = computed(() => {
    if (this.serverMode()) return this.rows();
    const start = (this.currentPage() - 1) * this.size();
    return this.filtered().slice(start, start + this.size());
  });

  protected activeCount = computed(() => this.chips().length);
  /** one chip per active filter */
  protected chips = computed(() => {
    const out: { id: string; label: string; summary: string }[] = [];
    const fvs = this.filterValues();
    for (const f of this.filterDefs()) {
      const v = fvs[f.id];
      if (!v) continue;
      let summary = '';
      if (f.type === 'text' && v.text) summary = `"${v.text}"`;
      else if (f.type === 'select' && v.value) summary = f.options?.find((o) => o.value === v.value)?.label ?? v.value;
      else if (f.type === 'date-range' && (v.from || v.to)) summary = `${v.from ? fmtDate(v.from) : 'any'} to ${v.to ? fmtDate(v.to) : 'any'}`;
      else if (f.type === 'number-range' && (v.min || v.max)) summary = `${v.min || 'any'} to ${v.max || 'any'}`;
      if (summary) out.push({ id: f.id, label: f.label, summary });
    }
    return out;
  });

  protected hasQuery = computed(() => !!this.q().trim() || this.chips().length > 0);

  constructor() {
    // first run: restore saved state (or the default page size)
    effect(() => {
      const id = this.tableId();
      const sizes = this.pageSizes();
      const dflt = this.defaultPageSize();
      untracked(() => {
        if (this.loaded) return;
        this.loaded = true;
        const saved = id ? loadTableState(id) : {};
        const want = saved.pageSize ?? dflt ?? this.defaults?.pageSize() ?? 20;
        this.size.set(sizes.includes(want) ? want : (sizes.find((n) => n >= want) ?? sizes[sizes.length - 1] ?? 20));
        if (saved.sort) this.sort.set(saved.sort);
        if (saved.filters) this.filterValues.set(saved.filters as Record<string, TableFilterValue>);
        if (this.chips().length) this.filtersOpen.set(true);
      });
    });

    // save page size, sort and filters
    effect(() => {
      const id = this.tableId();
      const state = { pageSize: this.size(), sort: this.sort(), filters: this.filterValues() };
      if (id && this.loaded) untracked(() => saveTableState(id, state));
    });

    // a new search, sort, filter or page size starts again at page 1
    effect(() => {
      this.q();
      this.sort();
      this.filterValues();
      this.size();
      untracked(() => this.page.set(1));
    });

    // server mode: tell the parent what to fetch (search is debounced)
    effect((onCleanup) => {
      if (!this.serverMode()) return;
      const q: TableQuery = {
        page: this.page(), pageSize: this.size(), search: this.q().trim(), sort: this.sort(), filters: this.filterValues(),
      };
      const t = setTimeout(() => this.query.emit(q), 250);
      onCleanup(() => clearTimeout(t));
    });
  }

  // ── cells ──
  protected barWidth(row: number, col: number, c: TableColumn<T>) {
    if (c.kind === 'tag') return '4.5rem';
    const w = [78, 62, 86, 54, 70][(row * 2 + col * 3) % 5];
    return c.kind === 'money' || c.kind === 'number' ? `${Math.min(w, 60)}%` : `${w}%`;
  }

  protected isEnd(c: TableColumn<T>) {
    return (c.align ?? (c.kind === 'money' || c.kind === 'number' ? 'end' : 'start')) === 'end';
  }

  protected text(c: TableColumn<T>, row: T): string {
    const v = c.value(row);
    if (v === null || v === undefined || v === '') return '-';
    switch (c.kind) {
      case 'money': return fmtAmount(v);
      case 'number': return fmtNumber(v);
      case 'date': return fmtDate(String(v));
      default: return String(v);
    }
  }

  // ── sorting ──
  protected isSortable(c: TableColumn<T>) {
    return c.sortable !== false;
  }

  protected ariaSort(c: TableColumn<T>) {
    const s = this.sort();
    return s?.column === c.id ? (s.dir === 'asc' ? 'ascending' : 'descending') : null;
  }

  protected sortIcon(c: TableColumn<T>): IconName {
    const s = this.sort();
    return s?.column === c.id ? (s.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down';
  }

  /** header click: ascending, then descending, then unsorted */
  protected toggleSort(c: TableColumn<T>) {
    const s = this.sort();
    if (s?.column !== c.id) this.sort.set({ column: c.id, dir: 'asc' });
    else if (s.dir === 'asc') this.sort.set({ column: c.id, dir: 'desc' });
    else this.sort.set(null);
  }

  private compare(a: unknown, b: unknown): number {
    const na = a === null || a === undefined || a === '';
    const nb = b === null || b === undefined || b === '';
    if (na || nb) return na === nb ? 0 : na ? 1 : -1; // empty values always last
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ── filters ──
  private matches(type: TableFilter['type'], v: TableFilterValue, raw: unknown): boolean {
    const s = raw === null || raw === undefined ? '' : String(raw);
    switch (type) {
      case 'text': return !v.text || s.toLowerCase().includes(v.text.toLowerCase());
      case 'select': return !v.value || s === v.value;
      case 'date-range': {
        const d = s.slice(0, 10);
        return (!v.from || d >= v.from) && (!v.to || d <= v.to);
      }
      case 'number-range': {
        const n = Number(raw);
        return (!v.min || n >= Number(v.min)) && (!v.max || n <= Number(v.max));
      }
    }
  }

  protected fv(id: string): TableFilterValue {
    return this.filterValues()[id] ?? {};
  }

  protected val(event: Event) {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setFilter(id: string, patch: TableFilterValue) {
    this.filterValues.update((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  }

  protected clearFilter(id: string) {
    this.filterValues.update((all) => {
      const { [id]: _drop, ...rest } = all;
      return rest;
    });
  }

  /** remove the search text and every filter */
  protected clearAll() {
    this.q.set('');
    this.filterValues.set({});
  }

  // ── paging ──
  protected goto(p: number) {
    this.page.set(Math.min(this.pageCount(), Math.max(1, p)));
  }

  protected setSize(v: string) {
    this.size.set(Number(v));
  }

  // ── actions ──
  protected emit(id: string, row: T) {
    this.action.emit({ id, row });
  }

  protected pick(event: Event, id: string, row: T) {
    (event.target as HTMLElement).closest('details')?.removeAttribute('open');
    this.emit(id, row);
  }

  /** close any open row-action menu when the click lands outside it, or on Esc */
  protected closeMenus(event?: Event) {
    const target = event?.target as Node | undefined;
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
      if (!target || !d.contains(target)) d.removeAttribute('open');
    });
  }
}

export type { IconName };
