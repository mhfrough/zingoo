import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { Role } from '../common/enums';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { SettingsService } from '../setup/setup.service';
import { LINK, NotificationsService, TEAM } from '../notifications/notifications.service';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { ReceiveDto, ShipDto } from './shipments.dto';
import { ProductionShipment } from './shipments.entities';

const today = () => new Date().toISOString().slice(0, 10);

/** who is calling: staff, a manufacturer login, or a distributor login */
export interface ShipmentUser {
  id: string;
  name: string;
  role: Role;
  manufacturerId?: string | null;
  distributorId?: string | null;
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
    const [sold, rates] = await Promise.all([this.soldMap(this.db.manager), this.rateMap(this.db.manager)]);
    return rows.map((s) => this.shape(s, sold[s.id] ?? 0, rates));
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
      if (o.status !== 'Accepted') throw new BadRequestException(`${o.refNo} is ${o.status.toLowerCase()}: only an accepted order can be shipped.`);
      if (dto.date > today()) throw new BadRequestException('A shipment cannot be dated in the future.');
      if (dto.date < o.date) throw new BadRequestException('A shipment cannot be dated before its order.');
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
        note: dto.note?.trim() || null, shippedBy: user.name, status: 'In transit',
      }));
      await this.event(em, o.id, user, `Shipped ${dto.containers} container${dto.containers > 1 ? 's' : ''} (${refNo})`,
        [dto.vehicle && `Vehicle ${dto.vehicle}`, dto.waybill && `Waybill ${dto.waybill}`].filter(Boolean).join(' · ') || null);
      const full = await this.one(em, row.id);
      const what = `${dto.containers} container${dto.containers > 1 ? 's' : ''} of ${full.product.sku} (${o.refNo})`;
      const via = [dto.vehicle && `vehicle ${dto.vehicle}`, dto.waybill && `waybill ${dto.waybill}`].filter(Boolean).join(' · ');
      const to = o.destination === 'Warehouse' ? 'the Zen Foods warehouse' : full.distributor?.name ?? 'the distributor';
      await this.notes.send(em, user,
        { to: { distributorId: o.destination === 'Distributor' ? o.distributorId : null }, kind: 'shipment.dispatched', tone: 'warning', refNo, link: LINK.portal('stock'),
          title: `${full.manufacturer.name} dispatched ${what} to you`, body: [via, 'Confirm what arrives on Deliveries & stock.'].filter(Boolean).join(' · ') },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.dispatched', refNo, link: LINK.manufacturing('orders'),
          title: `${full.manufacturer.name} dispatched ${what} to ${to}`, body: via || null },
        { to: { manufacturerId: o.manufacturerId }, kind: 'shipment.dispatched', refNo, link: LINK.factory,
          title: `Shipment ${refNo} on its way to ${to}`, body: what },
      );
      return full;
    });
  }

  // ───────────── receiving side ─────────────

  async receive(user: ShipmentUser, id: string, dto: ReceiveDto) {
    return this.db.transaction(async (em) => {
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
      const full = await this.one(em, id);
      const short = dto.receivedContainers < s.containers;
      const who = s.destination === 'Warehouse' ? 'The warehouse' : full.distributor?.name ?? 'The distributor';
      const title = `${who} received ${dto.receivedContainers} of ${s.containers} container${s.containers > 1 ? 's' : ''} on ${s.refNo}`;
      const body = [`${full.product.sku} · order ${full.order.refNo}`, s.receiptNote].filter(Boolean).join(' · ');
      const tone = short ? 'danger' as const : 'success' as const;
      await this.notes.send(em, user,
        { to: { manufacturerId: s.manufacturerId }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.factory, title, body },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.manufacturing('orders'), title, body },
        { to: { distributorId: s.destination === 'Distributor' ? s.distributorId : null }, kind: 'shipment.received', tone, refNo: s.refNo, link: LINK.portal('stock'),
          title: `Receipt of ${s.refNo} recorded`, body: short ? `${body} · Report faulty bundles as a delivery claim.` : body },
      );
      return full;
    });
  }

  // ───────────── helpers ─────────────

  private own(id: string | null | undefined, what: string): string {
    if (!id) throw new ForbiddenException(`This login is not linked to a ${what}.`);
    return id;
  }

  private async one(em: EntityManager, id: string) {
    const s = await em.findOne(ProductionShipment, { where: { id }, relations: ['order', 'product', 'manufacturer', 'distributor'] });
    return this.shape(s!, (await this.soldMap(em))[id] ?? 0, await this.rateMap(em));
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
  private shape(s: ProductionShipment, soldContainers = 0, rates: Record<string, number> = {}) {
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
      onHandContainers,
      onHandValue,
      /** what the distributor is charged per packet: its agreed rate, else the product's */
      saleRate: s.distributorId ? rates[`${s.distributorId}|${s.productId}`] ?? Number(s.product?.rate ?? 0) : null,
      daysLeft,
      overdue: daysLeft !== null && daysLeft < 0 && onHandContainers > 0,
    };
  }
}
