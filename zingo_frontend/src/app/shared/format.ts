import { formatDate } from '@angular/common';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const moneyFmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const numberFmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 3 });

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

const fixedFmt = (dp: number) => new Intl.NumberFormat('en-PK', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** fixed decimals, no currency: rates per pack and foreign-currency values. 4.25 -> "4.25", 25920 -> "25,920.00" */
export const fmtAmount2 = (v: number | string | null | undefined, dp = 2) => fixedFmt(dp).format(Number(v ?? 0));

/** currency prefix with fixed decimals: ("PKR", 4.25) -> "PKR 4.25" */
export const fmtMoney2 = (v: number | string | null | undefined, cur = 'PKR', dp = 2) => `${cur} ${fmtAmount2(v, dp)}`;

/** a percentage with one decimal: 38.4 -> "38.4%" */
export const fmtPct = (v: number | string | null | undefined) => `${Number(v ?? 0).toFixed(1)}%`;
