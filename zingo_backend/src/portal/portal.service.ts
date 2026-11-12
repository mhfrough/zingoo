import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Distributor, DistributorRate, Product } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { CollectionsService, OrdersService } from '../distribution/distribution.service';
import { Collection, SalesOrder } from '../distribution/distribution.entities';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { SettingsService } from '../setup/setup.service';
import {
  AcceptRequestDto, CreateAdviceDto, CreateReceiptDto, CreateRequestDto, ProofDto,
} from './portal.dto';
import { AuditLog, CargoReceipt, CreditNote, PaymentAdvice, PortalRequest } from './portal.entities';

/** The signed-in person, as the portal needs them. */
export interface PortalUser {
  id: string;
  name: string;
  role: string;
  distributorId?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const PROOF_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
/** staff who manage the distributor flows (requests, claims) */
const MANAGERS = ['Admin', 'Finance', 'Distribution'];

/**
 * The distributor partner portal. A distributor sees and files only its own records; staff see every distributor.
 *   request  -> staff accept it into a draft sales order (price and terms locked) or reject it
 *   delivery -> the distributor reports good / damaged / missing cartons; a shortage becomes a claim
 *   claim    -> staff approve it (a credit note: reduces the invoice, any excess is credit owed back) or reject it
 *   payment  -> the distributor reports "I paid"; only when staff confirm does it become a collection and enter cash
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly orders: OrdersService,
    private readonly collections: CollectionsService,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
  ) {}

  // ───────────── who is looking ─────────────

  /** the distributor whose records are shown: a distributor login is tied to its own, staff pick one */
  async scope(user: PortalUser, requested?: string): Promise<string> {
    if (user.role === 'Distributor') {
      if (!user.distributorId) throw new ForbiddenException('This login is not linked to a distributor.');
      return user.distributorId;
    }
    if (requested) return requested;
    const first = await this.db.manager.find(Distributor, { order: { name: 'ASC' }, take: 1 });
    if (!first[0]) throw new NotFoundException('Create a distributor first.');
    return first[0].id;
  }

  private isManager(user: PortalUser) {
    return MANAGERS.includes(user.role);
  }

  private async audit(em: EntityManager, user: PortalUser, event: string, reference: string, notes: string) {
    await em.save(em.create(AuditLog, { event, reference, notes, by: user.name }));
  }

  /** an attachment must be a small image or PDF */
  private checkProof(p: ProofDto) {
    if (!p.proofData) return;
    if (p.proofData.length > 620_000) throw new BadRequestException('The attachment is too large; keep it under 450 KB.');
    if (!p.proofMime || !PROOF_TYPES.test(p.proofMime)) throw new BadRequestException('Only an image (PNG, JPEG, WebP, GIF) or a PDF can be attached.');
  }

  private async ownedOrder(em: EntityManager, orderId: string, distributorId: string) {
    const o = await em.findOne(SalesOrder, { where: { id: orderId }, relations: ['product', 'distributor'] });
    if (!o || o.distributorId !== distributorId) throw new NotFoundException('Order not found.');
    return o;
  }

  // ───────────── reads ─────────────

  /** the account position and the open tasks at the top of the portal */
  async profile(distributorId: string) {
    const em = this.db.manager;
    const d = await em.findOne(Distributor, { where: { id: distributorId } });
    if (!d) throw new NotFoundException('Distributor not found.');
    const [orders, s, methods] = await Promise.all([
      this.orders.list().then((l) => l.filter((o) => o.distributorId === distributorId)),
      this.settings.get(),
      this.lookups.list('PAY_METHOD'),
    ]);
    const dispatched = orders.filter((o) => o.status === 'Dispatched');
    const todayIso = today();
    const open = round2(dispatched.reduce((n, o) => n + o.outstanding, 0));
    const overdue = round2(dispatched.filter((o) => o.dueDate < todayIso).reduce((n, o) => n + o.outstanding, 0));
    const receipts = await em.query(`SELECT "orderId" FROM cargo_receipts WHERE "orderId" = ANY($1)`, [orders.map((o) => o.id)]);
    const received = new Set(receipts.map((r: { orderId: string }) => r.orderId));
    const [adv] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS v, COUNT(*)::int AS n FROM payment_advices WHERE "distributorId" = $1 AND status = 'Submitted'`, [distributorId]);
    const [held] = await em.query(`SELECT COALESCE(SUM(c.amount), 0)::float8 AS v FROM collections c JOIN sales_orders o ON o.id = c."orderId" WHERE o."distributorId" = $1 AND o.status <> 'Dispatched'`, [distributorId]);
    const [credit] = await em.query(`SELECT COALESCE(SUM(refund), 0)::float8 AS v FROM credit_notes WHERE "distributorId" = $1`, [distributorId]);
    const limit = Number(d.creditLimit);
    return {
      distributor: d,
      creditLimit: limit,
      openBalance: open,
      overdue,
      availableCredit: Math.max(0, round2(limit - open)),
      pendingAdvices: round2(adv.v),
      pendingAdviceCount: adv.n,
      toAcknowledge: dispatched.filter((o) => !received.has(o.id)).length,
      acknowledged: dispatched.filter((o) => received.has(o.id)).length,
      advancesHeld: round2(held.v),
      creditHeld: round2(credit.v),
      numberFormat: s.numberFormat,
      paymentMethods: methods.filter((m) => m.active).map((m) => m.code),
      paymentCycles: s.paymentCycles,
    };
  }

  /** the distributor's orders with delivery and payment progress */
  async ordersOf(distributorId: string) {
    const em = this.db.manager;
    const list = (await this.orders.list()).filter((o) => o.distributorId === distributorId);
    const ids = list.map((o) => o.id);
    const receipts = ids.length ? await em.find(CargoReceipt, { where: ids.map((id) => ({ orderId: id })) }) : [];
    const pending: { orderId: string; v: number }[] = ids.length
      ? await em.query(`SELECT "orderId", SUM(amount)::float8 AS v FROM payment_advices WHERE status = 'Submitted' AND "orderId" = ANY($1) GROUP BY "orderId"`, [ids])
      : [];
    const pend = Object.fromEntries(pending.map((p) => [p.orderId, round2(p.v)]));
    const todayIso = today();
    return list.map((o) => {
      const r = receipts.find((x) => x.orderId === o.id);
      const status = o.status !== 'Dispatched' ? 'Awaiting dispatch'
        : o.outstanding < 0.01 ? 'Paid'
        : o.dueDate < todayIso ? 'Overdue'
        : o.collected > 0 ? 'Part paid' : 'Open';
      return {
        ...o,
        portalStatus: status,
        voucher: o.status === 'Dispatched' ? 'Invoice' : 'Pro-forma',
        receipt: r ? { id: r.id, refNo: r.refNo, status: r.status } : null,
        pendingAdvice: pend[o.id] ?? 0,
      };
    });
  }

  requestsOf(distributorId: string) {
    return this.db.manager.find(PortalRequest, { where: { distributorId }, relations: ['product', 'order'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  async receiptsOf(distributorId: string) {
    const rows = await this.db.manager.find(CargoReceipt, { relations: ['order', 'order.product'], order: { date: 'DESC', refNo: 'DESC' } });
    return rows.filter((r) => r.order.distributorId === distributorId).map((r) => this.slimReceipt(r));
  }

  /** a receipt without the attachment itself, with the value of what is claimed */
  private slimReceipt(r: CargoReceipt) {
    const { evidenceData, ...rest } = r;
    const packs = r.order.packsPerCarton || r.order.product?.packsPerCarton || 1;
    return {
      ...rest,
      hasEvidence: !!evidenceData,
      claimValue: round2((r.damagedCartons + r.missingCartons) * packs * Number(r.order.rate)),
    };
  }

  async advicesOf(distributorId: string) {
    const rows = await this.db.manager.find(PaymentAdvice, { where: { distributorId }, relations: ['order'], order: { date: 'DESC', refNo: 'DESC' } });
    return rows.map(({ proofData, ...rest }) => ({ ...rest, hasProof: !!proofData }));
  }

  /** every active SKU with the distributor's price: the agreed rate, or the standard one */
  async rates(distributorId: string) {
    const em = this.db.manager;
    const s = await this.settings.get();
    const [products, agreed] = await Promise.all([
      em.find(Product, { where: { active: true }, order: { sku: 'ASC' } }),
      em.find(DistributorRate, { where: { distributorId } }),
    ]);
    return products.map((p) => {
      const a = agreed.find((x) => x.productId === p.id);
      const rate = a ? Number(a.rate) : Number(p.rate);
      const packs = p.packsPerCarton || s.packsPerCarton;
      return {
        productId: p.id, sku: p.sku, name: p.name, mrp: Number(p.mrp), standardRate: Number(p.rate), rate, agreed: !!a,
        packsPerCarton: packs, perCarton: round2(rate * packs), spread: round2(Number(p.mrp) - rate),
        spreadPct: Number(p.mrp) ? round2((100 * (Number(p.mrp) - rate)) / Number(p.mrp)) : 0,
      };
    });
  }

  /** invoices, advances, collections and credit notes in date order with a running balance */
  async statement(distributorId: string) {
    const em = this.db.manager;
    const orders = (await this.orders.list()).filter((o) => o.distributorId === distributorId);
    const ids = orders.map((o) => o.id);
    const collections = ids.length ? await em.find(Collection, { where: ids.map((id) => ({ orderId: id })) }) : [];
    const credits = ids.length ? await em.find(CreditNote, { where: ids.map((id) => ({ orderId: id })) }) : [];
    const byId = new Map(orders.map((o) => [o.id, o]));
    type Entry = { date: string; kind: string; ref: string; description: string; debit: number; credit: number };
    const entries: Entry[] = [
      ...orders.filter((o) => o.status === 'Dispatched').map((o): Entry => ({
        date: o.dispatchDate ?? o.date, kind: 'Invoice', ref: o.refNo, description: o.product.sku, debit: o.billed, credit: 0,
      })),
      ...collections.map((c): Entry => ({
        date: c.date, kind: c.isAdvance ? 'Advance' : 'Collection', ref: c.refNo, description: byId.get(c.orderId)?.refNo ?? '', debit: 0, credit: Number(c.amount),
      })),
      ...credits.map((c): Entry => ({
        date: c.date, kind: 'Credit note', ref: c.refNo, description: byId.get(c.orderId)?.refNo ?? '', debit: 0, credit: Number(c.amount),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    let balance = 0;
    return {
      entries: entries.map((e) => ({ ...e, balance: (balance = round2(balance + e.debit - e.credit)) })),
      invoices: orders.map((o) => ({
        orderId: o.id, refNo: o.refNo, voucher: o.status === 'Dispatched' ? 'Invoice' : 'Pro-forma', sku: o.product.sku,
        billed: o.billed, collected: o.collected, credited: (o as { credited?: number }).credited ?? 0, outstanding: o.outstanding,
      })),
      closing: balance,
    };
  }

  /** everything waiting for staff, across distributors */
  async desk() {
    const em = this.db.manager;
    const s = await this.settings.get();
    const [requests, advices, receipts, audit] = await Promise.all([
      em.find(PortalRequest, { where: { status: 'Requested' }, relations: ['distributor', 'product'], order: { date: 'ASC' } }),
      em.find(PaymentAdvice, { where: { status: 'Submitted' }, relations: ['order', 'order.distributor'], order: { date: 'ASC' } }),
      em.find(CargoReceipt, { where: { status: 'Disputed' }, relations: ['order', 'order.distributor', 'order.product'], order: { date: 'ASC' } }),
      em.find(AuditLog, { order: { createdAt: 'DESC' }, take: 25 }),
    ]);
    const rateOf = async (r: PortalRequest) => {
      const a = await em.findOne(DistributorRate, { where: { distributorId: r.distributorId, productId: r.productId } });
      return a ? Number(a.rate) : Number(r.product.rate);
    };
    return {
      requests: await Promise.all(requests.map(async (r) => {
        const rate = await rateOf(r);
        return { ...r, rate, value: round2(r.cartons * (r.product.packsPerCarton || s.packsPerCarton) * rate) };
      })),
      advices: advices.map(({ proofData, ...rest }) => ({ ...rest, hasProof: !!proofData, distributorName: rest.order.distributor.name })),
      claims: receipts.map((r) => ({ ...this.slimReceipt(r), distributorName: r.order.distributor.name })),
      audit,
    };
  }

  // ───────────── requests ─────────────

  createRequest(dto: CreateRequestDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const distributorId = await this.scope(user, dto.distributorId);
      const product = await em.findOne(Product, { where: { id: dto.productId } });
      if (!product || !product.active) throw new BadRequestException('Choose an active product.');
      if (dto.requestedDate && dto.requestedDate < dto.date) throw new BadRequestException('The requested delivery cannot be before the request date.');
      const refNo = await nextRef(em, PortalRequest, 'REQ', 3);
      const r = await em.save(em.create(PortalRequest, { ...dto, distributorId, refNo, status: 'Requested' }));
      await this.audit(em, user, 'Request submitted', refNo, `${product.sku} / ${dto.cartons} bundles`);
      return r;
    });
  }

  acceptRequest(id: string, dto: AcceptRequestDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(PortalRequest, { where: { id }, relations: ['product', 'distributor'] });
      if (!r || r.status !== 'Requested') throw new BadRequestException('This request is no longer waiting.');
      const s = await this.settings.get(em);
      const agreed = await em.findOne(DistributorRate, { where: { distributorId: r.distributorId, productId: r.productId } });
      const rate = dto.rate ?? (agreed ? Number(agreed.rate) : Number(r.product.rate));
      const refNo = await nextRef(em, SalesOrder, s.docPrefixes['sales'] ?? 'SO', 3, 201);
      const order = await em.save(em.create(SalesOrder, {
        refNo, date: today(), distributorId: r.distributorId, productId: r.productId, cartons: r.cartons, rate,
        packsPerCarton: r.product.packsPerCarton || s.packsPerCarton,
        paymentTermsDays: dto.terms ?? r.distributor.paymentDays ?? s.defaultPaymentCycle,
        advancePct: dto.advancePct ?? Number(r.distributor.advancePct),
        poRef: r.poRef ?? r.refNo, notes: dto.note ?? null, status: 'Draft',
      }));
      r.status = 'Accepted';
      r.orderId = order.id;
      await em.save(r);
      await this.audit(em, user, 'Request accepted', r.refNo, `Created ${refNo}`);
      return { request: r, order };
    });
  }

  rejectRequest(id: string, note: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(PortalRequest, { where: { id } });
      if (!r || r.status !== 'Requested') throw new BadRequestException('This request is no longer waiting.');
      r.status = 'Rejected';
      r.reviewNote = note;
      await em.save(r);
      await this.audit(em, user, 'Request rejected', r.refNo, note);
      return r;
    });
  }

  // ───────────── delivery and claims ─────────────

  createReceipt(dto: CreateReceiptDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const distributorId = await this.scope(user, dto.distributorId);
      const o = await this.ownedOrder(em, dto.orderId, distributorId);
      if (o.status !== 'Dispatched') throw new BadRequestException('Only a dispatched order can be received.');
      if (await em.findOne(CargoReceipt, { where: { orderId: o.id } })) throw new BadRequestException('A cargo receipt already exists for this order; ask Zingoo to amend it.');
      if (dto.goodCartons + dto.damagedCartons + dto.missingCartons !== o.cartons) {
        throw new BadRequestException(`Good + damaged + missing bundles must equal the ${o.cartons} shipped.`);
      }
      const discrepancy = dto.damagedCartons > 0 || dto.missingCartons > 0;
      if ((discrepancy || dto.condition !== 'Good') && !dto.reason?.trim()) throw new BadRequestException('Explain the cargo discrepancy before submitting.');
      this.checkProof(dto);
      const refNo = await nextRef(em, CargoReceipt, 'POD', 3);
      const r = await em.save(em.create(CargoReceipt, {
        refNo, date: dto.date, orderId: o.id, goodCartons: dto.goodCartons, damagedCartons: dto.damagedCartons, missingCartons: dto.missingCartons,
        condition: dto.condition, waybill: dto.waybill ?? o.refNo, receivedBy: dto.receivedBy ?? null, reason: dto.reason ?? null,
        evidence: dto.proofName ?? null, evidenceMime: dto.proofMime ?? null, evidenceData: dto.proofData ?? null,
        status: discrepancy ? 'Disputed' : 'Accepted',
      }));
      await this.audit(em, user, 'Delivery acknowledged', o.refNo, discrepancy ? 'Damage or shortage claim pending' : 'Delivered without reported shortage');
      return this.slimReceipt({ ...r, order: o } as CargoReceipt);
    });
  }

  /** approve a claim: a credit note for the damaged and missing cartons at the order's price */
  approveClaim(id: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(CargoReceipt, { where: { id }, relations: ['order', 'order.product'] });
      if (!r || r.status !== 'Disputed') throw new BadRequestException('This claim is no longer waiting for review.');
      const view = await this.orders.findOne(r.orderId, em);
      const packs = r.order.packsPerCarton || r.order.product.packsPerCarton || 1;
      const amount = round2((r.damagedCartons + r.missingCartons) * packs * Number(r.order.rate));
      const applied = Math.min(amount, Math.max(0, view.outstanding));
      const refNo = await nextRef(em, CreditNote, 'CN', 3);
      const note = await em.save(em.create(CreditNote, {
        refNo, date: today(), orderId: r.orderId, distributorId: r.order.distributorId, amount, refund: round2(amount - applied),
        reason: r.reason ?? `${r.damagedCartons} damaged, ${r.missingCartons} missing`,
      }));
      r.status = 'Approved';
      await em.save(r);
      await this.posting.syncCreditNote(em, note.id);
      await this.audit(em, user, 'Credit note approved', refNo, `${r.order.refNo} · PKR ${amount}`);
      return note;
    });
  }

  rejectClaim(id: string, noteText: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(CargoReceipt, { where: { id }, relations: ['order'] });
      if (!r || r.status !== 'Disputed') throw new BadRequestException('This claim is no longer waiting for review.');
      r.status = 'Rejected';
      r.reviewNote = noteText;
      await em.save(r);
      await this.audit(em, user, 'Claim rejected', r.refNo, noteText);
      return { id: r.id, status: r.status };
    });
  }

  // ───────────── payments ─────────────

  /** what can still be paid on an order: the invoice balance, or (before dispatch) the pro-forma less advances, less pending advices */
  private async payable(em: EntityManager, orderId: string) {
    const o = await this.orders.findOne(orderId, em);
    const remaining = o.status === 'Dispatched' ? o.outstanding : Math.max(0, round2(o.billed - o.collected));
    const [p] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM payment_advices WHERE "orderId" = $1 AND status = 'Submitted'`, [orderId]);
    return { order: o, remaining, pending: round2(p.v) };
  }

  createAdvice(dto: CreateAdviceDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const distributorId = await this.scope(user, dto.distributorId);
      await this.ownedOrder(em, dto.orderId, distributorId);
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      const { order, remaining, pending } = await this.payable(em, dto.orderId);
      const available = Math.max(0, round2(remaining - pending));
      if (available <= 0) throw new BadRequestException('Nothing is left to pay on this order.');
      if (dto.amount > available + 0.001) throw new BadRequestException(`The amount cannot be more than the PKR ${available} still open on this order.`);
      this.checkProof(dto);
      const refNo = await nextRef(em, PaymentAdvice, 'ADV', 3);
      const a = await em.save(em.create(PaymentAdvice, {
        refNo, date: dto.date, orderId: dto.orderId, distributorId, amount: dto.amount, method: dto.method ?? 'Bank Transfer',
        bankRef: dto.bankRef ?? null, proof: dto.proofName ?? null, proofMime: dto.proofMime ?? null, proofData: dto.proofData ?? null,
        note: dto.note ?? null, status: 'Submitted', isAdvance: order.status !== 'Dispatched',
      }));
      await this.audit(em, user, 'Payment advice sent', refNo, `${order.refNo} / PKR ${dto.amount}`);
      const { proofData, ...rest } = a;
      return { ...rest, hasProof: !!proofData };
    });
  }

  /** staff verified the money: it becomes a collection (an advance when the order is not dispatched yet) */
  confirmAdvice(id: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(PaymentAdvice, { where: { id } });
      if (!a || a.status !== 'Submitted') throw new BadRequestException('This advice was already reviewed.');
      const { remaining } = await this.payable(em, a.orderId);
      if (Number(a.amount) > remaining + 0.001) throw new BadRequestException('The amount is more than what is still open on the order. Reject it and ask for a corrected advice.');
      const c = await this.collections.createInTransaction(em, {
        orderId: a.orderId, date: a.date, amount: Number(a.amount), method: a.method, note: `Verified advice ${a.refNo}${a.bankRef ? ` · ${a.bankRef}` : ''}`,
      });
      a.status = 'Confirmed';
      a.collectionId = c.id;
      await em.save(a);
      await this.audit(em, user, 'Payment confirmed', a.refNo, `Receipt ${c.refNo}${c.isAdvance ? ' (advance held until dispatch)' : ''}`);
      return { id: a.id, status: a.status, collection: c };
    });
  }

  rejectAdvice(id: string, note: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(PaymentAdvice, { where: { id } });
      if (!a || a.status !== 'Submitted') throw new BadRequestException('This advice was already reviewed.');
      a.status = 'Rejected';
      a.reviewNote = note;
      await em.save(a);
      await this.audit(em, user, 'Payment rejected', a.refNo, note);
      return { id: a.id, status: a.status };
    });
  }

  // ───────────── attachments ─────────────

  /** the attachment of a receipt or an advice, for the owner or staff */
  async attachment(kind: 'receipt' | 'advice', id: string, user: PortalUser) {
    const em = this.db.manager;
    if (kind === 'receipt') {
      const r = await em.findOne(CargoReceipt, { where: { id }, relations: ['order'] });
      if (!r) throw new NotFoundException('Not found.');
      this.allow(user, r.order.distributorId);
      if (!r.evidenceData) throw new NotFoundException('There is no attachment.');
      return { name: r.evidence ?? `${r.refNo}`, mime: r.evidenceMime ?? 'application/octet-stream', data: r.evidenceData };
    }
    const a = await em.findOne(PaymentAdvice, { where: { id } });
    if (!a) throw new NotFoundException('Not found.');
    this.allow(user, a.distributorId);
    if (!a.proofData) throw new NotFoundException('There is no attachment.');
    return { name: a.proof ?? a.refNo, mime: a.proofMime ?? 'application/octet-stream', data: a.proofData };
  }

  private allow(user: PortalUser, distributorId: string) {
    if (user.role === 'Distributor' && user.distributorId !== distributorId) throw new ForbiddenException('This record belongs to another distributor.');
  }
}
