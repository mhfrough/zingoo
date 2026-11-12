import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { Role } from '../common/enums';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { SettingsService } from '../setup/setup.service';
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
    return rows.map((s) => this.shape(s));
  }

  /**
   * Stock held by distributors (consignment), lot by lot (one received shipment is one lot) and per product:
   * containers, bundles, packets and value at cost, with the sell-by date. Nothing is sold yet in this phase,
   * so on hand = received.
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
      return this.one(em, row.id);
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
      return this.one(em, id);
    });
  }

  // ───────────── helpers ─────────────

  private own(id: string | null | undefined, what: string): string {
    if (!id) throw new ForbiddenException(`This login is not linked to a ${what}.`);
    return id;
  }

  private async one(em: EntityManager, id: string) {
    const s = await em.findOne(ProductionShipment, { where: { id }, relations: ['order', 'product', 'manufacturer', 'distributor'] });
    return this.shape(s!);
  }

  private async event(em: EntityManager, orderId: string, user: ShipmentUser, event: string, note: string | null) {
    await em.save(em.create(ProductionOrderEvent, {
      orderId, event, note, by: user.name,
      side: user.role === 'Manufacturer' ? 'Manufacturer' : user.role === 'Distributor' ? 'Distributor' : 'Company',
    }));
  }

  /** quantities and value of what was sent and what arrived; what is still on hand and whether it is past its sell-by date */
  private shape(s: ProductionShipment) {
    const perContainer = s.bundlesPerContainer * s.packetsPerBundle;
    const received = s.receivedContainers ?? 0;
    const onHandContainers = s.status === 'Received' ? received : 0;
    const onHandValue = round2(onHandContainers * perContainer * Number(s.rate));
    const daysLeft = s.sellBy ? Math.round((Date.parse(s.sellBy) - Date.parse(today())) / 86_400_000) : null;
    return {
      ...s,
      packets: s.containers * perContainer,
      value: round2(s.containers * perContainer * Number(s.rate)),
      receivedValue: round2(received * perContainer * Number(s.rate)),
      onHandContainers,
      onHandValue,
      daysLeft,
      overdue: daysLeft !== null && daysLeft < 0 && onHandContainers > 0,
    };
  }
}
