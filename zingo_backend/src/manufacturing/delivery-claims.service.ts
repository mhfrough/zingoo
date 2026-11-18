import { AttachmentsService } from '../attachments/attachments.service';
import { Attachment } from '../attachments/attachment.entity';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { plainText } from '../common/plain-text';
import { LINK, Note, NotificationsService, TEAM, plural } from '../notifications/notifications.service';
import { CreateDeliveryClaimDto, DecideDeliveryClaimDto } from './delivery-claims.dto';
import { DeliveryClaim, DeliveryClaimNote } from './delivery-claims.entities';
import { ProductionOrderEvent } from './production-orders.entities';
import { ProductionShipment } from './shipments.entities';
import { ShipmentUser } from './shipments.service';

const today = () => new Date().toISOString().slice(0, 10);
/** a photo or PDF backing a claim */
interface ClaimProof {
  id: string;
  name: string;
  mime: string;
  size: number;
}

const PROOF_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/**
 * Faulty goods in a manufacturer's delivery. Raised by the distributor the goods went to (or Admin / Distribution
 * for it); decided by the manufacturer they came from (or Admin / Manufacturing for it). Everyone involved and
 * Zen Foods is told at each step.
 *   Credit  -> Manufacturer Payable / Inventory at Distributor for the claim's value; later sales of that delivery
 *              carry the lower cost
 *   Replace -> nothing posts; the manufacturer sends the goods again on the order
 */
@Injectable()
export class DeliveryClaimsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly notes: NotificationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  /** a distributor sees its own claims, a manufacturer the claims on its goods, staff all (or a filter) */
  async list(user: ShipmentUser, filter: { distributorId?: string; manufacturerId?: string } = {}) {
    const where: FindOptionsWhere<DeliveryClaim> = {};
    if (user.role === 'Distributor') where.distributorId = this.own(user.distributorId, 'distributor');
    else if (user.role === 'Manufacturer') where.manufacturerId = this.own(user.manufacturerId, 'manufacturer');
    else {
      if (filter.distributorId) where.distributorId = filter.distributorId;
      if (filter.manufacturerId) where.manufacturerId = filter.manufacturerId;
    }
    const rows = await this.db.manager.find(DeliveryClaim, {
      where, relations: ['shipment', 'product', 'manufacturer', 'distributor'], order: { date: 'DESC', refNo: 'DESC' },
    });
    const extra = await this.extras(this.db.manager, rows.map((c) => c.id));
    return rows.map((c) => this.shape(c, extra));
  }

  async create(user: ShipmentUser, dto: CreateDeliveryClaimDto) {
    return this.db.transaction(async (em) => {
      const s = await em.findOne(ProductionShipment, { where: { id: dto.shipmentId }, relations: ['product', 'distributor', 'manufacturer'] });
      if (!s) throw new NotFoundException('Delivery not found.');
      const c = await this.createIn(em, user, s, dto);
      return this.one(em, c.id);
    });
  }

  /**
   * A claim on one load, inside the caller's transaction (the claim form, or damage lines typed on the pickup or the
   * receipt). A load collected at the factory can be claimed on before it arrives (damage seen at the gate).
   */
  async createIn(em: EntityManager, user: ShipmentUser, s: ProductionShipment,
    dto: { date: string; kind: DeliveryClaim['kind']; bundles: number; note: string; proofIds?: string[]; proofName?: string; proofMime?: string; proofData?: string }) {
    if (dto.proofData) {
      if (dto.proofData.length > 620_000) throw new BadRequestException('The attachment is too large; keep it under 450 KB.');
      if (!dto.proofMime || !PROOF_TYPES.test(dto.proofMime)) throw new BadRequestException('Only an image (PNG, JPEG, WebP, GIF) or a PDF can be attached.');
    }
    {
      if (user.role === 'Distributor' && s.distributorId !== this.own(user.distributorId, 'distributor')) throw new ForbiddenException('This delivery went to another distributor.');
      if (s.destination !== 'Distributor' || !s.distributorId) throw new BadRequestException('Only a delivery to a distributor can be claimed on here.');
      const atGate = s.status !== 'Received' && s.method === 'Pickup';
      if (s.status !== 'Received' && !atGate) throw new BadRequestException(`Receive ${s.refNo} first, then report what was faulty.`);
      if (dto.date > today()) throw new BadRequestException('A claim cannot be dated in the future.');
      const from = atGate ? s.shipDate : s.receivedDate!;
      if (dto.date < from) throw new BadRequestException(`${s.refNo} ${atGate ? 'was collected' : 'arrived'} on ${from}; the claim cannot be dated before that.`);
      // at the gate the whole load counts; after arrival what arrived
      const received = (atGate ? s.containers : s.receivedContainers ?? 0) * s.bundlesPerContainer;
      const [{ n }] = await em.query(`SELECT COALESCE(SUM(bundles), 0)::int AS n FROM delivery_claims WHERE "shipmentId" = $1 AND status <> 'Rejected'`, [s.id]);
      const left = received - Number(n);
      if (left <= 0) throw new BadRequestException(`Every bundle of ${s.refNo} is already on a claim.`);
      if (dto.bundles > left) throw new BadRequestException(`Only ${left} bundle${left === 1 ? '' : 's'} of ${s.refNo} can still be claimed (${received} received).`);

      const refNo = await nextRef(em, DeliveryClaim, 'SCL', 3);
      const value = round2(dto.bundles * s.packetsPerBundle * Number(s.rate));
      const c = await em.save(em.create(DeliveryClaim, {
        refNo, date: dto.date, shipmentId: s.id, orderId: s.orderId, productId: s.productId, manufacturerId: s.manufacturerId,
        distributorId: s.distributorId, kind: dto.kind, bundles: dto.bundles, value, note: dto.note.trim(),
        evidence: dto.proofData ? dto.proofName ?? `${refNo} evidence` : null, evidenceMime: dto.proofData ? dto.proofMime ?? null : null,
        evidenceData: dto.proofData ?? null, raisedBy: user.name, status: 'Pending',
      }));
      for (const fileId of [...new Set(dto.proofIds ?? [])]) await this.attachments.attach(fileId, 'CLAIM_PROOF', c.id, em);
      await this.event(em, s.orderId, user, `Claim ${refNo}: ${dto.bundles} ${dto.kind.toLowerCase()} bundle${dto.bundles === 1 ? '' : 's'} (${s.refNo})`, dto.note.trim());
      const what = `${dto.bundles} ${dto.kind.toLowerCase()} bundle${dto.bundles === 1 ? '' : 's'} of ${s.product.sku} on ${s.refNo}`;
      await this.notes.send(em, user,
        { to: { manufacturerId: s.manufacturerId }, kind: 'delivery-claim.filed', tone: 'danger', refNo, link: LINK.factory,
          title: `${s.distributor!.name} claims ${what}`, body: `${dto.note.trim()} · Accept (credit or replacement) or reject with a reason.` },
        { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'delivery-claim.filed', tone: 'danger', refNo, link: LINK.manufacturing('orders'),
          title: `Delivery claim ${refNo}: ${s.distributor!.name} · ${s.manufacturer.name}`, body: `${what}. Waiting for ${s.manufacturer.name}.` },
        { to: { distributorId: s.distributorId }, kind: 'delivery-claim.filed', refNo, link: LINK.portal('stock'),
          title: `Claim ${refNo} sent to ${s.manufacturer.name}`, body: what },
      );
      return c;
    }
  }

  async decide(user: ShipmentUser, id: string, dto: DecideDeliveryClaimDto) {
    return this.db.transaction(async (em) => {
      const c = await em.findOne(DeliveryClaim, { where: { id }, relations: ['shipment', 'product', 'manufacturer', 'distributor'] });
      if (!c) throw new NotFoundException('Claim not found.');
      if (user.role === 'Manufacturer' && c.manufacturerId !== this.own(user.manufacturerId, 'manufacturer')) throw new ForbiddenException('This claim is about another manufacturer\'s goods.');
      // on the manufacturer's side only its Owner or Manager decides
      if (user.role === 'Manufacturer' && !['Owner', 'Manager'].includes(user.portalRole ?? 'Owner')) throw new ForbiddenException('Only the manufacturer\'s Owner or Manager accepts, rejects or holds a claim.');
      if (c.status !== 'Pending' && c.status !== 'Hold') throw new BadRequestException(`${c.refNo} was already ${c.status.toLowerCase()}.`);
      if (dto.decision === 'Hold') {
        if (c.status === 'Hold') throw new BadRequestException(`${c.refNo} is already on hold.`);
        c.status = 'Hold';
        c.decisionNote = dto.note!.trim();
        c.decidedBy = user.name;
        c.decidedDate = today();
        await em.save(c);
        await this.event(em, c.orderId, user, `Claim ${c.refNo} put on hold`, c.decisionNote);
        await this.addNoteIn(em, user, c, `On hold: ${plainText(c.decisionNote)}`, false);
        const body = `${plural(c.bundles, `${c.kind.toLowerCase()} bundle`)} of ${c.product.sku} · ${c.decisionNote}`;
        await this.notes.send(em, user,
          { to: { distributorId: c.distributorId }, kind: 'delivery-claim.hold', tone: 'warning', refNo: c.refNo, link: LINK.portal('stock'),
            title: `${c.manufacturer.name} put claim ${c.refNo} on hold`, body },
          { to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'delivery-claim.hold', tone: 'warning', refNo: c.refNo, link: LINK.manufacturing('orders'),
            title: `Claim ${c.refNo} (${c.distributor.name}) on hold at ${c.manufacturer.name}`, body },
        );
        return this.one(em, c.id);
      }
      if (dto.decision === 'Accept') {
        if (!dto.resolution) throw new BadRequestException('Choose a credit or a replacement.');
        if (dto.resolution === 'Credit' && c.shipment.status !== 'Received') {
          throw new BadRequestException(`${c.shipment.refNo} has not arrived yet. Hold the claim until it does, or choose a replacement.`);
        }
        if (dto.resolution === 'Credit') {
          const [{ sold }] = await em.query(
            `SELECT COALESCE(SUM(l.containers), 0)::int AS sold FROM distributor_invoice_lines l JOIN distributor_invoices i ON i.id = l."invoiceId"
              WHERE i.status <> 'Rejected' AND l."shipmentId" = $1`, [c.shipmentId]);
          if ((c.shipment.receivedContainers ?? 0) - Number(sold) <= 0) {
            throw new BadRequestException(`All of ${c.shipment.refNo} was already sold, so a credit cannot be set against its stock. Choose a replacement.`);
          }
        }
      }
      c.status = dto.decision === 'Accept' ? 'Accepted' : 'Rejected';
      c.resolution = dto.decision === 'Accept' ? dto.resolution! : null;
      c.decisionNote = dto.note?.trim() || null;
      c.decidedBy = user.name;
      c.decidedDate = today();
      await em.save(c);
      await this.posting.syncDeliveryClaim(em, c.id);
      await this.posting.syncOrderAdvance(em, c.orderId);
      const outcome = c.status === 'Rejected' ? 'rejected' : c.resolution === 'Credit' ? `accepted with a credit of PKR ${c.value.toLocaleString('en-US')}` : 'accepted: replacement goods will be sent';
      await this.event(em, c.orderId, user, `Claim ${c.refNo} ${outcome}`, c.decisionNote);
      const tone = c.status === 'Rejected' ? 'danger' as const : 'success' as const;
      const body = [`${plural(c.bundles, `${c.kind.toLowerCase()} bundle`)} of ${c.product.sku} on ${c.shipment.refNo}`, c.decisionNote && `Reason: ${c.decisionNote}`].filter(Boolean).join(' · ');
      await this.notes.send(em, user,
        // the credit is valued at the manufacturer's rate: the distributor is told the outcome, not the amount
        { to: { distributorId: c.distributorId }, kind: 'delivery-claim.decided', tone, refNo: c.refNo, link: LINK.portal('stock'),
          title: `${c.manufacturer.name} ${c.status === 'Rejected' ? 'rejected' : c.resolution === 'Credit' ? 'accepted with a credit' : 'accepted: replacement goods will be sent'} on claim ${c.refNo}`, body },
        { to: { staff: [...TEAM.manufacturing, 'Distribution', 'Finance'] }, kind: 'delivery-claim.decided', tone, refNo: c.refNo, link: LINK.manufacturing('orders'),
          title: `Claim ${c.refNo} (${c.distributor.name}) ${outcome} by ${c.manufacturer.name}`, body },
        { to: { manufacturerId: c.manufacturerId }, kind: 'delivery-claim.decided', tone, refNo: c.refNo, link: LINK.factory,
          title: `Claim ${c.refNo} ${outcome}`, body },
      );
      return this.one(em, c.id);
    });
  }

  /** a message on a claim from anyone involved (the distributor, the manufacturer, Zen Foods); the others are told */
  async addNote(user: ShipmentUser, id: string, text: string) {
    return this.db.transaction(async (em) => {
      const c = await em.findOne(DeliveryClaim, { where: { id }, relations: ['shipment', 'product', 'manufacturer', 'distributor'] });
      if (!c) throw new NotFoundException('Claim not found.');
      this.checkParty(user, c);
      await this.addNoteIn(em, user, c, text.trim(), true);
      return this.one(em, c.id);
    });
  }

  private async addNoteIn(em: EntityManager, user: ShipmentUser, c: DeliveryClaim, text: string, notify: boolean) {
    const side = user.role === 'Distributor' ? 'Distributor' : user.role === 'Manufacturer' ? 'Manufacturer' : 'Company';
    await em.save(em.create(DeliveryClaimNote, { claimId: c.id, text, by: user.name, side }));
    if (!notify) return;
    const title = `${user.name} (${side.toLowerCase()}) on claim ${c.refNo}`;
    const to: Note[] = [];
    if (side !== 'Distributor') to.push({ to: { distributorId: c.distributorId }, kind: 'delivery-claim.note', refNo: c.refNo, link: LINK.portal('stock'), title, body: text });
    if (side !== 'Manufacturer') to.push({ to: { manufacturerId: c.manufacturerId }, kind: 'delivery-claim.note', refNo: c.refNo, link: LINK.factory, title, body: text });
    if (side !== 'Company') to.push({ to: { staff: [...TEAM.manufacturing, 'Distribution'] }, kind: 'delivery-claim.note', refNo: c.refNo, link: LINK.manufacturing('orders'), title, body: text });
    await this.notes.send(em, user, ...to);
  }

  /** the distributor the goods went to, the manufacturer they came from, or staff */
  private checkParty(user: ShipmentUser, c: Pick<DeliveryClaim, 'distributorId' | 'manufacturerId'>) {
    if (user.role === 'Distributor' && c.distributorId !== user.distributorId) throw new ForbiddenException('This claim belongs to another distributor.');
    if (user.role === 'Manufacturer' && c.manufacturerId !== user.manufacturerId) throw new ForbiddenException('This claim is about another manufacturer\'s goods.');
  }

  /** one proof file of a claim, for the parties of the claim */
  async proof(user: ShipmentUser, id: string, fileId: string) {
    const c = await this.db.manager.findOne(DeliveryClaim, { where: { id }, select: { id: true, distributorId: true, manufacturerId: true } });
    if (!c) throw new NotFoundException('Claim not found.');
    this.checkParty(user, c);
    const a = await this.attachments.content(fileId);
    if (a.ownerType !== 'CLAIM_PROOF' || a.ownerId !== id) throw new NotFoundException('File not found.');
    return a;
  }

  async evidence(user: ShipmentUser, id: string) {
    const c = await this.db.manager.findOne(DeliveryClaim, { where: { id }, select: { id: true, refNo: true, distributorId: true, manufacturerId: true, evidence: true, evidenceMime: true, evidenceData: true } });
    if (!c) throw new NotFoundException('Claim not found.');
    if (user.role === 'Distributor' && c.distributorId !== user.distributorId) throw new ForbiddenException('This claim belongs to another distributor.');
    if (user.role === 'Manufacturer' && c.manufacturerId !== user.manufacturerId) throw new ForbiddenException('This claim is about another manufacturer\'s goods.');
    if (!c.evidenceData) throw new NotFoundException('There is no attachment.');
    return { name: c.evidence ?? c.refNo, mime: c.evidenceMime ?? 'application/octet-stream', data: c.evidenceData };
  }

  // ───────────── helpers ─────────────

  private own(id: string | null | undefined, what: string): string {
    if (!id) throw new ForbiddenException(`This login is not linked to a ${what}.`);
    return id;
  }

  private async one(em: EntityManager, id: string) {
    const c = await em.findOne(DeliveryClaim, { where: { id }, relations: ['shipment', 'product', 'manufacturer', 'distributor'] });
    return this.shape(c!, await this.extras(em, [id]));
  }

  /** the proof files and the messages of each claim */
  private async extras(em: EntityManager, ids: string[]) {
    if (!ids.length) return { proofs: {} as Record<string, ClaimProof[]>, thread: {} as Record<string, DeliveryClaimNote[]> };
    const [files, notes] = await Promise.all([
      em.find(Attachment, { where: { ownerType: 'CLAIM_PROOF', ownerId: In(ids) }, order: { createdAt: 'ASC' } }),
      em.find(DeliveryClaimNote, { where: { claimId: In(ids) }, order: { createdAt: 'ASC' } }),
    ]);
    const proofs: Record<string, ClaimProof[]> = {};
    for (const f of files) (proofs[f.ownerId!] ??= []).push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
    const thread: Record<string, DeliveryClaimNote[]> = {};
    for (const n of notes) (thread[n.claimId] ??= []).push(n);
    return { proofs, thread };
  }

  private shape(c: DeliveryClaim, extra?: { proofs: Record<string, ClaimProof[]>; thread: Record<string, DeliveryClaimNote[]> }) {
    const { shipment, product, manufacturer, distributor, evidenceData: _data, ...rest } = c;
    return {
      ...rest,
      shipmentRef: shipment?.refNo ?? null, shipmentStatus: shipment?.status ?? null, atGate: shipment?.method === 'Pickup' && shipment?.status !== 'Received',
      sku: product?.sku ?? null, productName: product?.name ?? null,
      manufacturer: manufacturer?.name ?? null, distributor: distributor?.name ?? null, hasEvidence: !!c.evidence,
      proofs: extra?.proofs[c.id] ?? [],
      thread: (extra?.thread[c.id] ?? []).map((n) => ({ id: n.id, text: n.text, by: n.by, side: n.side, createdAt: n.createdAt })),
    };
  }

  private async event(em: EntityManager, orderId: string, user: ShipmentUser, event: string, note: string | null) {
    await em.save(em.create(ProductionOrderEvent, {
      orderId, event, note, by: user.name,
      side: user.role === 'Manufacturer' ? 'Manufacturer' : user.role === 'Distributor' ? 'Distributor' : 'Company',
    }));
  }
}

/** accepted credit claims per delivery, PKR (used by costs, the manufacturer's account and the payables) */
export async function creditsByShipment(em: EntityManager, shipmentIds?: string[]): Promise<Record<string, number>> {
  const rows: { shipmentId: string; v: number }[] = await em.query(
    `SELECT "shipmentId", SUM(value)::float8 AS v FROM delivery_claims WHERE status = 'Accepted' AND resolution = 'Credit'
       ${shipmentIds ? `AND "shipmentId" = ANY($1)` : ''} GROUP BY "shipmentId"`, shipmentIds ? [shipmentIds] : []);
  return Object.fromEntries(rows.map((r) => [r.shipmentId, round2(Number(r.v))]));
}
