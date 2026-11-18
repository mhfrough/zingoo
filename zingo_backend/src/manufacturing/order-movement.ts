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

/** the date the goods should reach the distributor: ready date plus the transit days of Settings */
export const expectedDate = (readyDate: string | null | undefined, transitDays: number | null | undefined) => {
  if (!readyDate) return null;
  const d = new Date(`${String(readyDate).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (transitDays ?? 2));
  return d.toISOString().slice(0, 10);
};
