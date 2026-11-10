/** Read a duration token (e.g. "--dur-fast" -> 120). Returns 0 under prefers-reduced-motion, where the tokens are 0ms. */
export function tokenMs(el: Element, token = '--dur-fast'): number {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return 0;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
