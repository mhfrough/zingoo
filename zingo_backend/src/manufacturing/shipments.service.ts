import { expectedDate } from './order-movement';
import { DeliveryClaimsService } from './delivery-claims.service';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { Role } from '../common/enums';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { Lookup } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { LINK, NotificationsService, TEAM } from '../notifications/notifications.service';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { DispatchDto, PickupDto, ReceiveDispatchDto, ReceiveDto, ShipDto } from './shipments.dto';
import { ProductionShipment } from './shipments.entities';

const today = () => new Date().toISOString().slice(0, 10);

/** who is calling: staff, a manufacturer login, or a distributor login */
export interface ShipmentUser {
  id: string;
  name: string;
  role: Role;
  manufacturerId?: string | null;
  distributorId?: string | null;
  /** a manufacturer login: Owner, Manager or Read-only */
  portalRole?: string | null;
}

/** adds whole days to an ISO date */
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Shipments of finished containers from the manufacturer to the order's distributor (or the warehouse), and
 * their receipt. On receipt the goods are owed to the manufacturer at the order rate and become stock: at the
 * distributor (consignment, still Zen Foods stock) or in the warehouse. Advances already paid on the order are
 * then set against what is owed.
 */
@Injectable()
export class ShipmentsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly notes: NotificationsService,
    private readonly claims: DeliveryClaimsService,
  ) {}

  // ───────────── reads ─────────────

  /** a manufacturer sees what it sent, a distributor what was sent to it, staff everything (or one of either) */
  async list(user: ShipmentUser, filter: { distributorId?: string; manufacturerId?: string } = {}) {
    const where: FindOptionsWhere<ProductionShipment> = {};
    if (user.role === 'Manufacturer') where.manufacturerId = this.own(user.manufacturerId, 'manufacturer');
    else if (user.role === 'Distributor') where.distributorId = this.own(user.distributorId, 'distributor');
    else {
      if (filter.distributorId) where.distributorId = filter.distributorId;
      if (filter.manufacturerId) where.manufacturerId = filter.manufacturerId;
    }
    const rows = await this.db.manager.find(ProductionShipment, {
      where, relations: ['order', 'product', 'manufacturer', 'distributor'], order: { shipDate: 'DESC', refNo: 'DESC' },
    });
    const [sold, rates, claimed] = await Promise.all([this.soldMap(this.db.manager), this.rateMap(this.db.manager), this.claimedMap(this.db.manager)]);
    return rows.map((s) => this.shape(s, sold[s.id] ?? 0, rates, claimed[s.id] ?? 0));
  }

  /**
   * Stock held by distributors (consignment), lot by lot (one received shipment is one lot) and per product:
   * containers, bundles, packets and value at cost, with the sell-by date. On hand = received - already invoiced
   * (an invoice waiting for verification already takes its containers; a rejected one gives them back).
   */
  async stock(user: ShipmentUser, distributorId?: string) {
    const scope = user.role === 'Distributor' ? this.own(user.distributorId, 'distributor') : distributorId;
    const lots = (await this.list({ ...user, role: user.role === 'Distributor' ? 'Distributor' : 'Admin' }, { distributorId: scope }))
      .filter((s) => s.status === 'Received' && s.destination === 'Distributor' && (s.receivedContainers ?? 0) > 0);
    const byProduct = new Map<string, { productId: string; sku: string; name: string; distributor: string; containers: number; bundles: number; packets: number; value: number; nextSellBy: string | null; overdue: boolean }>();
    for (const l of lots) {
      const key = `${l.productId}|${l.distributorId}`;
      const row = byProduct.get(key) ?? {
        productId: l.productId, sku: l.product.sku, name: l.product.name, distributor: l.distributor?.name ?? '',
        containers: 0, bundles: 0, packets: 0, value: 0, nextSellBy: null as string | null, overdue: false,
      };
      row.containers += l.onHandContainers;
      row.bundles += l.onHandContainers * l.bundlesPerContainer;
      row.packets += l.onHandContainers * l.bundlesPerContainer * l.packetsPerBundle;
      row.value = round2(row.value + l.onHandValue);
      if (l.onHandContainers > 0 && l.sellBy && (!row.nextSellBy || l.sellBy < row.nextSellBy)) row.nextSellBy = l.sellBy;
      row.overdue ||= l.overdue;
      byProduct.set(key, row);
    }
    return { lots, byProduct: [...byProduct.values()] };
  }

  /**
   * The trail of each delivery (a container lot): shipped, received, sold, still on hand, its cost, the sales
   * booked on it (verified invoices) and the money collected (each invoice's payments shared over its lines).
   */
  async trail(user: ShipmentUser, filter: { distributorId?: string; manufacturerId?: string } = {}) {
    const lots = await this.list(user, filter);
    const lines: { shipmentId: string; amount: number; invAmount: number; paid: number; verified: boolean }[] = lots.length ? await this.db.query(
      `SELECT l."shipmentId", l.amount::float8 AS amount, i.amount::float8 AS "invAmount", i.status = 'Verified' AS verified,
              COALESCE((SELECT SUM(p.amount) FROM distributor_invoice_payments p WHERE p."invoiceId" = i.id), 0)::float8 AS paid
         FROM distributor_invoice_lines l JOIN distributor_invoices i ON i.id = l."invoiceId"
        WHERE i.status <> 'Rejected' AND l."shipmentId" = ANY($1)`, [lots.map((l) => l.id)]) : [];
    return lots.map((s) => {
      const mine = lines.filter((l) => l.shipmentId === s.id && l.verified);
      const sales = round2(mine.reduce((n, l) => n + Number(l.amount), 0));
      const collected = round2(mine.reduce((n, l) => n + (Number(l.invAmount) ? Number(l.amount) * Math.min(1, Number(l.paid) / Number(l.invAmount)) : 0), 0));
      return {
        id: s.id, refNo: s.refNo, orderRef: s.order.refNo, sku: s.product.sku, manufacturer: s.manufacturer.name,
        destination: s.destination, distributor: s.distributor?.name ?? null, shipDate: s.shipDate, status: s.status,
        receivedDate: s.receivedDate, sellBy: s.sellBy, overdue: s.overdue,
        shipped: s.containers, received: s.receivedContainers ?? 0, sold: s.soldContainers, onHand: s.onHandContainers,
        cost: s.receivedValue, sales, collected, receivable: round2(sales - collected),
      };
    });
  }

  // ───────────── manufacturer side ─────────────

  async ship(user: ShipmentUser, dto: ShipDto) {
    return this.db.transaction(async (em) => {
      const o = await em.findOne(ProductionOrder, { where: { id: dto.orderId } });
      if (!o) throw new NotFoundException('Production order not found');
      if (user.role === 'Manufacturer' && o.manufacturerId !== this.own(user.manufacturerId, 'manufacturer')) {
        throw new ForbiddenException('This order belongs to another manufacturer.');
      }
      const row = await this.move(em, user, o, dto, 'Delivery');
      const full = await this.one(em, row.id);
      const what = `${dto.containers} container${dto.containers > 1 ? 's' : ''} of ${full.product.sku} (${o.refNo})`;
      const via = [dto.vehicle && `vehicle ${dto.vehicle}`, dto.waybill && `waybill ${dto.waybill}`].filter(Boolean).join(' · ');
      const to = o.destination === 'Warehouse' ? 'the Zen Foods warehouse' : full.distributor?.name ?? 'the distributor';
      await this.notes.send(em, user,
        { to: { distributorId: o.destination === 'Distributor' ? o.distributorId : null }, kind: 'shipment.dispatched', tone: 'warning', refNo: row.refNo, link: LINK.portal('stock'),
          title: `${full.manufacturer.name} dispatched ${what} to you`, body: [via, 'Confirm what arrives on Deliveries & stock.'].filter(Boolean).join(' · ') },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.dispatched', refNo: row.refNo, link: LINK.manufacturing('orders'),
          title: `${full.manufacturer.name} dispatched ${what} to ${to}`, body: via || null },
        { to: { manufacturerId: o.manufacturerId }, kind: 'shipment.dispatched', refNo: row.refNo, link: LINK.factory,
          title: `Shipment ${row.refNo} on its way to ${to}`, body: what },
      );
      return full;
    });
  }

  /**
   * The distributor collects containers of its order from the factory, once the manufacturer has reported the last
   * production step (ready). The load is then on the road until the distributor confirms it at its warehouse.
   */
  async pickup(user: ShipmentUser, dto: PickupDto) {
    return this.db.transaction(async (em) => {
      const o = await em.findOne(ProductionOrder, { where: { id: dto.orderId }, relations: ['manufacturer', 'distributor', 'product'] });
      if (!o) throw new NotFoundException('Production order not found');
      if (user.role === 'Distributor' && o.distributorId !== this.own(user.distributorId, 'distributor')) {
        throw new ForbiddenException('This order is for another distributor.');
      }
      if (o.destination !== 'Distributor' || !o.distributorId) throw new BadRequestException(`${o.refNo} goes to the warehouse; a distributor cannot collect it.`);
      if (o.status === 'Accepted') {
        const stages = await this.stages(em);
        if (stages.length && o.stage !== stages[stages.length - 1]) {
          throw new BadRequestException(`${o.manufacturer.name} has not reported ${o.refNo} ready yet${o.stage ? ` (it is at "${o.stage}")` : ''}.`);
        }
      }
      const collected = dto.collectedBy?.trim();
      const row = await this.move(em, user, o, {
        orderId: o.id, date: dto.date, containers: dto.containers, vehicle: dto.vehicle,
        note: [collected && `Collected by ${collected}`, dto.note?.trim()].filter(Boolean).join(' · ') || undefined,
      }, 'Pickup');
      // damage seen at the factory gate: a claim per line on this pickup, before the load leaves
      if (dto.damages?.length) {
        const load = await em.findOneOrFail(ProductionShipment, { where: { id: row.id }, relations: ['product', 'distributor', 'manufacturer'] });
        for (const d of dto.damages) await this.claims.createIn(em, user, load, { date: dto.date, ...d });
      }
      const full = await this.one(em, row.id);
      const what = `${dto.containers} container${dto.containers > 1 ? 's' : ''} of ${o.product.sku} (${o.refNo})`;
      const via = [dto.vehicle && `vehicle ${dto.vehicle}`, collected && `collected by ${collected}`].filter(Boolean).join(' · ');
      const who = o.distributor?.name ?? 'The distributor';
      await this.notes.send(em, user,
        { to: { manufacturerId: o.manufacturerId }, kind: 'shipment.picked-up', tone: 'success', refNo: row.refNo, link: LINK.factory,
          title: `${who} collected ${what} from your factory`, body: via || null },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.picked-up', refNo: row.refNo, link: LINK.manufacturing('orders'),
          title: `${who} collected ${what} from ${o.manufacturer.name}`, body: via || null },
        { to: { distributorId: o.distributorId }, kind: 'shipment.picked-up', refNo: row.refNo, link: LINK.portal('stock'),
          title: `Pickup ${row.refNo} recorded: ${what}`, body: 'Confirm what reaches your warehouse on Deliveries & stock.' },
      );
      return full;
    });
  }

  /**
   * Orders on their way to a distributor that have not fully left the factory: waiting for the manufacturer, in
   * production, or ready to collect. A distributor sees its own; staff one distributor or all.
   */
  async incoming(user: ShipmentUser, distributorId?: string) {
    const scope = user.role === 'Distributor' ? this.own(user.distributorId, 'distributor') : distributorId;
    const em = this.db.manager;
    const qb = em.getRepository(ProductionOrder).createQueryBuilder('o')
      .leftJoinAndSelect('o.product', 'p').leftJoinAndSelect('o.manufacturer', 'm').leftJoinAndSelect('o.distributor', 'd')
      .where(`o.destination = 'Distributor'`).andWhere(`o.status IN ('Sent', 'Accepted')`)
      .orderBy('o.date', 'DESC').addOrderBy('o.refNo', 'DESC');
    if (scope) qb.andWhere('o.distributorId = :scope', { scope });
    const [orders, stages, moved] = await Promise.all([
      qb.getMany(),
      this.stages(em),
      em.query(`SELECT "orderId", SUM(containers)::int AS n FROM production_shipments GROUP BY "orderId"`) as Promise<{ orderId: string; n: number }[]>,
    ]);
    const shipped = Object.fromEntries(moved.map((r) => [r.orderId, Number(r.n)]));
    const last = stages[stages.length - 1] ?? null;
    const transit = (await this.settings.get(em)).transitDays;
    return orders
      .map((o) => ({
        id: o.id, refNo: o.refNo, date: o.date, createdAt: o.createdAt, updatedAt: o.updatedAt, status: o.status, stage: o.stage, readyDate: o.readyDate, dueDate: o.dueDate,
        expectedDate: expectedDate(o.readyDate, transit),
        product: { id: o.product.id, sku: o.product.sku, name: o.product.name, containerUnit: o.product.containerUnit ?? null },
        manufacturer: { id: o.manufacturer.id, name: o.manufacturer.name },
        distributor: o.distributor ? { id: o.distributor.id, name: o.distributor.name } : null,
        groupRef: o.groupRef, transport: o.transport, containerUnit: o.containerUnit ?? o.product.containerUnit ?? null,
        containers: o.containers, shippedContainers: shipped[o.id] ?? 0, left: o.containers - (shipped[o.id] ?? 0),
        bundlesPerContainer: o.bundlesPerContainer, packetsPerBundle: o.packetsPerBundle,
        /** the manufacturer reported the last step: the distributor may collect it */
        ready: o.status === 'Accepted' && (!last || o.stage === last),
      }))
      .filter((o) => o.left > 0);
  }

  /**
   * Ready to Dispatch for a whole order (every product of one distributor order and manufacturer): reports the last
   * production step, records what each product made ready and what was damaged in production, and loads it on the
   * distributor's vehicle: one load per product sharing one dispatch number, the vehicle, the driver and the proof
   * of handover. More or fewer containers than ordered may be ready; the ready ones are what is loaded and paid for.
   */
  async dispatchGroup(user: ShipmentUser, dto: DispatchDto) {
    return this.db.transaction(async (em) => {
      const ids = [...new Set(dto.lines.map((l) => l.orderId))];
      const orders = await em.find(ProductionOrder, { where: { id: In(ids) }, relations: ['manufacturer', 'distributor', 'product'] });
      if (orders.length !== ids.length) throw new NotFoundException('A production order of this dispatch was not found.');
      const key = (o: ProductionOrder) => (o.groupRef ? `${o.groupRef}|${o.manufacturerId}` : o.id);
      if (new Set(orders.map(key)).size > 1) throw new BadRequestException('These production orders do not belong to one order.');
      for (const o of orders) {
        if (user.role === 'Manufacturer' && o.manufacturerId !== this.own(user.manufacturerId, 'manufacturer')) throw new ForbiddenException('This order belongs to another manufacturer.');
        if (o.status !== 'Accepted') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}: only an accepted order can be dispatched.`);
        if (o.readyContainers !== null) throw new BadRequestException(`${o.refNo} was already dispatched.`);
        if (dto.date < o.date) throw new BadRequestException('A dispatch cannot be dated before its order.');
      }
      if (dto.date > today()) throw new BadRequestException('A dispatch cannot be dated in the future.');
      if (!dto.lines.some((l) => l.ready > 0)) throw new BadRequestException('Nothing is ready: enter the containers loaded for at least one product.');
      // the proof of handover must be on one of these orders
      const proofs: { id: string; ownerId: string; ownerType: string }[] = await em.query(
        `SELECT id, "ownerId", "ownerType" FROM attachments WHERE id = ANY($1)`, [dto.proofIds]);
      if (proofs.length !== new Set(dto.proofIds).size || proofs.some((p) => p.ownerType !== 'ORDER_HANDOVER' || !ids.includes(p.ownerId))) {
        throw new BadRequestException('Attach the proof of handover (signed gate pass or delivery challan) to this order first.');
      }
      const stages = await this.stages(em);
      const last = stages[stages.length - 1] ?? null;
      const s = await this.settings.get(em);
      const [{ n }] = await em.query(
        `SELECT MAX(CAST(SUBSTRING("dispatchRef" FROM '([0-9]+)$') AS BIGINT)) AS n FROM production_shipments WHERE "dispatchRef" ~ '^DC-[0-9]+$'`);
      const dispatchRef = `DC-${String(n ? Number(n) + 1 : 1).padStart(3, '0')}`;
      const via = [`vehicle ${dto.vehicleNo.trim()}`, `driver ${dto.driverName.trim()} (${dto.driverPhone.trim()})`, dto.transporter?.trim(), dto.biltyNo?.trim() && `bilty ${dto.biltyNo.trim()}`].filter(Boolean).join(' · ');
      const loaded: string[] = [];
      for (const l of dto.lines) {
        const o = orders.find((x) => x.id === l.orderId)!;
        // the last production step, if it was not reported yet
        if (last && o.stage !== last) {
          o.stage = last;
          await this.event(em, o.id, user, last, null);
        }
        o.readyContainers = l.ready;
        o.productionDamaged = l.damaged ?? null;
        await em.save(o);
        await this.event(em, o.id, user, `Ready to dispatch: ${l.ready} of ${o.containers} ready${l.damaged ? `, ${l.damaged} damaged in production` : ''}`, dto.note?.trim() || null);
        if (l.ready <= 0) continue;
        const refNo = await nextRef(em, ProductionShipment, s.docPrefixes['shipment'] ?? 'SH', 3);
        await em.save(em.create(ProductionShipment, {
          refNo, orderId: o.id, productId: o.productId, manufacturerId: o.manufacturerId, destination: o.destination,
          distributorId: o.distributorId, shipDate: dto.date, containers: l.ready, bundlesPerContainer: o.bundlesPerContainer,
          packetsPerBundle: o.packetsPerBundle, rate: o.rate, vehicle: dto.vehicleNo.trim(), waybill: dto.biltyNo?.trim() || null,
          note: dto.note?.trim() || null, shippedBy: user.name, status: 'In transit', method: 'Pickup',
          driverName: dto.driverName.trim(), driverPhone: dto.driverPhone.trim(), transporter: dto.transporter?.trim() || null, dispatchRef,
        }));
        await this.event(em, o.id, user, `Dispatched ${l.ready} container${l.ready === 1 ? '' : 's'} (${refNo}, ${dispatchRef})`, via);
        loaded.push(`${l.ready} × ${o.product.sku}`);
      }
      const lead = [...orders].sort((a, b) => a.refNo.localeCompare(b.refNo))[0];
      const name = lead.groupRef ?? lead.refNo;
      const what = loaded.join(', ');
      await this.notes.send(em, user,
        ...(lead.distributorId ? [{ to: { distributorId: lead.distributorId }, kind: 'order.dispatched', tone: 'success' as const, refNo: name, link: LINK.portal('stock'),
          title: `Order ${name} dispatched from ${lead.manufacturer.name} (${dispatchRef})`,
          body: `${what} · ${via}. The dispatch voucher is on the order; confirm what arrives, or open a dispute for damage.` }] : []),
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'order.dispatched', refNo: name, link: LINK.manufacturing('orders'),
          title: `${lead.manufacturer.name} dispatched order ${name} (${dispatchRef})`, body: `${what} · ${via}` },
        { to: { manufacturerId: lead.manufacturerId }, kind: 'order.dispatched', refNo: name, link: LINK.factory,
          title: `Order ${name} dispatched (${dispatchRef})`, body: what },
      );
      return { dispatchRef, loads: loaded.length };
    });
  }

  /** records containers leaving the factory on an accepted order: delivered by the manufacturer, or collected */
  private async move(em: EntityManager, user: ShipmentUser, o: ProductionOrder, dto: ShipDto, method: 'Delivery' | 'Pickup') {
    const what = method === 'Pickup' ? 'pickup' : 'shipment';
    if (o.status !== 'Accepted') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}: only an accepted order can be ${method === 'Pickup' ? 'collected' : 'shipped'}.`);
    if (dto.date > today()) throw new BadRequestException(`A ${what} cannot be dated in the future.`);
    if (dto.date < o.date) throw new BadRequestException(`A ${what} cannot be dated before its order.`);
    const [{ sent }] = await em.query(`SELECT COALESCE(SUM(containers), 0)::int AS sent FROM production_shipments WHERE "orderId" = $1`, [o.id]);
    const left = o.containers - Number(sent);
    if (left <= 0) throw new BadRequestException(`Every container of ${o.refNo} was already shipped.`);
    if (dto.containers > left) throw new BadRequestException(`Only ${left} container${left > 1 ? 's are' : ' is'} left to ship on ${o.refNo}.`);
    const s = await this.settings.get(em);
    const refNo = await nextRef(em, ProductionShipment, s.docPrefixes['shipment'] ?? 'SH', 3);
    const row = await em.save(em.create(ProductionShipment, {
      refNo, orderId: o.id, productId: o.productId, manufacturerId: o.manufacturerId, destination: o.destination,
      distributorId: o.distributorId, shipDate: dto.date, containers: dto.containers, bundlesPerContainer: o.bundlesPerContainer,
      packetsPerBundle: o.packetsPerBundle, rate: o.rate, vehicle: dto.vehicle?.trim() || null, waybill: dto.waybill?.trim() || null,
      note: dto.note?.trim() || null, shippedBy: user.name, status: 'In transit', method,
    }));
    const n = `${dto.containers} container${dto.containers > 1 ? 's' : ''}`;
    await this.event(em, o.id, user, method === 'Pickup' ? `Collected ${n} from the factory (${refNo})` : `Shipped ${n} (${refNo})`,
      [dto.vehicle && `Vehicle ${dto.vehicle}`, dto.waybill && `Waybill ${dto.waybill}`, method === 'Pickup' ? dto.note : null].filter(Boolean).join(' · ') || null);
    return row;
  }

  private async stages(em: EntityManager) {
    return (await em.find(Lookup, { where: { list: 'ORDER_STAGE', active: true }, order: { sortOrder: 'ASC' } })).map((l) => l.code);
  }

  // ───────────── receiving side ─────────────

  async receive(user: ShipmentUser, id: string, dto: ReceiveDto) {
    return this.db.transaction((em) => this.receiveIn(em, user, id, dto));
  }

  /**
   * The distributor receives a whole dispatch (every product loaded on one vehicle, one DC- number): everything that
   * left the factory arrived; bundles damaged on arrival become claims (a dispute the manufacturer answers), with the
   * photos as proof on each claim. No damage: the delivery is simply accepted. One notice for the whole dispatch.
   */
  async receiveDispatch(user: ShipmentUser, dto: ReceiveDispatchDto) {
    return this.db.transaction(async (em) => {
      const loads = await em.find(ProductionShipment, { where: { id: In(dto.lines.map((l) => l.shipmentId)) }, relations: ['product', 'distributor', 'manufacturer', 'order'] });
      if (loads.length !== new Set(dto.lines.map((l) => l.shipmentId)).size) throw new NotFoundException('A load of this delivery was not found.');
      if (new Set(loads.map((l) => l.dispatchRef ?? l.id)).size > 1) throw new BadRequestException('These loads do not belong to one dispatch.');
      const damaged = dto.lines.filter((l) => (l.damaged ?? 0) > 0);
      if (damaged.length && !dto.note?.trim()) throw new BadRequestException('Say what was damaged: the manufacturer sees it with the dispute.');
      for (const l of loads) await this.receiveIn(em, user, l.id, { date: dto.date, receivedContainers: l.containers, note: dto.note?.trim() || undefined }, true);
      const claims: string[] = [];
      for (const d of damaged) {
        const load = await em.findOneOrFail(ProductionShipment, { where: { id: d.shipmentId }, relations: ['product', 'distributor', 'manufacturer'] });
        // the same photos back every claim of the dispute: the first claim takes them, the others get copies
        const proofIds = claims.length ? await this.copyFiles(em, dto.proofIds ?? []) : dto.proofIds ?? [];
        const c = await this.claims.createIn(em, user, load, { date: dto.date, kind: 'Damaged', bundles: d.damaged!, note: dto.note!.trim(), proofIds });
        claims.push(`${c.refNo}: ${d.damaged} bundle${d.damaged === 1 ? '' : 's'} of ${load.product.sku}`);
      }
      const lead = loads[0];
      const ref = lead.dispatchRef ?? lead.refNo;
      const what = loads.map((l) => `${l.containers} × ${l.product.sku}`).join(', ');
      const title = claims.length ? `${lead.distributor?.name ?? 'The distributor'} received ${ref} with damage: dispute opened` : `${lead.distributor?.name ?? 'The distributor'} received ${ref} in good order`;
      const body = [what, claims.join(' · ')].filter(Boolean).join(' · ');
      const tone = claims.length ? 'danger' as const : 'success' as const;
      await this.notes.send(em, user,
        { to: { manufacturerId: lead.manufacturerId }, kind: 'shipment.received', tone, refNo: ref, link: LINK.factory, title, body },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.received', tone, refNo: ref, link: LINK.manufacturing('orders'), title, body },
        { to: { distributorId: lead.distributorId }, kind: 'shipment.received', refNo: ref, link: LINK.portal('stock'),
          title: claims.length ? `Delivery ${ref} received; dispute sent to ${lead.manufacturer.name}` : `Delivery ${ref} received`, body },
      );
      return { dispatchRef: ref, claims: claims.length };
    });
  }

  /** copies of uploaded files (for a second claim of the same dispute) */
  private async copyFiles(em: EntityManager, ids: string[]) {
    const out: string[] = [];
    for (const id of ids) {
      const rows: { id: string }[] = await em.query(
        `INSERT INTO attachments (name, mime, size, data, "uploadedBy") SELECT name, mime, size, data, "uploadedBy" FROM attachments WHERE id = $1 RETURNING id`, [id]);
      if (rows[0]) out.push(rows[0].id);
    }
    return out;
  }

  /** confirms what arrived on one load, inside the caller's transaction (`quiet`: the caller sends one notice for all) */
  private async receiveIn(em: EntityManager, user: ShipmentUser, id: string, dto: ReceiveDto, quiet = false) {
    const s = await em.findOne(ProductionShipment, { where: { id } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (user.role === 'Distributor' && s.distributorId !== this.own(user.distributorId, 'distributor')) {
      throw new ForbiddenException('This shipment is for another distributor.');
    }
    if (s.destination === 'Warehouse' && !['Admin', 'Manufacturing'].includes(user.role)) {
      throw new ForbiddenException('Warehouse deliveries are received by Admin or Manufacturing.');
    }
    if (s.status !== 'In transit') throw new BadRequestException(`${s.refNo} was already received.`);
    if (dto.date > today()) throw new BadRequestException('A receipt cannot be dated in the future.');
    if (dto.date < s.shipDate) throw new BadRequestException('A receipt cannot be dated before the shipment.');
    if (dto.receivedContainers > s.containers) throw new BadRequestException(`${s.refNo} carried ${s.containers} container${s.containers > 1 ? 's' : ''}.`);
    if (dto.receivedContainers < s.containers && !dto.note?.trim()) throw new BadRequestException('Say what was short or damaged.');

    let days: number | null = null;
    if (s.destination === 'Distributor') {
      const [p, d] = await Promise.all([
        em.findOne(Product, { where: { id: s.productId } }),
        s.distributorId ? em.findOne(Distributor, { where: { id: s.distributorId } }) : null,
      ]);
      days = p?.selloutDays ?? d?.selloutDays ?? (await this.settings.get(em)).defaultSelloutDays ?? 30;
    }
    Object.assign(s, {
      status: 'Received', receivedDate: dto.date, receivedContainers: dto.receivedContainers, receivedBy: user.name,
      receiptNote: dto.note?.trim() || null, selloutDays: days, sellBy: days ? addDays(dto.date, days) : null,
    });
    await em.save(s);
    await this.posting.syncProductionShipment(em, s.id);
    await this.posting.syncOrderAdvance(em, s.orderId);
    await this.event(em, s.orderId, user, `Received ${dto.receivedContainers} of ${s.containers} (${s.refNo})`, s.receiptNote);
    // damage found on arrival: a claim per line on this load
    if (dto.damages?.length) {
      const load = await em.findOneOrFail(ProductionShipment, { where: { id }, relations: ['product', 'distributor', 'manufacturer'] });
      for (const d of dto.damages) await this.claims.createIn(em, user, load, { date: dto.date, ...d });
    }
    const full = await this.one(em, id);
    const short = dto.receivedContainers < s.containers;
    const who = s.destination === 'Warehouse' ? 'The warehouse' : full.distributor?.name ?? 'The distributor';
    const title = `${who} received ${dto.receivedContainers} of ${s.containers} container${s.containers > 1 ? 's' : ''} on ${s.refNo}`;
    const body = [`${full.product.sku} · order ${full.order.refNo}`, s.receiptNote].filter(Boolean).join(' · ');
    const tone = short ? 'danger' as const : 'success' as const;
    if (!quiet) await this.notes.send(em, user,
      { to: { manufacturerId: s.manufacturerId }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.factory, title, body },
      { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.manufacturing('orders'), title, body },
      { to: { distributorId: s.destination === 'Distributor' ? s.distributorId : null }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.portal('stock'),
        title: `Receipt of ${s.refNo} recorded`, body: short ? `${body} · Report faulty bundles as a delivery claim.` : body },
    );
    return full;
  }

  // ───────────── helpers ─────────────

  private own(id: string | null | undefined, what: string): string {
    if (!id) throw new ForbiddenException(`This login is not linked to a ${what}.`);
    return id;
  }

  private async one(em: EntityManager, id: string) {
    const s = await em.findOne(ProductionShipment, { where: { id }, relations: ['order', 'product', 'manufacturer', 'distributor'] });
    return this.shape(s!, (await this.soldMap(em))[id] ?? 0, await this.rateMap(em), (await this.claimedMap(em))[id] ?? 0);
  }

  /** bundles of each delivery on a faulty-goods claim that was not rejected (they cannot be dispatched) */
  private async claimedMap(em: EntityManager): Promise<Record<string, number>> {
    const rows: { shipmentId: string; n: number }[] = await em.query(
      `SELECT "shipmentId", SUM(bundles)::int AS n FROM delivery_claims WHERE status <> 'Rejected' GROUP BY "shipmentId"`);
    return Object.fromEntries(rows.map((r) => [r.shipmentId, Number(r.n)]));
  }

  /** containers of each delivery already on a distributor invoice that was not rejected */
  private async soldMap(em: EntityManager): Promise<Record<string, number>> {
    const rows: { shipmentId: string; n: number }[] = await em.query(
      `SELECT l."shipmentId", SUM(l.containers)::int AS n FROM distributor_invoice_lines l
         JOIN distributor_invoices i ON i.id = l."invoiceId" WHERE i.status <> 'Rejected' GROUP BY l."shipmentId"`);
    return Object.fromEntries(rows.map((r) => [r.shipmentId, Number(r.n)]));
  }

  /** agreed distributor prices per packet, keyed "distributorId|productId" */
  private async rateMap(em: EntityManager): Promise<Record<string, number>> {
    const rows: { d: string; p: string; rate: number }[] = await em.query(`SELECT "distributorId" AS d, "productId" AS p, rate::float8 AS rate FROM distributor_rates`);
    return Object.fromEntries(rows.map((r) => [`${r.d}|${r.p}`, Number(r.rate)]));
  }

  private async event(em: EntityManager, orderId: string, user: ShipmentUser, event: string, note: string | null) {
    await em.save(em.create(ProductionOrderEvent, {
      orderId, event, note, by: user.name,
      side: user.role === 'Manufacturer' ? 'Manufacturer' : user.role === 'Distributor' ? 'Distributor' : 'Company',
    }));
  }

  /** quantities and value of what was sent and what arrived; what is still on hand and whether it is past its sell-by date */
  private shape(s: ProductionShipment, soldContainers = 0, rates: Record<string, number> = {}, claimedBundles = 0) {
    const perContainer = s.bundlesPerContainer * s.packetsPerBundle;
    const received = s.receivedContainers ?? 0;
    const onHandContainers = s.status === 'Received' ? Math.max(0, received - soldContainers) : 0;
    const onHandValue = round2(onHandContainers * perContainer * Number(s.rate));
    const daysLeft = s.sellBy ? Math.round((Date.parse(s.sellBy) - Date.parse(today())) / 86_400_000) : null;
    return {
      ...s,
      packets: s.containers * perContainer,
      value: round2(s.containers * perContainer * Number(s.rate)),
      receivedValue: round2(received * perContainer * Number(s.rate)),
      soldContainers,
      /** bundles on a faulty-goods claim (not rejected) */
      claimedBundles,
      onHandContainers,
      onHandValue,
      /** what the distributor is charged per packet: its agreed rate, else the product's */
      saleRate: s.distributorId ? rates[`${s.distributorId}|${s.productId}`] ?? Number(s.product?.rate ?? 0) : null,
      daysLeft,
      overdue: daysLeft !== null && daysLeft < 0 && onHandContainers > 0,
    };
  }
}
