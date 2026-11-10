/**
 * tab-memory.ts - remembers the last tab of each page in localStorage.
 * A tiny stand-in: when the shared AppStorage wrapper exists in core, this file becomes a thin call into it.
 */
const KEY = 'zg.tabs';

/** read the whole page -> tab map; storage may be blocked, so every access is guarded */
function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** the tab id last used on `page` (a path like /admin/manufacturing), or null */
export function lastTab(page: string): string | null {
  return readAll()[page] ?? null;
}

/** remember that `id` was the last tab used on `page` */
export function rememberTab(page: string, id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [page]: id }));
  } catch {
    /* storage blocked: the tab simply is not remembered */
  }
}
