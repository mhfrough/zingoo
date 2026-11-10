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
