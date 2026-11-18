/**
 * Per-viewer conveniences kept in the browser (the partner a staff member last looked at, say). Storage can be
 * missing or blocked (private windows, cleared site data): every read and write is guarded and the page works
 * without it.
 */
export function recall(key: string): string | null {
  try {
    return localStorage.getItem(`zg_pref_${key}`);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string | null | undefined) {
  try {
    if (value) localStorage.setItem(`zg_pref_${key}`, value);
    else localStorage.removeItem(`zg_pref_${key}`);
  } catch {
    // storage blocked: the choice simply is not kept
  }
}
