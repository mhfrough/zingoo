/**
 * Pure helpers for the money input: what is shown while typing (with thousands commas) and the number behind it.
 * No Angular here, so the rules are easy to test on their own.
 *
 *   cleanMoney('12a3,4.567', 2) -> '1234.56'      only digits and one point, at most 2 decimals
 *   groupMoney('1234567.5')     -> '1,234,567.5'  commas in the whole part
 *   formatMoney(1234567.5, 2)   -> '1,234,567.5'
 *   parseMoney('1,234,567.5')   -> 1234567.5
 *
 * Commas are always western style (1,234,567): that is what people type and read in an input, whatever number
 * format the rest of the app uses for display.
 */

/** Keeps only digits and a single decimal point (and a leading minus when allowed); cuts the decimals to `decimals`. */
export function cleanMoney(raw: string, decimals: number, allowNegative = false): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let out = '';
  let seenPoint = false;
  let fraction = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (seenPoint) {
        if (fraction >= decimals) continue;
        fraction++;
      }
      out += ch;
    } else if (ch === '.' && !seenPoint && decimals > 0) {
      seenPoint = true;
      out += out === '' ? '0.' : '.';
    }
  }
  // leading zeros in the whole part: 007 -> 7 (but keep a single 0 and "0.")
  out = out.replace(/^0+(?=\d)/, '');
  return negative && out !== '' ? `-${out}` : out;
}

/** Puts a comma between thousands in the whole part of a cleaned string. */
export function groupMoney(clean: string): string {
  const sign = clean.startsWith('-') ? '-' : '';
  const body = sign ? clean.slice(1) : clean;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot);
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
}

/** The text for a number: grouped, no trailing zeros unless `fixed` (then always `decimals` places). */
export function formatMoney(value: number | null | undefined, decimals: number, fixed = false): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const text = fixed ? n.toFixed(decimals) : String(Math.round(n * 10 ** decimals) / 10 ** decimals);
  // very small or very large numbers print in exponent form; fall back to a plain fixed string
  const plain = /e/i.test(text) ? n.toFixed(decimals) : text;
  return groupMoney(plain);
}

/** The number behind the shown text; null when there is no number yet ("", "-", "."). */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/,/g, '').trim();
  if (clean === '' || clean === '-' || clean === '.' || clean === '-.') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** How many digits and decimal points (the characters that matter) are before `upto` in `text`. */
export function countSignificant(text: string, upto: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(upto, text.length); i++) if (/[\d.]/.test(text[i])) n++;
  return n;
}

/** Where the caret goes in `text` so that exactly `significant` digits / points are before it. */
export function caretAfter(text: string, significant: number): number {
  if (significant <= 0) return text.startsWith('-') ? 1 : 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[\d.]/.test(text[i])) n++;
    if (n === significant) return i + 1;
  }
  return text.length;
}
