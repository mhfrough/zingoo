import { EntityManager } from 'typeorm';

/** containers shipped and received per production order (for "on the way" / "delivered" in order lists) */
export async function movementOf(em: EntityManager, orderIds: string[]): Promise<Record<string, { shipped: number; received: number }>> {
  const ids = orderIds.filter(Boolean);
  if (!ids.length) return {};
  const rows: { orderId: string; shipped: number; received: number }[] = await em.query(
    `SELECT "orderId", SUM(containers)::int AS shipped,
            SUM(CASE WHEN status = 'Received' THEN COALESCE("receivedContainers", 0) ELSE 0 END)::int AS received
       FROM production_shipments WHERE "orderId" = ANY($1) GROUP BY "orderId"`, [ids]);
  return Object.fromEntries(rows.map((r) => [r.orderId, { shipped: Number(r.shipped), received: Number(r.received) }]));
}
