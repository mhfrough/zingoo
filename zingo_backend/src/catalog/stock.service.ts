import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { round2 } from '../common/numeric.transformer';

/**
 * Warehouse stock in bundles (the columns still say cartons) and the average factory cost per bundle.
 *   stock = released batches + manufacturer deliveries into the warehouse - dispatched sales orders - shipped exports
 */
@Injectable()
export class StockService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** cartons in stock per product id */
  async stockByProduct(em: EntityManager = this.db.manager): Promise<Record<string, number>> {
    const rows: { id: string; stock: string }[] = await em.query(`
      SELECT p.id,
        COALESCE((SELECT SUM(b."producedCartons") FROM production_batches b WHERE b."productId" = p.id AND b.status = 'Released'), 0)
      + COALESCE((SELECT SUM(s."receivedContainers" * s."bundlesPerContainer") FROM production_shipments s
                   WHERE s."productId" = p.id AND s.destination = 'Warehouse' AND s.status = 'Received'), 0)
      - COALESCE((SELECT SUM(o.cartons) FROM sales_orders o WHERE o."productId" = p.id AND o.status = 'Dispatched'), 0)
      - COALESCE((SELECT SUM(e.cartons) FROM export_shipments e WHERE e."productId" = p.id AND e.status = 'Shipped'), 0) AS stock
      FROM products p`);
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.stock)]));
  }

  async stockOf(productId: string, em: EntityManager = this.db.manager): Promise<number> {
    return (await this.stockByProduct(em))[productId] ?? 0;
  }

  /** average cost per carton of released production (0 when nothing was released yet) */
  async unitCostFor(productId: string, em: EntityManager = this.db.manager): Promise<number> {
    const [r]: { cost: string | null; cartons: string | null }[] = await em.query(
      `SELECT SUM(cost) AS cost, SUM(cartons) AS cartons FROM (
         SELECT cost, "producedCartons" AS cartons FROM production_batches
          WHERE "productId" = $1 AND status = 'Released' AND "producedCartons" > 0
         UNION ALL
         SELECT "receivedContainers" * "bundlesPerContainer" * "packetsPerBundle" * rate, "receivedContainers" * "bundlesPerContainer"
           FROM production_shipments
          WHERE "productId" = $1 AND destination = 'Warehouse' AND status = 'Received' AND "receivedContainers" > 0
       ) x`,
      [productId],
    );
    const cartons = Number(r?.cartons ?? 0);
    return cartons ? round2(Number(r.cost) / cartons) : 0;
  }
}
