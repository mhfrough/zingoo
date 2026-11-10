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
