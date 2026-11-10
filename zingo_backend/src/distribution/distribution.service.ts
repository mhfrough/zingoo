import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { StockService } from '../catalog/stock.service';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { AuditLog } from '../portal/portal.entities';
import { LookupsService } from '../setup/lookups.service';
import { Setting } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { CreateCollectionDto, CreateOrderDto, UpdateOrderDto } from './distribution.dto';
import { Collection, SalesOrder } from './distribution.entities';

const today = () => new Date().toISOString().slice(0, 10);

/** Add `days` to an ISO date (UTC, so the result does not depend on the server time zone). */
export function datePlus(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** invoice value = cartons x packs per carton x price per pack */
export function billedOf(o: SalesOrder, s: Setting): number {
  const packs = o.packsPerCarton || o.product?.packsPerCarton || s.packsPerCarton;
  return round2(o.cartons * packs * Number(o.rate));
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
  ) {}

  private async collectedMap(em: EntityManager): Promise<Record<string, number>> {
    const rows: { orderId: string; total: number }[] = await em.query(
      `SELECT "orderId", SUM(amount)::float8 AS total FROM collections GROUP BY "orderId"`,
    );
    return Object.fromEntries(rows.map((r) => [r.orderId, r.total]));
  }

  /** what each distributor still owes on dispatched orders (the "exposure" before a new order) */
  private async openByDistributor(em: EntityManager): Promise<Record<string, number>> {
    const rows: { id: string; open: number }[] = await em.query(`
      SELECT o."distributorId" AS id,
             COALESCE(SUM(GREATEST(0, o.cartons * o."packsPerCarton" * o.rate - COALESCE(c.paid, 0))), 0)::float8 AS open
        FROM sales_orders o
        LEFT JOIN (SELECT "orderId", SUM(amount) AS paid FROM collections GROUP BY "orderId") c ON c."orderId" = o.id
       WHERE o.status = 'Dispatched'
       GROUP BY o."distributorId"`);
    return Object.fromEntries(rows.map((r) => [r.id, round2(r.open)]));
  }

  private decorate(o: SalesOrder, s: Setting, collected: Record<string, number>, open: Record<string, number>) {
    const billed = billedOf(o, s);
    const paid = round2(collected[o.id] ?? 0);
    const terms = o.paymentTermsDays ?? o.distributor?.paymentDays ?? s.defaultPaymentCycle;

    // Credit hold: a draft order may not push the distributor over the credit limit.
    // (A limit of 0 means "no limit set", so it never holds. The prototype would hold every order.)
    const limit = Number(o.distributor?.creditLimit ?? 0);
    const projectedExposure = o.status === 'Draft' ? round2((open[o.distributorId] ?? 0) + billed) : null;
    const creditHold = o.status === 'Draft' && limit > 0 && !o.creditOverride && (projectedExposure ?? 0) > limit;

    return {
      ...o,
      billed,
      collected: paid,
      outstanding: o.status === 'Dispatched' ? Math.max(0, round2(billed - paid)) : 0,
      paymentTermsDays: terms,
      dueDate: o.dueDate ?? datePlus(o.dispatchDate ?? o.date, terms),
      creditLimit: limit,
      projectedExposure,
      creditHold,
    };
  }

  async list() {
    const em = this.db.manager;
    const [rows, s, collected, open] = await Promise.all([
      em.find(SalesOrder, { relations: ['distributor', 'product'], order: { date: 'DESC', refNo: 'DESC' } }),
      this.settings.get(),
      this.collectedMap(em),
      this.openByDistributor(em),
    ]);
    return rows.map((o) => this.decorate(o, s, collected, open));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const o = await em.findOne(SalesOrder, { where: { id }, relations: ['distributor', 'product'] });
    if (!o) throw new NotFoundException('Order not found');
    return this.decorate(o, await this.settings.get(em), await this.collectedMap(em), await this.openByDistributor(em));
  }

  create(dto: CreateOrderDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const s = await this.settings.get(em);
      const refNo = opts.refNo ?? (await nextRef(em, SalesOrder, s.docPrefixes['sales'] ?? 'SO', 3, 201));
      const o = await em.save(em.create(SalesOrder, { ...dto, refNo, status: 'Draft' }));
      return this.findOne(o.id, em);
    });
  }

  update(id: string, dto: UpdateOrderDto) {
    return this.db.transaction(async (em) => {
      const o = await em.findOne(SalesOrder, { where: { id } });
      if (!o) throw new NotFoundException('Order not found');
      if (o.status === 'Dispatched') throw new BadRequestException('Dispatched orders are locked to keep stock and invoices correct.');
      await em.save(em.merge(SalesOrder, o, dto));
      return this.findOne(id, em);
    });
  }

  async remove(id: string) {
    const o = await this.db.manager.findOne(SalesOrder, { where: { id } });
    if (!o) throw new NotFoundException('Order not found');
    if (o.status !== 'Draft') throw new BadRequestException('Only draft orders can be deleted.');
    await this.db.manager.remove(o);
    return { deleted: true };
  }

  /** Finance lets a draft order through although the distributor is over the credit limit. */
  creditOverride(id: string, reason: string, user: { name?: string }) {
    return this.db.transaction(async (em) => {
      const o = await em.findOne(SalesOrder, { where: { id } });
      if (!o) throw new NotFoundException('Order not found');
      if (o.status !== 'Draft') throw new BadRequestException('Only draft orders can be overridden.');
      o.creditOverride = true;
      o.creditOverrideNote = reason;
      await em.save(o);
      await em.save(em.create(AuditLog, { event: 'Credit override', reference: o.refNo, notes: reason, by: user.name ?? 'Unknown' }));
      return this.findOne(id, em);
    });
  }

  /** Draft -> Dispatched: stock goes down, the invoice and the cost of goods sold are posted. */
  dispatch(id: string, opts: { dispatchDate?: string } = {}) {
    return this.db.transaction(async (em) => {
      const o = await em.findOne(SalesOrder, { where: { id }, relations: ['product', 'distributor'] });
      if (!o) throw new NotFoundException('Order not found');
      if (o.status !== 'Draft') throw new BadRequestException('Only draft orders can be dispatched.');

      const s = await this.settings.get(em);
      const view = this.decorate(o, s, await this.collectedMap(em), await this.openByDistributor(em));
      if (view.creditHold) {
        throw new BadRequestException(
          `Credit hold: projected debt PKR ${view.projectedExposure} exceeds the distributor limit of PKR ${view.creditLimit}. Ask finance to review.`,
        );
      }

      const available = await this.stock.stockOf(o.productId, em);
      if (available < o.cartons) {
        throw new BadRequestException(`Insufficient stock: ${available} cartons available; ${o.cartons} required.`);
      }

      o.status = 'Dispatched';
      o.dispatchDate = opts.dispatchDate ?? today();
      o.unitCost = await this.stock.unitCostFor(o.productId, em);
      o.packsPerCarton = o.product.packsPerCarton || s.packsPerCarton;
      o.paymentTermsDays = o.paymentTermsDays ?? o.distributor.paymentDays ?? s.defaultPaymentCycle;
      o.dueDate = datePlus(o.dispatchDate, o.paymentTermsDays);
      await em.save(o);
      await this.posting.syncOrder(em, id);
      return this.findOne(id, em);
    });
  }
}

@Injectable()
export class CollectionsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
  ) {}

  list() {
    return this.db.manager.find(Collection, { relations: ['order', 'order.distributor'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  /** Records money received. It cannot be more than what the distributor still owes on the order. */
  create(dto: CreateCollectionDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const order = await em.findOne(SalesOrder, { where: { id: dto.orderId }, relations: ['product'] });
      if (!order) throw new NotFoundException('Order not found');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (order.status !== 'Dispatched') throw new BadRequestException('Only dispatched orders accept payments.');

      const s = await this.settings.get(em);
      const [{ paid }] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM collections WHERE "orderId" = $1`, [order.id]);
      const due = round2(billedOf(order, s) - Number(paid));
      if (due <= 0) throw new BadRequestException('This order is already fully paid.');
      if (dto.amount > due + 0.001) throw new BadRequestException(`Payment cannot exceed the outstanding amount of PKR ${due}.`);

      const refNo = opts.refNo ?? (await nextRef(em, Collection, 'RC', 2));
      const c = await em.save(em.create(Collection, { ...dto, refNo, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncCollection(em, c.id);
      return c;
    });
  }
}
