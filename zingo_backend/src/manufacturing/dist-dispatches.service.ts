import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere } from 'typeorm';
import { nextRef } from '../common/ref';
import { LINK, NotificationsService, plural } from '../notifications/notifications.service';
import { SettingsService } from '../setup/setup.service';
import { CloseDistDispatchDto, CreateDistDispatchDto } from './dist-dispatches.dto';
import { DistributorDispatch } from './dist-dispatches.entities';
import { ProductionShipment } from './shipments.entities';
import { ShipmentUser } from './shipments.service';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Dispatches from a distributor to its own customers, taken from a received delivery (batch). The distributor
 * records each one and closes it as delivered or returned; Zen Foods (Distribution) is told at each step.
 * A batch cannot send out more bundles than arrived in good order, less faulty bundles still on a claim.
 */
@Injectable()
export class DistDispatchesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly settings: SettingsService,
    private readonly notes: NotificationsService,
  ) {}

  /** a distributor sees its own dispatches, staff all (or one distributor's) */
  async list(user: ShipmentUser, distributorId?: string) {
    const where: FindOptionsWhere<DistributorDispatch> = {};
    if (user.role === 'Distributor') where.distributorId = this.own(user.distributorId);
    else if (distributorId) where.distributorId = distributorId;
    return this.db.manager.find(DistributorDispatch, {
      where, relations: ['shipment', 'product', 'distributor'], order: { date: 'DESC', refNo: 'DESC' },
    });
  }

  async create(user: ShipmentUser, dto: CreateDistDispatchDto) {
    return this.db.transaction(async (em) => {
      const s = await em.findOne(ProductionShipment, { where: { id: dto.shipmentId }, relations: ['product', 'distributor'] });
      if (!s) throw new NotFoundException('Delivery not found.');
      if (user.role === 'Distributor' && s.distributorId !== this.own(user.distributorId)) throw new ForbiddenException('This delivery went to another distributor.');
      if (s.destination !== 'Distributor' || !s.distributorId) throw new BadRequestException('Only goods held by a distributor can be dispatched from here.');
      if (s.status !== 'Received') throw new BadRequestException(`Confirm receipt of ${s.refNo} first, then dispatch from it.`);
      if (dto.date > today()) throw new BadRequestException('A dispatch cannot be dated in the future.');
      if (dto.date < s.receivedDate!) throw new BadRequestException(`${s.refNo} arrived on ${s.receivedDate}; it cannot be dispatched before that.`);
      const left = await this.available(em, s);
      if (left <= 0) throw new BadRequestException(`Every bundle of ${s.refNo} has already been dispatched.`);
      if (dto.bundles > left) throw new BadRequestException(`Only ${plural(left, 'bundle')} of ${s.refNo} can still be dispatched.`);

      const settings = await this.settings.get(em);
      const refNo = await nextRef(em, DistributorDispatch, settings.docPrefixes['distDispatch'] ?? 'DSP', 3);
      const d = await em.save(em.create(DistributorDispatch, {
        refNo, date: dto.date, distributorId: s.distributorId, shipmentId: s.id, productId: s.productId, bundles: dto.bundles,
        customer: dto.customer.trim(), area: dto.area?.trim() || null, vehicle: dto.vehicle?.trim() || null,
        note: dto.note?.trim() || null, dispatchedBy: user.name, status: 'Dispatched',
      }));
      const what = `${plural(dto.bundles, 'bundle')} of ${s.product.sku} to ${d.customer}${d.area ? ` (${d.area})` : ''}`;
      const via = [d.vehicle && `vehicle ${d.vehicle}`, `from ${s.refNo}`].filter(Boolean).join(' · ');
      await this.notes.send(em, user,
        { to: { staff: ['Distribution'] }, kind: 'dist-dispatch.sent', refNo, link: LINK.portal('stock'),
          title: `${s.distributor!.name} dispatched ${what}`, body: via },
        { to: { distributorId: s.distributorId }, kind: 'dist-dispatch.sent', refNo, link: LINK.portal('stock'),
          title: `Dispatch ${refNo} recorded: ${what}`, body: 'Mark it delivered when the customer has it.' },
      );
      return this.one(em, d.id);
    });
  }

  async close(user: ShipmentUser, id: string, dto: CloseDistDispatchDto) {
    return this.db.transaction(async (em) => {
      const d = await em.findOne(DistributorDispatch, { where: { id }, relations: ['product', 'distributor'] });
      if (!d) throw new NotFoundException('Dispatch not found.');
      if (user.role === 'Distributor' && d.distributorId !== this.own(user.distributorId)) throw new ForbiddenException('This dispatch belongs to another distributor.');
      if (d.status !== 'Dispatched') throw new BadRequestException(`${d.refNo} is already ${d.status.toLowerCase()}.`);
      if (dto.date > today()) throw new BadRequestException('The date cannot be in the future.');
      if (dto.date < d.date) throw new BadRequestException(`${d.refNo} left on ${d.date}; the date cannot be before that.`);
      d.status = dto.outcome;
      d.closedDate = dto.date;
      d.closedNote = (dto.outcome === 'Returned' ? dto.note : dto.deliveredNote)?.trim() || null;
      d.closedBy = user.name;
      await em.save(d);
      const what = `${plural(d.bundles, 'bundle')} of ${d.product.sku} for ${d.customer}`;
      const tone = dto.outcome === 'Returned' ? 'danger' as const : 'success' as const;
      const title = dto.outcome === 'Returned' ? `Dispatch ${d.refNo} came back: ${what}` : `Dispatch ${d.refNo} delivered: ${what}`;
      await this.notes.send(em, user,
        { to: { staff: ['Distribution'] }, kind: `dist-dispatch.${dto.outcome.toLowerCase()}`, tone, refNo: d.refNo, link: LINK.portal('stock'),
          title: `${d.distributor.name}: ${title.charAt(0).toLowerCase()}${title.slice(1)}`, body: d.closedNote },
        { to: { distributorId: d.distributorId }, kind: `dist-dispatch.${dto.outcome.toLowerCase()}`, tone, refNo: d.refNo, link: LINK.portal('stock'),
          title, body: d.closedNote },
      );
      return this.one(em, d.id);
    });
  }

  /** bundles of a delivery that can still go out: arrived in good order, less open or accepted claims, less dispatches not returned */
  private async available(em: EntityManager, s: ProductionShipment) {
    const received = (s.receivedContainers ?? 0) * s.bundlesPerContainer;
    const [{ claimed }] = await em.query(
      `SELECT COALESCE(SUM(bundles), 0)::int AS claimed FROM delivery_claims WHERE "shipmentId" = $1 AND status <> 'Rejected'`, [s.id]);
    const [{ out }] = await em.query(
      `SELECT COALESCE(SUM(bundles), 0)::int AS out FROM distributor_dispatches WHERE "shipmentId" = $1 AND status <> 'Returned'`, [s.id]);
    return received - Number(claimed) - Number(out);
  }

  private own(id: string | null | undefined): string {
    if (!id) throw new ForbiddenException('This login is not linked to a distributor.');
    return id;
  }

  private one(em: EntityManager, id: string) {
    return em.findOneOrFail(DistributorDispatch, { where: { id }, relations: ['shipment', 'product', 'distributor'] });
  }
}
