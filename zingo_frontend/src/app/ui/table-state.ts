/**
 * table-state.ts - persists a data table's page size, sort and filters (per tableId) and lets the platform layer
 * supply the default page size. A tiny stand-in: when the shared AppStorage wrapper exists in core, the two storage
 * functions here become thin calls into it.
 */
import { InjectionToken } from '@angular/core';

/** What a table remembers between visits. */
export interface SavedTableState {
  pageSize?: number;
  sort?: { column: string; dir: 'asc' | 'desc' } | null;
  filters?: Record<string, unknown>;
}

/**
 * Optional provider of the default rows-per-page (the user preference). The platform layer provides it:
 * `{ provide: TABLE_DEFAULTS, useValue: { pageSize: () => prefs.pageSize() } }`. Without it, tables start at 20.
 */
export const TABLE_DEFAULTS = new InjectionToken<{ pageSize: () => number }>('TABLE_DEFAULTS');

const key = (id: string) => `zg.table.${id}`;

/** read what table `id` saved last time; storage may be blocked, so this never throws */
export function loadTableState(id: string): SavedTableState {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? '{}') as SavedTableState;
  } catch {
    return {};
  }
}

/** save the state of table `id` */
export function saveTableState(id: string, state: SavedTableState): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(state));
  } catch {
    /* storage blocked: the table simply starts fresh next time */
  }
}
