import {
  ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, output, signal,
} from '@angular/core';
import { Tone, fmtAmount, fmtDate, fmtNumber } from '../shared/format';
import { Btn } from './button';
import { EmptyState } from './blocks';
import { IconComponent, IconName } from './icon';
import { SearchBox } from './search';
import { Skeleton } from './skeleton';
import { Tag } from './tag';

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
}

export interface RowAction {
  id: string;
  label: string;
  tone?: 'danger' | 'success';
  /** optional icon shown before the label (not shown inside the overflow menu) */
  icon?: IconName;
}

export interface RowActionEvent<T> {
  id: string;
  row: T;
}

/**
 * Merged-column table. Never scrolls sideways: see styles/components/table.css.
 *
 *   <app-data-table [columns]="cols" [rows]="orders()" [actions]="rowActions" (action)="onAction($event)" />
 */
@Component({
  selector: 'app-data-table',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, Tag, Btn, EmptyState, SearchBox, Skeleton],
  host: { '(document:click)': 'closeMenus($event)', '(keydown.escape)': 'closeMenus()' },
  template: `
    <div class="dt">
      @if (searchable()) {
        <div class="dt__bar toolbar">
          <app-search class="toolbar__grow" [(value)]="query" [placeholder]="searchPlaceholder()"
                      ariaLabel="Search this table" />
          <ng-content select="[tableTools]" />
        </div>
      }

      <table class="table" [attr.aria-busy]="loading() ? 'true' : null">
        <thead>
          <tr>
            @for (c of columns(); track c.id) {
              <th scope="col" [attr.data-priority]="c.priority ?? 1" [attr.data-end]="isEnd(c) ? '' : null">
                {{ c.label }}
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
            @for (row of filtered(); track $index) {
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
                  <app-empty-state [title]="query() ? 'No matches' : emptyTitle()"
                                   [text]="query() ? 'Nothing matches “' + query() + '”.' : emptyText()" />
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
    </div>
  `,
})
export class DataTable<T> {
  readonly columns = input.required<TableColumn<T>[]>();
  readonly rows = input.required<T[]>();
  readonly actions = input<(row: T) => RowAction[]>();
  /** column id -> text shown in the footer row */
  readonly totals = input<Record<string, string | undefined>>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search...');
  readonly emptyTitle = input('Nothing here yet');
  readonly emptyText = input('Records you add will appear here.');

  readonly action = output<RowActionEvent<T>>();
  readonly retry = output<void>();

  protected skeletonRows = [0, 1, 2, 3, 4];
  protected query = signal('');

  /** stable, varied bar widths so the skeleton reads like a table of real rows */
  protected barWidth(row: number, col: number, c: TableColumn<T>) {
    if (c.kind === 'tag') return '4.5rem';
    const w = [78, 62, 86, 54, 70][(row * 2 + col * 3) % 5];
    return c.kind === 'money' || c.kind === 'number' ? `${Math.min(w, 60)}%` : `${w}%`;
  }

  /** close any open row-action menu when the click lands outside it, or on Esc */
  protected closeMenus(event?: Event) {
    const target = event?.target as Node | undefined;
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
      if (!target || !d.contains(target)) d.removeAttribute('open');
    });
  }

  protected folded = computed(() => this.columns().filter((c) => c.priority === 3));
  protected span = computed(() => this.columns().length + (this.actions() ? 1 : 0));

  protected filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    const cols = this.columns();
    return this.rows().filter((row) =>
      cols.some((c) => `${c.value(row) ?? ''} ${c.sub?.(row) ?? ''}`.toLowerCase().includes(q)),
    );
  });

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

  protected onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected emit(id: string, row: T) {
    this.action.emit({ id, row });
  }

  protected pick(event: Event, id: string, row: T) {
    (event.target as HTMLElement).closest('details')?.removeAttribute('open');
    this.emit(id, row);
  }
}

export type { IconName };
