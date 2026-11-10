import { ValueTransformer } from 'typeorm';

/** Postgres returns decimals as strings; this turns them back into numbers. */
export const numeric: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : parseFloat(value),
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
