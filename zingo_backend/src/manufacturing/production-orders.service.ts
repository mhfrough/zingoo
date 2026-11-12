import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { Role } from '../common/enums';
import { Lookup } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import {
  AcceptProductionOrderDto, CreateProductionOrderDto, ReasonDto, StageDto, UpdateProductionOrderDto,
} from './production-orders.dto';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';

/** who is calling: staff, or a manufacturer login tied to its own manufacturer */
export interface OrderUser {
  id: string;
  name: string;
  role: Role;
  manufacturerId?: string | null;
}

/**
 * Production orders: the company orders containers of a SKU from its manufacturer; the manufacturer accepts or
 * rejects it from its portal and then reports each production step. Nothing posts to the ledger here: the advance
 * payment and the delivery post in their own phases.
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── reads ─────────────

  /** staff see every order (or one manufacturer's); a manufacturer sees its own, never drafts */
  async list(user: OrderUser, manufacturerId?: string) {
    const scope = this.isManufacturer(user) ? this.ownId(user) : manufacturerId;
    const qb = this.db.manager.getRepository(ProductionOrder).createQueryBuilder('o')
      .leftJoinAndSelect('o.product', 'p')
      .leftJoinAndSelect('o.manufacturer', 'm')
      .leftJoinAndSelect('o.distributor', 'd')
      .leftJoinAndSelect('o.events', 'e')
      .orderBy('o.date', 'DESC').addOrderBy('o.refNo', 'DESC').addOrderBy('e.createdAt', 'ASC');
    if (scope) qb.andWhere('o.manufacturerId = :scope', { scope });
    if (this.isManufacturer(user)) qb.andWhere(`o.status <> 'Draft'`);
    const moved = await this.movedMap(this.db.manager);
    return (await qb.getMany()).map((o) => this.shape(o, moved[o.id]));
  }

  async findOne(user: OrderUser, id: string) {
    const o = await this.load(this.db.manager, id);
    this.checkOwner(user, o);
    if (this.isManufacturer(user) && o.status === 'Draft') throw new NotFoundException('Production order not found');
    return this.shape(o, (await this.movedMap(this.db.manager))[o.id]);
  }

  /** the manufacturer a portal page shows: a manufacturer login sees its own, staff pick one (or the first) */
  async profile(user: OrderUser, requested?: string) {
    const em = this.db.manager;
    const id = this.isManufacturer(user) ? this.ownId(user) : requested;
    const m = id
      ? await em.findOne(Manufacturer, { where: { id } })
      : (await em.find(Manufacturer, { order: { name: 'ASC' }, take: 1 }))[0];
    if (!m) throw new NotFoundException('Create a manufacturer first.');
    const orders = await this.list(user, m.id);
    const open = orders.filter((o) => o.status === 'Accepted');
    return {
      manufacturer: m,
      waiting: orders.filter((o) => o.status === 'Sent').length,
      inProduction: open.length,
      containersInProduction: open.reduce((n, o) => n + o.containers, 0),
      valueInProduction: round2(open.reduce((n, o) => n + o.value, 0)),
      stages: (await em.find(Lookup, { where: { list: 'ORDER_STAGE', active: true }, order: { sortOrder: 'ASC' } })).map((l) => l.code),
    };
  }

  // ───────────── company side ─────────────

  async create(user: OrderUser, dto: CreateProductionOrderDto) {
    return this.db.transaction(async (em) => {
      const fields = await this.resolve(em, dto, null);
      const s = await this.settings.get(em);
      const refNo = await nextRef(em, ProductionOrder, s.docPrefixes['production'] ?? 'MO', 3, 1);
      const o = await em.save(em.create(ProductionOrder, { ...fields, refNo, status: 'Draft' }));
      await this.event(em, o.id, user, 'Created', null);
      if (dto.send) await this.markSent(em, o, user);
      return this.shape(await this.load(em, o.id), (await this.movedMap(em))[o.id]);
    });
  }

  async update(user: OrderUser, id: string, dto: UpdateProductionOrderDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      if (o.status !== 'Draft') throw new BadRequestException('Only a draft order can be changed. Cancel it and place a new one.');
      Object.assign(o, await this.resolve(em, dto, o));
      await em.save(o);
      if (dto.send) await this.markSent(em, o, user);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  async remove(id: string) {
    const o = await this.load(this.db.manager, id);
    if (o.status !== 'Draft') throw new BadRequestException('Only a draft order can be deleted. Cancel a sent order instead.');
    await this.db.manager.remove(o);
    return { deleted: true };
  }

  async send(user: OrderUser, id: string) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      if (o.status !== 'Draft') throw new BadRequestException(`${o.refNo} was already sent.`);
      await this.markSent(em, o, user);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  async cancel(user: OrderUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      if (o.status !== 'Sent' && o.status !== 'Accepted') {
        throw new BadRequestException(o.status === 'Draft' ? 'Delete a draft instead of cancelling it.' : `${o.refNo} is already ${o.status.toLowerCase()}.`);
      }
      const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM production_shipments WHERE "orderId" = $1`, [o.id]);
      if (n > 0) throw new BadRequestException(`${o.refNo} has shipments already and can no longer be cancelled.`);
      o.status = 'Cancelled';
      o.reason = dto.reason.trim();
      await em.save(o);
      await this.event(em, o.id, user, 'Cancelled', o.reason);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  // ───────────── manufacturer side (staff may act for it) ─────────────

  async accept(user: OrderUser, id: string, dto: AcceptProductionOrderDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      this.checkOwner(user, o);
      if (o.status !== 'Sent') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}, not waiting for an answer.`);
      if (dto.readyDate && dto.readyDate < o.date) throw new BadRequestException('The ready date cannot be before the order date.');
      o.status = 'Accepted';
      o.readyDate = dto.readyDate ?? null;
      await em.save(o);
      await this.event(em, o.id, user, 'Accepted', [dto.readyDate && `Ready by ${dto.readyDate}`, dto.note?.trim()].filter(Boolean).join(' · ') || null);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  async reject(user: OrderUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      this.checkOwner(user, o);
      if (o.status !== 'Sent') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}, not waiting for an answer.`);
      o.status = 'Rejected';
      o.reason = dto.reason.trim();
      await em.save(o);
      await this.event(em, o.id, user, 'Rejected', o.reason);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  /** report the next production step; steps only move forward along the Settings list */
  async stage(user: OrderUser, id: string, dto: StageDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      this.checkOwner(user, o);
      if (o.status !== 'Accepted') throw new BadRequestException('Accept the order before reporting progress.');
      const stages = (await em.find(Lookup, { where: { list: 'ORDER_STAGE', active: true }, order: { sortOrder: 'ASC' } })).map((l) => l.code);
      const next = stages.indexOf(dto.stage);
      if (next < 0) throw new BadRequestException(`"${dto.stage}" is not a production stage. Choose one from Settings & Data.`);
      const now = o.stage ? stages.indexOf(o.stage) : -1;
      if (next <= now) throw new BadRequestException(`${o.refNo} is already at "${o.stage}". Report a later step.`);
      o.stage = dto.stage;
      await em.save(o);
      await this.event(em, o.id, user, dto.stage, dto.note?.trim() || null);
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  // ───────────── helpers ─────────────

  private isManufacturer(user: OrderUser) {
    return user.role === 'Manufacturer';
  }

  private ownId(user: OrderUser): string {
    if (!user.manufacturerId) throw new ForbiddenException('This login is not linked to a manufacturer.');
    return user.manufacturerId;
  }

  /** a manufacturer login may only touch its own orders */
  private checkOwner(user: OrderUser, o: ProductionOrder) {
    if (this.isManufacturer(user) && o.manufacturerId !== this.ownId(user)) {
      throw new ForbiddenException('This order belongs to another manufacturer.');
    }
  }

  private async load(em: EntityManager, id: string) {
    const o = await em.findOne(ProductionOrder, {
      where: { id }, relations: ['product', 'manufacturer', 'distributor', 'events'], order: { events: { createdAt: 'ASC' } },
    });
    if (!o) throw new NotFoundException('Production order not found');
    return o;
  }

  private async markSent(em: EntityManager, o: ProductionOrder, user: OrderUser) {
    o.status = 'Sent';
    await em.save(o);
    await this.event(em, o.id, user, 'Sent to manufacturer', null);
  }

  private async event(em: EntityManager, orderId: string, user: OrderUser, event: string, note: string | null) {
    await em.save(em.create(ProductionOrderEvent, {
      orderId, event, note, by: user.name, side: this.isManufacturer(user) ? 'Manufacturer' : 'Company',
    }));
  }

  /**
   * Turns the form into order fields: the product decides the manufacturer, distributor, packaging and rate
   * unless the form says otherwise; the advance % comes from the manufacturer.
   */
  private async resolve(em: EntityManager, dto: Partial<CreateProductionOrderDto>, before: ProductionOrder | null) {
    const productId = dto.productId ?? before?.productId;
    const product = productId ? await em.findOne(Product, { where: { id: productId } }) : null;
    if (!product) throw new BadRequestException('Choose a product.');
    if (!product.active && productId !== before?.productId) throw new BadRequestException(`${product.sku} is inactive.`);
    const productChanged = !before || productId !== before.productId;

    const manufacturerId = dto.manufacturerId ?? (productChanged ? product.manufacturerId : before!.manufacturerId);
    const manufacturer = manufacturerId ? await em.findOne(Manufacturer, { where: { id: manufacturerId } }) : null;
    if (!manufacturer) throw new BadRequestException(`Assign a manufacturer to ${product.sku} first, or choose one for this order.`);

    const destination = dto.destination ?? before?.destination ?? 'Distributor';
    let distributorId: string | null = null;
    if (destination === 'Distributor') {
      distributorId = dto.distributorId !== undefined && dto.distributorId !== null
        ? dto.distributorId
        : productChanged || !before?.distributorId ? product.distributorId : before.distributorId;
      if (!distributorId) throw new BadRequestException(`Assign a distributor to ${product.sku} first, choose one, or send the order to the warehouse.`);
      if (!(await em.exists(Distributor, { where: { id: distributorId } }))) throw new BadRequestException('Choose a distributor from Settings & Data.');
    }

    const date = dto.date ?? before!.date;
    const dueDate = dto.dueDate !== undefined ? dto.dueDate : before?.dueDate ?? null;
    if (dueDate && dueDate < date) throw new BadRequestException('The delivery date cannot be before the order date.');

    return {
      date,
      productId: product.id,
      manufacturerId: manufacturer.id,
      destination,
      distributorId,
      containers: dto.containers ?? before!.containers,
      bundlesPerContainer: productChanged ? product.bundlesPerContainer : before!.bundlesPerContainer,
      packetsPerBundle: productChanged ? product.packsPerCarton : before!.packetsPerBundle,
      rate: dto.rate ?? (productChanged ? Number(product.manufacturerRate) : before!.rate),
      advancePct: !before || manufacturer.id !== before.manufacturerId ? Number(manufacturer.advancePct ?? 0) : before.advancePct,
      dueDate,
      notes: dto.notes !== undefined ? dto.notes?.trim() || null : before?.notes ?? null,
    };
  }

  /** containers shipped and received per order */
  private async movedMap(em: EntityManager): Promise<Record<string, { shipped: number; received: number }>> {
    const rows: { orderId: string; shipped: number; received: number }[] = await em.query(
      `SELECT "orderId", SUM(containers)::int AS shipped, COALESCE(SUM("receivedContainers"), 0)::int AS received
         FROM production_shipments GROUP BY "orderId"`);
    return Object.fromEntries(rows.map((r) => [r.orderId, { shipped: Number(r.shipped), received: Number(r.received) }]));
  }

  /** the order with its worked-out quantities and money */
  private shape(o: ProductionOrder, moved?: { shipped: number; received: number }) {
    const bundles = o.containers * o.bundlesPerContainer;
    const packets = bundles * o.packetsPerBundle;
    const value = round2(packets * Number(o.rate));
    return {
      ...o,
      bundles,
      packets,
      value,
      advanceAmount: round2((value * Number(o.advancePct)) / 100),
      shippedContainers: moved?.shipped ?? 0,
      receivedContainers: moved?.received ?? 0,
      // late: past its date and not everything arrived yet
      overdue: !!o.dueDate && o.status === 'Accepted' && (moved?.received ?? 0) < o.containers && o.dueDate < new Date().toISOString().slice(0, 10),
    };
  }
}
