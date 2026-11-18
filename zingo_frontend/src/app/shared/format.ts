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
/** "Masala Masti · Z10-MAS": what a row is about, name first (the code alone is hard to place) */
export const productLabel = (p: { name?: string | null; sku: string } | null | undefined) =>
  (!p ? '-' : p.name && p.name !== p.sku ? `${p.name} · ${p.sku}` : p.sku);
/** "3 containers (30 bundles)" */
const dayMs = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The payment-terms countdown of an unpaid invoice: "16 of 30 days left", "Due today", "5 days late".
 * `from` is the invoice (or dispatch) date the terms run from; nothing when there is no due date.
 */
export const dueCountdown = (from: string | null | undefined, due: string | null | undefined): string | null => {
  if (!due) return null;
  const left = Math.round((dayOf(due) - dayOf(todayIso())) / dayMs);
  const total = from ? Math.max(0, Math.round((dayOf(due) - dayOf(from)) / dayMs)) : 0;
  if (left < 0) return `${-left} day${left === -1 ? '' : 's'} late`;
  if (left === 0) return 'Due today';
  return total >= left ? `${left} of ${total} days left` : `${left} day${left === 1 ? '' : 's'} left`;
};

/** red once past due, amber in the last 3 days, none otherwise */
export const dueTone = (due: string | null | undefined): Tone | null => {
  if (!due) return null;
  const left = Math.round((dayOf(due) - dayOf(todayIso())) / dayMs);
  return left < 0 ? 'danger' : left <= 3 ? 'warning' : null;
};

/** "2 containers (Bora)": the product's container unit in brackets (Settings list CONTAINER_UNIT), none when not set */
export const containersLabel = (containers: number, unit?: string | null) =>
  `${containers.toLocaleString('en-US')} container${containers === 1 ? '' : 's'}${unit ? ` (${unit})` : ''}`;
/** "2 containers (Bora) · 20 bundles", or "2 containers (20 bundles)" when the product has no container unit */
export const qtyLabel = (containers: number, bundles?: number | null, unit?: string | null) =>
  unit
    ? `${containersLabel(containers, unit)}${bundles ? ` · ${bundles.toLocaleString('en-US')} bundles` : ''}`
    : `${containersLabel(containers)}${bundles ? ` (${bundles.toLocaleString('en-US')} bundles)` : ''}`;
/** 16 Nov 2026, 14:05 (a stored time, in the viewer's clock) */
export const fmtDateTime = (v: string | null | undefined) => (v ? formatDate(v, 'dd MMM yyyy, HH:mm', 'en-US') : '');

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

/**
 * A record's own date for the line under its number, or null when it is the day the record was added
 * (the "Last update" column already shows that, so the date is not repeated). Rows without createdAt keep it.
 */
export const docDate = (r: object, date = (r as { date?: string | null }).date) => {
  const added = (r as { createdAt?: string | null }).createdAt;
  if (!date) return null;
  return added && fmtDate(date) === fmtDate(added) ? null : fmtDate(date);
};
/** "a · b · c" from the parts that are present (null when none is) */
export const subLine = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || null;
