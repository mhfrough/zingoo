import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Distributor, Manufacturer, Product, makerTotal } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { claimRef, nextRef } from '../common/ref';
import { Role } from '../common/enums';
import { Lookup } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { LINK, Note, NotificationsService, TEAM, plural } from '../notifications/notifications.service';
import {
  AcceptProductionOrderDto, CreateProductionOrderDto, ReasonDto, StageDto, UpdateProductionOrderDto,
} from './production-orders.dto';
import { OrderTransport, ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { GroupAcceptDto, GroupReasonDto, GroupStageDto } from './production-orders.dto';
import { ProductionShipment } from './shipments.entities';
import { expectedDate } from './order-movement';
import { Attachment } from '../attachments/attachment.entity';
import { AttachmentsService } from '../attachments/attachments.service';

/** what a file on an order is: the signed dispatch voucher, the manufacturer's invoice copy, anything else */
export const ORDER_DOC_KINDS = ['CHALLAN', 'INVOICE', 'OTHER', 'HANDOVER'] as const;
export type OrderDocKind = (typeof ORDER_DOC_KINDS)[number];
const ORDER_DOC_TYPES: string[] = ORDER_DOC_KINDS.map((k) => `ORDER_${k}`);
import { DeliveryClaim } from './delivery-claims.entities';

/** who is calling: staff, or a manufacturer login tied to its own manufacturer */
export interface OrderUser {
  id: string;
  name: string;
  role: Role;
  manufacturerId?: string | null;
  distributorId?: string | null;
}

/**
 * Production orders: the company orders containers of a SKU from its manufacturer; the manufacturer accepts or
 * rejects it from its portal and then reports each production step. Nothing posts to the ledger here: the advance
 * payment and the delivery post in their own phases.
 */
/** trimmed transport with the empty fields dropped; null when nothing is left */
export function cleanTransport(t: OrderTransport | null | undefined): OrderTransport | null {
  if (!t) return null;
  const out: OrderTransport = {};
  for (const k of ['transporter', 'vehicleNo', 'driverName', 'driverPhone', 'driverCnic'] as const) {
    const v = t[k]?.trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class ProductionOrdersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly settings: SettingsService,
    private readonly notes: NotificationsService,
    private readonly attachments: AttachmentsService,
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
    const rows = await qb.getMany();
    // staff also see what the distributor pays for the goods (inflow) against the manufacturer's price (outflow)
    const sale = this.isManufacturer(user) ? {} : await this.saleRates(this.db.manager);
    return rows.map((o) => this.shape(o, moved[o.id], sale));
  }

  /** the distributor's price per packet for every distributor and SKU: its agreed rate, else the product's */
  private async saleRates(em: EntityManager): Promise<Record<string, number>> {
    const [agreed, products]: [{ distributorId: string; productId: string; rate: number }[], { id: string; rate: number }[]] = await Promise.all([
      em.query(`SELECT "distributorId", "productId", rate::float8 AS rate FROM distributor_rates`),
      em.query(`SELECT id, rate::float8 AS rate FROM products`),
    ]);
    return {
      ...Object.fromEntries(products.map((p) => [`*|${p.id}`, Number(p.rate)])),
      ...Object.fromEntries(agreed.map((a) => [`${a.distributorId}|${a.productId}`, Number(a.rate)])),
    };
  }

  async findOne(user: OrderUser, id: string) {
    const o = await this.load(this.db.manager, id);
    this.checkOwner(user, o);
    if (this.isManufacturer(user) && o.status === 'Draft') throw new NotFoundException('Production order not found');
    return this.shape(o, (await this.movedMap(this.db.manager))[o.id]);
  }

  /**
   * One order in full for the order panel: the order with its timeline, every load that left the factory (with
   * transport), the claims raised on it and the production steps. A manufacturer sees only its own (never drafts),
   * a distributor only the orders made for it; the partner money filter still applies on the way out.
   */
  /** the order if this login may see it: its manufacturer (not drafts), the distributor it is for, or staff */
  private async visible(em: EntityManager, user: OrderUser, id: string) {
    const o = await this.load(em, id);
    this.checkOwner(user, o);
    if (this.isManufacturer(user) && o.status === 'Draft') throw new NotFoundException('Production order not found');
    if (user.role === 'Distributor') {
      if (!user.distributorId) throw new ForbiddenException('This login is not linked to a distributor.');
      if (o.distributorId !== user.distributorId || o.status === 'Draft') throw new NotFoundException('Production order not found');
    }
    return o;
  }

  /** the order's files: signed dispatch vouchers, the manufacturer's invoice copies (never shown to the distributor), others */
  private async documentsOf(em: EntityManager, user: OrderUser, id: string) {
    const kinds = user.role === 'Distributor' ? ['ORDER_CHALLAN', 'ORDER_OTHER', 'ORDER_HANDOVER'] : ORDER_DOC_TYPES;
    const rows = await em.find(Attachment, { where: { ownerId: id, ownerType: In(kinds) }, order: { createdAt: 'ASC' } });
    return rows.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.ownerType!.slice(6), uploadedBy: a.uploadedBy, createdAt: a.createdAt }));
  }

  /**
   * Adds a file to an order: CHALLAN = the dispatch voucher signed by the driver / receiver (manufacturer, distributor
   * or staff), INVOICE = the manufacturer's own invoice copy (manufacturer or staff), OTHER = anything else.
   */
  async addDocument(user: OrderUser, id: string, kind: OrderDocKind, file: Parameters<AttachmentsService['create']>[0]) {
    const em = this.db.manager;
    const o = await this.visible(em, user, id);
    if ((kind === 'INVOICE' || kind === 'HANDOVER') && user.role === 'Distributor') throw new ForbiddenException('Only the manufacturer or Zen Foods attach this.');
    if (o.status !== 'Accepted') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}: documents go on an accepted order.`);
    const meta = await this.attachments.create(file, user.name, { type: `ORDER_${kind}`, id });
    const what = kind === 'CHALLAN' ? 'Signed dispatch voucher' : kind === 'INVOICE' ? 'Manufacturer invoice copy' : kind === 'HANDOVER' ? 'Proof of handover' : 'Document';
    await this.event(em, id, user, `${what} attached`, meta.name);
    if (kind === 'CHALLAN') {
      await this.notes.send(em, user,
        { to: { staff: TEAM.manufacturing }, kind: 'order.document', refNo: o.refNo, link: LINK.manufacturing('orders'),
          title: `Signed dispatch voucher on ${o.refNo}`, body: `${meta.name} · by ${user.name}` },
        ...(o.distributorId && user.role !== 'Distributor' ? [{ to: { distributorId: o.distributorId }, kind: 'order.document', refNo: o.refNo, link: LINK.portal('stock'),
          title: `Signed dispatch voucher on ${o.refNo}`, body: meta.name }] : []),
        ...(user.role !== 'Manufacturer' ? [{ to: { manufacturerId: o.manufacturerId }, kind: 'order.document', refNo: o.refNo, link: LINK.factory,
          title: `Signed dispatch voucher on ${o.refNo}`, body: meta.name }] : []),
      );
    }
    return { ...meta, kind };
  }

  /** one of the order's files, if this login may see the order (and, for a distributor, not an invoice copy) */
  async documentContent(user: OrderUser, id: string, docId: string) {
    const em = this.db.manager;
    await this.visible(em, user, id);
    const a = await this.attachments.content(docId);
    const allowed = user.role === 'Distributor' ? ['ORDER_CHALLAN', 'ORDER_OTHER', 'ORDER_HANDOVER'] : ORDER_DOC_TYPES;
    if (a.ownerId !== id || !allowed.includes(a.ownerType ?? '')) throw new NotFoundException('File not found.');
    return a;
  }

  /** the uploader (or Admin / Manufacturing) removes a file while no invoice uses it */
  async removeDocument(user: OrderUser, id: string, docId: string) {
    const em = this.db.manager;
    await this.visible(em, user, id);
    const a = await em.findOne(Attachment, { where: { id: docId } });
    if (!a || a.ownerId !== id || !ORDER_DOC_TYPES.includes(a.ownerType ?? '')) throw new NotFoundException('File not found.');
    if (a.uploadedBy !== user.name && !['Admin', 'Manufacturing'].includes(user.role)) throw new ForbiddenException('Only the person who attached it can remove it.');
    const used: unknown[] = await em.query(`SELECT 1 FROM mfr_payment_requests WHERE "invoiceFileId" = $1 AND status = 'Submitted' LIMIT 1`, [docId]);
    if (used.length) throw new BadRequestException('A payment request uses this invoice copy. Withdraw the request first.');
    await em.remove(a);
    await this.event(em, id, user, 'Document removed', a.name);
    return { deleted: true };
  }

  async detail(user: OrderUser, id: string) {
    const em = this.db.manager;
    const o = await this.visible(em, user, id);
    // the other products of the same combined order (same DO- number, same manufacturer)
    const group = o.groupRef
      ? (await em.find(ProductionOrder, { where: { groupRef: o.groupRef, manufacturerId: o.manufacturerId }, order: { refNo: 'ASC' } }))
        .filter((x) => !(this.isManufacturer(user) && x.status === 'Draft'))
      : [o];
    const ids = group.map((x) => x.id);
    const moved = await this.movedMap(em);
    const lines = await Promise.all(group.map(async (x) => this.shape(await this.load(em, x.id), moved[x.id])));
    const [shipments, claims, stages] = await Promise.all([
      em.find(ProductionShipment, { where: { orderId: In(ids) }, order: { shipDate: 'ASC', createdAt: 'ASC' } }),
      em.find(DeliveryClaim, { where: { orderId: In(ids) }, order: { date: 'ASC', createdAt: 'ASC' } }),
      em.find(Lookup, { where: { list: 'ORDER_STAGE', active: true }, order: { sortOrder: 'ASC' } }),
    ]);
    const steps = stages.map((l) => l.code);
    const last = steps[steps.length - 1] ?? null;
    // the manufacturer's invoices on this order (never to the distributor: they carry the manufacturer's price)
    const invoices = user.role === 'Distributor' ? [] : (await Promise.all(ids.map((x) => this.invoicesOf(em, x)))).flat();
    const s = await this.settings.get(em);
    return {
      order: this.shape(o, (await this.movedMap(em))[o.id]),
      /** ready date plus the transit days of Settings */
      expectedDate: expectedDate(o.readyDate, s.transitDays),
      transitDays: s.transitDays ?? 2,
      /** every product of the combined order (just this one when it is a single-product order) */
      lines,
      documents: (await Promise.all(ids.map((x) => this.documentsOf(em, user, x)))).flat(),
      invoices,
      stages: steps,
      /** the manufacturer reported the last step: the goods can be collected or sent */
      ready: o.status === 'Accepted' && (!last || o.stage === last),
      shipments: shipments.map((s) => ({
        id: s.id, refNo: s.refNo, shipDate: s.shipDate, containers: s.containers, method: s.method, status: s.status,
        vehicle: s.vehicle, waybill: s.waybill, note: s.note, shippedBy: s.shippedBy,
        driverName: s.driverName, driverPhone: s.driverPhone, transporter: s.transporter, dispatchRef: s.dispatchRef, orderId: s.orderId,
        receivedDate: s.receivedDate, receivedContainers: s.receivedContainers, receivedBy: s.receivedBy, receiptNote: s.receiptNote,
        bundlesPerContainer: s.bundlesPerContainer, packetsPerBundle: s.packetsPerBundle,
      })),
      claims: claims.map((c) => ({
        id: c.id, refNo: c.refNo, date: c.date, shipmentId: c.shipmentId, kind: c.kind, bundles: c.bundles, value: c.value,
        note: c.note, hasEvidence: !!c.evidence, raisedBy: c.raisedBy, status: c.status, resolution: c.resolution,
        decisionNote: c.decisionNote, decidedBy: c.decidedBy, decidedDate: c.decidedDate,
      })),
    };
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
    // in production: accepted and not everything has arrived yet
    const open = orders.filter((o) => o.status === 'Accepted' && o.receivedContainers < o.containers);
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
      const o = await this.createIn(em, user, dto);
      return this.shape(await this.load(em, o.id), (await this.movedMap(em))[o.id]);
    });
  }

  /** places an order inside the caller's transaction (also used when a distributor's stock request is accepted) */
  async createIn(em: EntityManager, user: OrderUser, dto: CreateProductionOrderDto, origin: string | null = null, groupRef: string | null = null) {
    const fields = await this.resolve(em, dto, null);
    const s = await this.settings.get(em);
    const auto = () => nextRef(em, ProductionOrder, s.docPrefixes['production'] ?? 'MO', 3, 1);
    const refNo = dto.refNo?.trim() ? await claimRef(em, 'production', dto.refNo, null, { prefixes: s.docPrefixes, make: auto }) : await auto();
    const o = await em.save(em.create(ProductionOrder, { ...fields, refNo, groupRef, status: 'Draft' }));
    await this.event(em, o.id, user, 'Created', origin);
    if (dto.send) await this.markSent(em, o, user);
    return o;
  }

  async update(user: OrderUser, id: string, dto: UpdateProductionOrderDto) {
    return this.db.transaction(async (em) => {
      const o = await this.load(em, id);
      if (o.status !== 'Draft') throw new BadRequestException('Only a draft order can be changed. Cancel it and place a new one.');
      Object.assign(o, await this.resolve(em, dto, o));
      // a draft may take another order number (checked against every other order)
      if (dto.refNo?.trim() && dto.refNo.trim().toLowerCase() !== o.refNo.toLowerCase()) o.refNo = await claimRef(em, 'production', dto.refNo, o.id);
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
      await this.notes.send(em, user,
        { to: { manufacturerId: o.manufacturerId }, kind: 'order.cancelled', tone: 'danger', refNo: o.refNo, link: LINK.factory,
          title: `Zen Foods cancelled order ${o.refNo}`, body: `${this.what(o)} · Reason: ${o.reason}` },
        { to: { staff: TEAM.manufacturing }, kind: 'order.cancelled', tone: 'danger', refNo: o.refNo, link: LINK.manufacturing('orders'),
          title: `Order ${o.refNo} cancelled`, body: `By ${user.name} · ${o.reason}` },
        ...(o.distributorId ? [{ to: { distributorId: o.distributorId }, kind: 'order.cancelled', tone: 'danger' as const, refNo: o.refNo, link: LINK.portal('stock'),
          title: `Production order ${o.refNo} for you was cancelled`, body: this.what(o) }] : []),
      );
      return this.shape(await this.load(em, id), (await this.movedMap(em))[id]);
    });
  }

  // ───────────── manufacturer side (staff may act for it) ─────────────

  async accept(user: OrderUser, id: string, dto: AcceptProductionOrderDto) {
    return (await this.acceptGroup(user, { ids: [id], ...dto }))[0];
  }

  async reject(user: OrderUser, id: string, dto: ReasonDto) {
    return (await this.rejectGroup(user, { ids: [id], reason: dto.reason }))[0];
  }

  async stage(user: OrderUser, id: string, dto: StageDto) {
    return (await this.stageGroup(user, { ids: [id], ...dto }))[0];
  }

  /**
   * The production orders of one combined order: same distributor order (DO- number) and same manufacturer. A
   * distributor order of several products is one order to both sides; each product is still its own production
   * order underneath. An order without a DO- number is its own group.
   */
  private async groupOf(em: EntityManager, user: OrderUser, ids: string[]) {
    const list = await Promise.all([...new Set(ids)].map((id) => this.load(em, id)));
    for (const o of list) this.checkOwner(user, o);
    const key = (o: ProductionOrder) => (o.groupRef ? `${o.groupRef}|${o.manufacturerId}` : o.id);
    if (new Set(list.map(key)).size > 1) throw new BadRequestException('These production orders do not belong to one order.');
    return list.sort((a, b) => a.refNo.localeCompare(b.refNo));
  }

  /** "DO-001 (MO-020, MO-021)" or "MO-020" */
  private label(list: ProductionOrder[]) {
    const refs = list.map((o) => o.refNo).join(', ');
    return list[0].groupRef ? `${list[0].groupRef} (${refs})` : refs;
  }

  /** the manufacturer accepts every product of the order at once, with one ready date */
  async acceptGroup(user: OrderUser, dto: GroupAcceptDto) {
    return this.db.transaction(async (em) => {
      const list = await this.groupOf(em, user, dto.ids);
      for (const o of list) {
        if (o.status !== 'Sent') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}, not waiting for an answer.`);
        if (dto.readyDate && dto.readyDate < o.date) throw new BadRequestException('The ready date cannot be before the order date.');
      }
      const note = [dto.readyDate && `Ready by ${dto.readyDate}`, dto.note?.trim()].filter(Boolean).join(' · ') || null;
      for (const o of list) {
        o.status = 'Accepted';
        o.readyDate = dto.readyDate ?? null;
        await em.save(o);
        await this.event(em, o.id, user, 'Accepted', note);
      }
      await this.answered(em, user, list, 'order.accepted', 'success', `${list[0].manufacturer.name} accepted order ${this.label(list)}`, note);
      return this.reshape(em, list);
    });
  }

  async rejectGroup(user: OrderUser, dto: GroupReasonDto) {
    return this.db.transaction(async (em) => {
      const list = await this.groupOf(em, user, dto.ids);
      for (const o of list) if (o.status !== 'Sent') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}, not waiting for an answer.`);
      for (const o of list) {
        o.status = 'Rejected';
        o.reason = dto.reason.trim();
        await em.save(o);
        await this.event(em, o.id, user, 'Rejected', o.reason);
      }
      await this.answered(em, user, list, 'order.rejected', 'danger', `${list[0].manufacturer.name} rejected order ${this.label(list)}`, `Reason: ${dto.reason.trim()}`);
      return this.reshape(em, list);
    });
  }

  /** report the next production step for every product of the order; steps only move forward (Settings list) */
  async stageGroup(user: OrderUser, dto: GroupStageDto) {
    return this.db.transaction(async (em) => {
      const list = await this.groupOf(em, user, dto.ids);
      const stages = (await em.find(Lookup, { where: { list: 'ORDER_STAGE', active: true }, order: { sortOrder: 'ASC' } })).map((l) => l.code);
      const next = stages.indexOf(dto.stage);
      if (next < 0) throw new BadRequestException(`"${dto.stage}" is not a production stage. Choose one from Settings & Data.`);
      for (const o of list) {
        if (o.status !== 'Accepted') throw new BadRequestException('Accept the order before reporting progress.');
        const now = o.stage ? stages.indexOf(o.stage) : -1;
        if (next <= now) throw new BadRequestException(`${o.refNo} is already at "${o.stage}". Report a later step.`);
      }
      for (const o of list) {
        o.stage = dto.stage;
        await em.save(o);
        await this.event(em, o.id, user, dto.stage, dto.note?.trim() || null);
      }
      // the last step means the goods are ready to dispatch
      const ready = next === stages.length - 1;
      const name = this.label(list);
      await this.answered(em, user, list, ready ? 'order.ready' : 'order.stage', ready ? 'success' : 'info',
        ready ? `Order ${name} is ready at ${list[0].manufacturer.name} ("${dto.stage}")` : `Order ${name} is now at "${dto.stage}"`, dto.note?.trim() || null);
      return this.reshape(em, list);
    });
  }

  private async reshape(em: EntityManager, list: ProductionOrder[]) {
    const moved = await this.movedMap(em);
    return Promise.all(list.map(async (o) => this.shape(await this.load(em, o.id), moved[o.id])));
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

  private async markSent(em: EntityManager, order: ProductionOrder, user: OrderUser) {
    order.status = 'Sent';
    await em.save(order);
    await this.event(em, order.id, user, 'Sent to manufacturer', null);
    const o = order.product && order.manufacturer ? order : await this.load(em, order.id);
    await this.notes.send(em, user,
      { to: { manufacturerId: o.manufacturerId }, kind: 'order.sent', tone: 'warning', refNo: o.refNo, link: LINK.factory,
        title: `New order ${o.refNo} from Zen Foods`, body: `${this.what(o)}. Accept or reject it.` },
      { to: { staff: TEAM.manufacturing }, kind: 'order.sent', refNo: o.refNo, link: LINK.manufacturing('orders'),
        title: `Order ${o.refNo} sent to ${o.manufacturer?.name ?? 'the manufacturer'}`, body: `By ${user.name} · ${this.what(o)}` },
    );
  }

  /** "2 containers of Z20-MAS for Upper Sindh" */
  private what(o: ProductionOrder) {
    return `${plural(o.containers, 'container')} of ${o.product?.sku ?? 'the product'}${o.destination === 'Warehouse' ? ' for the warehouse' : o.distributor ? ` for ${o.distributor.name}` : ''}`;
  }

  /** the manufacturer answered or reported progress: Zen Foods and the distributor the goods are for are told (once per order) */
  private async answered(em: EntityManager, user: OrderUser, group: ProductionOrder | ProductionOrder[], kind: string, tone: Note['tone'], title: string, note: string | null) {
    const list = Array.isArray(group) ? group : [group];
    const o = { ...list[0], refNo: this.label(list) } as ProductionOrder;
    const body = [list.map((x) => this.what(x)).join(', '), note].filter(Boolean).join(' · ');
    await this.notes.send(em, user,
      { to: { staff: TEAM.manufacturing }, kind, tone, refNo: o.refNo, link: LINK.manufacturing('orders'), title, body },
      { to: { manufacturerId: o.manufacturerId }, kind, tone, refNo: o.refNo, link: LINK.factory, title, body },
      ...(o.distributorId ? [{ to: { distributorId: o.distributorId }, kind, tone, refNo: o.refNo, link: LINK.portal('stock'),
        title: kind === 'order.accepted' ? `Goods on the way: order ${o.refNo} is in production`
          : kind === 'order.rejected' ? `${o.manufacturer.name} could not take order ${o.refNo}`
          : kind === 'order.ready' ? `Order ${o.refNo} is ready: collect it from ${o.manufacturer.name} or wait for dispatch` : title, body }] : []),
    );
  }

  private async event(em: EntityManager, orderId: string, user: OrderUser, event: string, note: string | null) {
    await em.save(em.create(ProductionOrderEvent, {
      orderId, event, note, by: user.name, side: this.isManufacturer(user) ? 'Manufacturer' : user.role === 'Distributor' ? 'Distributor' : 'Company',
    }));
  }

  /** the manufacturer's payment invoices on one order with what was paid on each */
  private async invoicesOf(em: EntityManager, orderId: string) {
    const rows: Record<string, unknown>[] = await em.query(
      `SELECT r.id, r."refNo", r.kind, r.amount::float8 AS amount, to_char(r.date, 'YYYY-MM-DD') AS date,
              to_char(r."dueDate", 'YYYY-MM-DD') AS "dueDate", r.status, r."invoiceNo", r."invoiceFileId", r.banks, r.bank,
              COALESCE((SELECT SUM(p.amount) FROM mfr_request_payments p WHERE p."requestId" = r.id), 0)::float8 AS paid
         FROM mfr_payment_requests r WHERE r."orderId" = $1 ORDER BY r.date, r."refNo"`, [orderId]);
    return rows.map((r) => ({ ...r, banks: (r['banks'] as unknown[])?.length ? r['banks'] : [r['bank']] }));
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
      const dist = await em.findOne(Distributor, { where: { id: distributorId } });
      if (!dist) throw new BadRequestException('Choose a distributor from Settings & Data.');
      if (dist.status === 'Temporary suspend' || dist.status === 'Permanent suspend') {
        throw new BadRequestException(`${dist.name} is suspended; no new orders can go to it.`);
      }
    }

    const date = dto.date ?? before!.date;
    const dueDate = dto.dueDate !== undefined ? dto.dueDate : before?.dueDate ?? null;
    if (dueDate && dueDate < date) throw new BadRequestException('The delivery date cannot be before the order date.');

    // the packaging template: the one asked for, else the order's own, else the product's default
    const templates = product.packagings ?? [];
    const wanted = dto.packaging !== undefined ? dto.packaging : productChanged ? null : before?.packaging ?? null;
    const tpl = wanted ? templates.find((t) => t.name === wanted) : templates.find((t) => t.isDefault);
    if (wanted && !tpl) throw new BadRequestException(`${product.sku} has no packaging template "${wanted}".`);
    const repack = productChanged || dto.packaging !== undefined;
    const bundlesPerContainer = dto.bundlesPerContainer
      ?? (repack ? tpl?.bundlesPerContainer ?? product.bundlesPerContainer : before!.bundlesPerContainer);
    // the maker's own rate, packaging and printing (each maker of the SKU has its own); a new maker or SKU starts from them
    const maker = (product.makers ?? []).find((m) => m.manufacturerId === manufacturer.id);
    const repriced = productChanged || manufacturer.id !== before?.manufacturerId;
    const packagingFee = repriced ? Number(maker?.packagingFee ?? 0) : Number(before!.packagingFee ?? 0);
    const printingFee = repriced ? Number(maker?.printingFee ?? 0) : Number(before!.printingFee ?? 0);
    const baseRate = dto.rate ?? (repriced
      ? Number(maker?.rate ?? product.manufacturerRate)
      : Number(before!.baseRate ?? round2(Number(before!.rate) - packagingFee - printingFee)));
    const packetsPerBundle = dto.packetsPerBundle
      ?? (repack ? tpl?.packetsPerBundle ?? product.packsPerCarton : before!.packetsPerBundle);

    return {
      date,
      productId: product.id,
      packaging: tpl?.name ?? null,
      manufacturerId: manufacturer.id,
      destination,
      distributorId,
      containers: dto.containers ?? before!.containers,
      bundlesPerContainer,
      packetsPerBundle,
      // the manufacturer's total per packet: its rate + packaging + printing
      rate: makerTotal({ rate: baseRate, packagingFee, printingFee }),
      baseRate,
      packagingFee,
      printingFee,
      piecesPerPacket: repack ? Math.max(1, Number(tpl?.piecesPerPacket) || 1) : before!.piecesPerPacket ?? 1,
      containersPerTruck: repack ? tpl?.containersPerTruck ?? null : before!.containersPerTruck ?? null,
      transportUnit: repack ? tpl?.transportUnit ?? null : before!.transportUnit ?? null,
      advancePct: !before || manufacturer.id !== before.manufacturerId ? Number(manufacturer.advancePct ?? 0) : before.advancePct,
      dueDate,
      notes: dto.notes !== undefined ? dto.notes?.trim() || null : before?.notes ?? null,
      transport: dto.transport !== undefined ? cleanTransport(dto.transport) : before?.transport ?? null,
      containerUnit: dto.containerUnit?.trim() || (repack ? tpl?.containerUnit ?? product.containerUnit ?? null : before?.containerUnit ?? null),
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
  private shape(o: ProductionOrder, moved?: { shipped: number; received: number }, sale?: Record<string, number>) {
    const bundles = o.containers * o.bundlesPerContainer;
    const packets = bundles * o.packetsPerBundle;
    const value = round2(packets * Number(o.rate));
    const saleRate = sale && o.distributorId ? sale[`${o.distributorId}|${o.productId}`] ?? sale[`*|${o.productId}`] ?? null : null;
    return {
      ...o,
      // inflow (what the distributor pays) and the margin over the manufacturer's price; staff only
      ...(saleRate !== null ? { saleRate, saleValue: round2(packets * saleRate), margin: round2(packets * saleRate - value) } : {}),
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
