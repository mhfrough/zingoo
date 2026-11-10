import { formatDate } from '@angular/common';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/** the number format (locale) the whole app uses; Settings & Data changes it through setNumberLocale() */
let locale = 'en-PK';
let moneyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
let numberFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
const fixed = new Map<number, Intl.NumberFormat>();

/** switch every amount and number to another locale (for example en-PK or en-US); a code the browser does not know is ignored */
export function setNumberLocale(code: string | null | undefined) {
  if (!code || code === locale) return;
  try {
    moneyFmt = new Intl.NumberFormat(code, { maximumFractionDigits: 0 });
    numberFmt = new Intl.NumberFormat(code, { maximumFractionDigits: 3 });
    fixed.clear();
    locale = code;
  } catch {
    /* an unknown locale keeps the current format */
  }
}

/** 1897000 -> "PKR 1,897,000" */
export const fmtMoney = (v: number | string | null | undefined, cur = 'PKR') =>
  `${cur} ${moneyFmt.format(Number(v ?? 0))}`;

/** amount without the currency prefix (used in tables where the column says PKR) */
export const fmtAmount = (v: number | string | null | undefined) => moneyFmt.format(Number(v ?? 0));

export const fmtNumber = (v: number | string | null | undefined) => numberFmt.format(Number(v ?? 0));

/** "2026-11-05" -> "05 Nov 2026" */
export const fmtDate = (v: string | null | undefined) => (v ? formatDate(v, 'dd MMM yyyy', 'en-US') : '');

/** PARTIALLY_PAID -> Partially paid */
export const sentence = (v: string) => {
  const s = v.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const fixedFmt = (dp: number) => {
  let f = fixed.get(dp);
  if (!f) fixed.set(dp, (f = new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })));
  return f;
};

/** fixed decimals, no currency: rates per pack and foreign-currency values. 4.25 -> "4.25", 25920 -> "25,920.00" */
export const fmtAmount2 = (v: number | string | null | undefined, dp = 2) => fixedFmt(dp).format(Number(v ?? 0));

/** currency prefix with fixed decimals: ("PKR", 4.25) -> "PKR 4.25" */
export const fmtMoney2 = (v: number | string | null | undefined, cur = 'PKR', dp = 2) => `${cur} ${fmtAmount2(v, dp)}`;

/** a percentage with one decimal: 38.4 -> "38.4%" */
export const fmtPct = (v: number | string | null | undefined) => `${Number(v ?? 0).toFixed(1)}%`;
