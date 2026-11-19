import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager, EntityTarget } from 'typeorm';

/**
 * Next human reference for a document table: B-1005, SO-204, FIN-007 ...
 * Looks at the highest number already used with this prefix, so seeded refs (B-1001) are respected.
 */
export async function nextRef(
  em: EntityManager,
  entity: EntityTarget<{ refNo: string }>,
  prefix: string,
  width = 3,
  start = 1,
): Promise<string> {
  const table = em.connection.getMetadata(entity).tableName;
  const rows: { n: string | null }[] = await em.query(
    `SELECT MAX(CAST(SUBSTRING("refNo" FROM '([0-9]+)$') AS BIGINT)) AS n
       FROM "${table}" WHERE "refNo" LIKE $1 AND "refNo" ~ '^[A-Za-z]+-[0-9]+$'`,
    [`${prefix}-%`],
  );
  const next = rows[0]?.n ? Number(rows[0].n) + 1 : start;
  return `${prefix}-${String(next).padStart(width, '0')}`;
}

/**
 * Document numbers a person may type instead of the next one: where each kind lives, its Settings prefix and how the
 * next number is written. A typed number must not be used already (letter case does not matter).
 */
export const REF_KINDS = {
  /** production order MO-001 */
  production: { table: 'production_orders', column: 'refNo', prefixKey: 'production', prefix: 'MO', width: 3, start: 1, word: 'order number' },
  /** the distributor's order DO-001 (one number for every product line) */
  distOrder: { table: 'portal_requests', column: 'groupRef', prefixKey: 'distOrder', prefix: 'DO', width: 3, start: 1, word: 'order number' },
  /** product / SKU code SKU-001 */
  product: { table: 'products', column: 'sku', prefixKey: 'product', prefix: 'SKU', width: 3, start: 1, word: 'SKU code' },
  /** a manufacturer's invoice (payment request) PR-001 */
  mfrInvoice: { table: 'mfr_payment_requests', column: 'refNo', prefixKey: 'mfrRequest', prefix: 'PR', width: 3, start: 1, word: 'invoice number' },
} as const;
export type RefKind = keyof typeof REF_KINDS;

/** the next number of a kind, with the prefix set on Settings & Data */
export async function nextNumber(em: EntityManager, kind: RefKind, prefixes: Record<string, string> = {}): Promise<string> {
  const k = REF_KINDS[kind];
  const prefix = prefixes[k.prefixKey] || k.prefix;
  const rows: { n: string | null }[] = await em.query(
    `SELECT MAX(CAST(SUBSTRING("${k.column}" FROM '([0-9]+)$') AS BIGINT)) AS n
       FROM "${k.table}" WHERE "${k.column}" LIKE $1 AND "${k.column}" ~ '^[A-Za-z]+-[0-9]+$'`,
    [`${prefix}-%`],
  );
  const next = rows[0]?.n ? Number(rows[0].n) + 1 : k.start;
  return `${prefix}-${String(next).padStart(k.width, '0')}`;
}

/** true when the number is already used (another row than `exceptId`) */
export async function refTaken(em: EntityManager, kind: RefKind, value: string, exceptId: string | null = null): Promise<boolean> {
  const k = REF_KINDS[kind];
  const rows: unknown[] = await em.query(
    `SELECT 1 FROM "${k.table}" WHERE lower(trim("${k.column}")) = lower(trim($1)) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [value, exceptId],
  );
  return rows.length > 0;
}

/**
 * A typed number, tidied and checked: 1 to 30 letters, digits and - _ / . ; throws when it is used already.
 * With `next`: a number in the suggested pattern (MO-028) that someone else took meanwhile gives way to the next free
 * one, so two people saving forms opened at the same time both succeed.
 */
export async function claimRef(
  em: EntityManager, kind: RefKind, value: string, exceptId: string | null = null, next?: { prefixes: Record<string, string>; make: () => Promise<string> },
): Promise<string> {
  const v = String(value ?? '').trim().replace(/\s+/g, '-');
  const word = REF_KINDS[kind].word;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,29}$/.test(v)) throw new BadRequestException(`Use 1 to 30 letters, digits and - _ / . for the ${word}.`);
  if (await refTaken(em, kind, v, exceptId)) {
    const prefix = next ? next.prefixes[REF_KINDS[kind].prefixKey] || REF_KINDS[kind].prefix : null;
    if (next && prefix && new RegExp(`^${prefix}-[0-9]+$`, 'i').test(v)) return next.make();
    throw new ConflictException(`The ${word} ${v} is already used. Keep the suggested one or type another.`);
  }
  return v;
}
