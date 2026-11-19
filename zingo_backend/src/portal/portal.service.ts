import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { expectedDate, movementOf } from '../manufacturing/order-movement';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { Distributor, DistributorRate, Manufacturer, Product } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { claimRef, nextRef } from '../common/ref';
import { CollectionsService, OrdersService } from '../distribution/distribution.service';
import { Collection, SalesOrder } from '../distribution/distribution.entities';
import { PostingService } from '../ledger/posting.service';
import { Role } from '../common/enums';
import { ProductionOrder } from '../manufacturing/production-orders.entities';
import { ProductionOrdersService, cleanTransport } from '../manufacturing/production-orders.service';
import { LookupsService } from '../setup/lookups.service';
import { SettingsService } from '../setup/setup.service';
import { LINK, NotificationsService, TEAM, plural } from '../notifications/notifications.service';
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
/** next distributor order number (DO-001): one number for all the product lines of one order */
async function nextGroupRef(em: EntityManager, prefix: string): Promise<string> {
  const rows: { n: string | null }[] = await em.query(
    `SELECT MAX(CAST(SUBSTRING("groupRef" FROM '([0-9]+)$') AS BIGINT)) AS n FROM portal_requests WHERE "groupRef" LIKE $1 AND "groupRef" ~ '^[A-Za-z]+-[0-9]+$'`,
    [`${prefix}-%`],
  );
  return `${prefix}-${String(rows[0]?.n ? Number(rows[0].n) + 1 : 1).padStart(3, '0')}`;
}

@Injectable()
export class PortalService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly orders: OrdersService,
    private readonly collections: CollectionsService,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
    private readonly notes: NotificationsService,
    private readonly production: ProductionOrdersService,
  ) {}

  private distName = async (em: EntityManager, id: string) => (await em.findOne(Distributor, { where: { id } }))?.name ?? 'A distributor';

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
      salesOrdersEnabled: !!s.salesOrdersEnabled,
      requestsNeedApproval: !!s.requestsNeedApproval,
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
    // every payment against each order (advances and collections), oldest first, for the "Paid" column
    const paid = ids.length ? await em.find(Collection, { where: ids.map((id) => ({ orderId: id })), order: { date: 'ASC' } }) : [];
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
        payments: paid.filter((c) => c.orderId === o.id)
          .map((c) => ({ date: c.date, refNo: c.refNo, amount: Number(c.amount), method: c.method, advance: c.isAdvance })),
      };
    });
  }

  /**
   * The distributor's requests and what became of them. Only what the distributor may see: never the manufacturer's
   * rate, advance or the product's cost lines (Zen Foods buys from the manufacturer and sells to the distributor).
   */
  async requestsOf(distributorId: string) {
    const rows = await this.db.manager.find(PortalRequest, {
      where: { distributorId }, relations: ['product', 'order', 'productionOrder', 'productionOrder.manufacturer'],
      order: { date: 'DESC', createdAt: 'DESC' },
    });
    const moved = await movementOf(this.db.manager, rows.map((r) => r.productionOrderId ?? ''));
    const transit = (await this.settings.get()).transitDays;
    return rows.map(({ product, productionOrder: o, order, ...r }) => ({
      ...r,
      product: { id: product.id, sku: product.sku, name: product.name, containerUnit: product.containerUnit ?? null },
      order: order ? { id: order.id, refNo: order.refNo, status: order.status } : null,
      productionOrder: o ? {
        id: o.id, refNo: o.refNo, status: o.status, stage: o.stage, readyDate: o.readyDate, dueDate: o.dueDate, containers: o.containers,
        expectedDate: expectedDate(o.readyDate, transit),
        reason: o.status === 'Rejected' || o.status === 'Cancelled' ? o.reason : null, updatedAt: o.updatedAt,
        shipped: moved[o.id]?.shipped ?? 0, received: moved[o.id]?.received ?? 0,
        manufacturer: { id: o.manufacturer.id, name: o.manufacturer.name },
      } : null,
    }));
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
    const [products, agreed, mfrs] = await Promise.all([
      em.find(Product, { where: { active: true }, relations: ['manufacturer'], order: { sku: 'ASC' } }),
      em.find(DistributorRate, { where: { distributorId } }),
      em.find(Manufacturer, { select: { id: true, name: true } }),
    ]);
    const mfrName = new Map(mfrs.map((m) => [m.id, m.name]));
    return products.map((p) => {
      const a = agreed.find((x) => x.productId === p.id);
      const rate = a ? Number(a.rate) : Number(p.rate);
      const packs = p.packsPerCarton || s.packsPerCarton;
      return {
        productId: p.id, sku: p.sku, name: p.name, mrp: Number(p.mrp), standardRate: Number(p.rate), rate, agreed: !!a,
        /** who makes it: an order goes to this manufacturer (none = it cannot be ordered yet) */
        manufacturerName: p.manufacturer?.name ?? null,
        /** every manufacturer that can make it (names only, never their rates); the order line may pick one */
        madeBy: (p.makers ?? []).map((m) => ({ id: m.manufacturerId, name: mfrName.get(m.manufacturerId) ?? '', isDefault: !!m.isDefault })).filter((m) => m.name),
        /** the saved ways of packing it (the order form picks one; its figures can be changed per order) */
        packagings: (p.packagings ?? []).map((t) => ({
          name: t.name, packetsPerBundle: t.packetsPerBundle, bundlesPerContainer: t.bundlesPerContainer, containerUnit: t.containerUnit ?? p.containerUnit ?? null, isDefault: !!t.isDefault,
        })),
        bundlesPerContainer: p.bundlesPerContainer, containerUnit: p.containerUnit ?? null, packetSize: p.packetSize ?? null,
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
      // consignment sales: verified sales invoices and the payments against them
      ...(await em.query(
        `SELECT date::text AS date, "refNo" AS ref, COALESCE("invoiceNo", '') AS no, amount::float8 AS amount
           FROM distributor_invoices WHERE "distributorId" = $1 AND status = 'Verified'`, [distributorId]))
        .map((r: any): Entry => ({ date: r.date, kind: 'Sales invoice', ref: r.ref, description: r.no ? `Your invoice ${r.no}` : 'Containers sold', debit: round2(r.amount), credit: 0 })),
      ...(await em.query(
        `SELECT p.date::text AS date, p."refNo" AS ref, i."refNo" AS inv, p.amount::float8 AS amount
           FROM distributor_invoice_payments p JOIN distributor_invoices i ON i.id = p."invoiceId" WHERE i."distributorId" = $1`, [distributorId]))
        .map((r: any): Entry => ({ date: r.date, kind: 'Payment', ref: r.ref, description: r.inv, debit: 0, credit: round2(r.amount) })),
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
    const newest = { date: 'DESC', createdAt: 'DESC' } as const;
    const [requests, advices, receipts, audit, recent] = await Promise.all([
      em.find(PortalRequest, { where: { status: 'Requested' }, relations: ['distributor', 'product', 'product.manufacturer'], order: newest }),
      em.find(PaymentAdvice, { where: { status: 'Submitted' }, relations: ['order', 'order.distributor'], order: newest }),
      em.find(CargoReceipt, { where: { status: 'Disputed' }, relations: ['order', 'order.distributor', 'order.product'], order: newest }),
      em.find(AuditLog, { order: { createdAt: 'DESC' }, take: 25 }),
      em.find(PortalRequest, {
        where: { status: Not('Requested') }, relations: ['distributor', 'product', 'productionOrder', 'productionOrder.manufacturer'],
        order: { createdAt: 'DESC' }, take: 40,
      }),
    ]);
    const moved = await movementOf(em, recent.map((r) => r.productionOrderId ?? ''));
    const rateOf = async (r: PortalRequest) => {
      const a = await em.findOne(DistributorRate, { where: { distributorId: r.distributorId, productId: r.productId } });
      return a ? Number(a.rate) : Number(r.product.rate);
    };
    return {
      requests: await Promise.all(requests.map(async (r) => {
        const rate = await rateOf(r);
        // the packing asked for on the order (packets per bundle) when given, else the product's
        return { ...r, rate, value: round2(r.cartons * (r.packetsPerBundle || r.product.packsPerCarton || s.packsPerCarton) * rate) };
      })),
      advices: advices.map(({ proofData, ...rest }) => ({ ...rest, hasProof: !!proofData, distributorName: rest.order.distributor.name })),
      claims: receipts.map((r) => ({ ...this.slimReceipt(r), distributorName: r.order.distributor.name })),
      audit,
      needsApproval: !!s.requestsNeedApproval,
      /** distributor orders already past the desk: Zen Foods watches them with the manufacturer */
      recent: recent.map((r) => ({ r, m: r.productionOrderId ? moved[r.productionOrderId] : undefined })).map(({ r, m }) => ({
        id: r.id, refNo: r.refNo, date: r.date, createdAt: r.createdAt, updatedAt: r.updatedAt, status: r.status, cartons: r.cartons,
        requestedDate: r.requestedDate, reviewNote: r.reviewNote, groupRef: r.groupRef, containers: r.containers,
        distributor: { id: r.distributor.id, name: r.distributor.name },
        product: { id: r.product.id, sku: r.product.sku, name: r.product.name, containerUnit: r.product.containerUnit ?? null },
        productionOrder: r.productionOrder ? {
          id: r.productionOrder.id, refNo: r.productionOrder.refNo, status: r.productionOrder.status, stage: r.productionOrder.stage,
          readyDate: r.productionOrder.readyDate, containers: r.productionOrder.containers, updatedAt: r.productionOrder.updatedAt,
          shipped: m?.shipped ?? 0, received: m?.received ?? 0,
          manufacturer: { id: r.productionOrder.manufacturer.id, name: r.productionOrder.manufacturer.name },
        } : null,
      })),
    };
  }

  // ───────────── requests ─────────────

  /**
   * A distributor orders stock: one or more products in one order. Each product line is its own request (REQ-) and,
   * with no approval step (Settings), its own production order with that product's manufacturer, all under one order
   * number (DO-001). A line orders whole containers packed by a template of the product; the packing figures can be
   * changed for this order only. Planned transport (transporter, vehicle, driver) goes on every line.
   */
  createRequest(dto: CreateRequestDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const distributorId = await this.scope(user, dto.distributorId);
      if (dto.requestedDate && dto.requestedDate < dto.date) throw new BadRequestException('The requested delivery cannot be before the request date.');
      const multi = !!dto.lines?.length;
      const lines: { productId: string; containers?: number; bundles?: number; packaging?: string | null; packetsPerBundle?: number; bundlesPerContainer?: number; containerUnit?: string | null; manufacturerId?: string | null }[] =
        multi ? dto.lines! : dto.productId && dto.cartons ? [{ productId: dto.productId, bundles: dto.cartons }] : [];
      if (!lines.length) throw new BadRequestException('Add at least one product.');
      const products = await em.find(Product, { where: { id: In([...new Set(lines.map((l) => l.productId))]) } });
      const s = await this.settings.get(em);
      const direct = !s.requestsNeedApproval;
      for (const l of lines) {
        const p = products.find((x) => x.id === l.productId);
        if (!p || !p.active) throw new BadRequestException('Choose an active product on every line.');
        if (l.manufacturerId && l.manufacturerId !== p.manufacturerId && !(p.makers ?? []).some((m) => m.manufacturerId === l.manufacturerId)) {
          throw new BadRequestException(`That manufacturer does not make ${p.sku}. Pick one of its manufacturers.`);
        }
        if (direct && !p.manufacturerId && !l.manufacturerId) {
          throw new BadRequestException(`No manufacturer is set up for ${p.name} (${p.sku}) yet, so the order cannot be sent. Ask Zen Foods to assign one.`);
        }
        if (l.packaging && !(p.packagings ?? []).some((t) => t.name === l.packaging)) throw new BadRequestException(`${p.sku} has no packaging template "${l.packaging}".`);
      }
      const autoDo = () => nextGroupRef(em, s.docPrefixes['distOrder'] ?? 'DO');
      const groupRef = !multi ? null : dto.orderNo?.trim() ? await claimRef(em, 'distOrder', dto.orderNo, null, { prefixes: s.docPrefixes, make: autoDo }) : await autoDo();
      const transport = cleanTransport(dto.transport);
      const made: unknown[] = [];
      const filed: { refNo: string; what: string }[] = [];
      const sent: { request: PortalRequest; order: ProductionOrder; what: string }[] = [];
      for (const l of lines) {
        const p = products.find((x) => x.id === l.productId)!;
        const tpl = l.packaging ? (p.packagings ?? []).find((t) => t.name === l.packaging) : (p.packagings ?? []).find((t) => t.isDefault);
        const bundlesPerContainer = l.bundlesPerContainer ?? tpl?.bundlesPerContainer ?? p.bundlesPerContainer ?? 1;
        const packetsPerBundle = l.packetsPerBundle ?? tpl?.packetsPerBundle ?? p.packsPerCarton;
        const containers = l.containers ?? null;
        const cartons = containers ? containers * bundlesPerContainer : l.bundles!;
        const refNo = await nextRef(em, PortalRequest, 'REQ', 3);
        const r = await em.save(em.create(PortalRequest, {
          date: dto.date, distributorId, productId: p.id, cartons, requestedDate: dto.requestedDate ?? null, poRef: dto.poRef ?? null,
          notes: dto.notes ?? null, refNo, status: 'Requested', groupRef, transport,
          containers, packaging: containers ? tpl?.name ?? null : null,
          packetsPerBundle: containers ? packetsPerBundle : null, bundlesPerContainer: containers ? bundlesPerContainer : null,
          containerUnit: l.containerUnit?.trim() || tpl?.containerUnit || p.containerUnit || null,
          manufacturerId: l.manufacturerId && l.manufacturerId !== p.manufacturerId ? l.manufacturerId : null,
        }));
        const what = containers ? `${plural(containers, 'container')} (${plural(cartons, 'bundle')}) of ${p.sku}` : `${plural(cartons, 'bundle')} of ${p.sku}`;
        await this.audit(em, user, 'Request submitted', refNo, `${groupRef ? `${groupRef} · ` : ''}${what}`);
        filed.push({ refNo, what });
        if (direct) {
          const full = await em.findOneOrFail(PortalRequest, { where: { id: r.id }, relations: ['product', 'distributor'] });
          const done = await this.requestToProduction(em, full, { send: true } as AcceptRequestDto, user, true, multi);
          made.push({ ...done.request, productionOrder: done.productionOrder });
          sent.push({ request: full, order: done.productionOrder, what });
        } else {
          made.push(r);
        }
      }
      if (direct && multi) await this.orderSentNotes(em, user, groupRef!, sent);
      if (!direct) {
        // one notice for the whole order, not one per line
        const who = await this.distName(em, distributorId);
        const ref = groupRef ?? filed[0].refNo;
        const list = filed.map((f) => f.what).join(', ');
        await this.notes.send(em, user,
          { to: { staff: TEAM.desk }, kind: 'request.filed', tone: 'warning', refNo: ref, link: LINK.desk,
            title: `${who} asks for ${list}`, body: `Stock request ${filed.map((f) => f.refNo).join(', ')}${dto.poRef ? ` · PO ${dto.poRef}` : ''}. Accept each into an order or reject it.` },
          { to: { distributorId }, kind: 'request.filed', refNo: ref, link: LINK.portal('orders'),
            title: `Request ${ref} sent to Zen Foods`, body: `${list}. You will be told when it is accepted or rejected.` },
        );
      }
      return multi ? { groupRef, requests: made } : made[0];
    });
  }

  /** a combined order went to its manufacturers: one notice per manufacturer to the distributor and to Zen Foods */
  private async orderSentNotes(em: EntityManager, user: PortalUser, groupRef: string, sent: { request: PortalRequest; order: ProductionOrder; what: string }[]) {
    const byMaker = new Map<string, typeof sent>();
    for (const x of sent) byMaker.set(x.order.manufacturerId, [...(byMaker.get(x.order.manufacturerId) ?? []), x]);
    for (const list of byMaker.values()) {
      const maker = list[0].order.manufacturer?.name ?? 'the manufacturer';
      const dist = list[0].request.distributor;
      const what = list.map((x) => x.what).join(', ');
      const refs = list.map((x) => x.order.refNo).join(', ');
      await this.notes.send(em, user,
        { to: { distributorId: dist.id }, kind: 'request.sent', tone: 'success', refNo: groupRef, link: LINK.portal('stock'),
          title: `Order ${groupRef} sent to ${maker}`, body: `${what}. You will be told when it is accepted, ready and dispatched.` },
        { to: { staff: TEAM.desk }, kind: 'request.sent', refNo: groupRef, link: LINK.manufacturing('orders'),
          title: `${dist.name} ordered ${what} from ${maker}`, body: `${groupRef} became ${refs}. No approval needed (Settings): it is with the manufacturer.` },
      );
    }
  }

  /**
   * The approval desk accepts every product of a combined order at once: each becomes its production order with its
   * own packing, sent to its manufacturer; one notice per manufacturer.
   */
  acceptRequestGroup(ids: string[], user: PortalUser) {
    return this.db.transaction(async (em) => {
      const rows = await em.find(PortalRequest, { where: { id: In(ids) }, relations: ['product', 'distributor'], order: { refNo: 'ASC' } });
      if (rows.length !== new Set(ids).size) throw new BadRequestException('A request of this order was not found.');
      if (new Set(rows.map((r) => r.groupRef ?? r.id)).size > 1) throw new BadRequestException('These requests do not belong to one order.');
      for (const r of rows) {
        if (r.status !== 'Requested') throw new BadRequestException(`${r.refNo} is no longer waiting.`);
        if (!r.product.manufacturerId && !r.manufacturerId) throw new BadRequestException(`${r.product.sku} has no manufacturer. Assign one in Settings & Data first.`);
      }
      const sent: { request: PortalRequest; order: ProductionOrder; what: string }[] = [];
      for (const r of rows) {
        const done = await this.requestToProduction(em, r, { send: true } as AcceptRequestDto, user, false, true);
        const what = r.containers ? `${plural(r.containers, 'container')} (${plural(r.cartons, 'bundle')}) of ${r.product.sku}` : `${plural(r.cartons, 'bundle')} of ${r.product.sku}`;
        sent.push({ request: r, order: done.productionOrder, what });
      }
      await this.orderSentNotes(em, user, rows[0].groupRef ?? rows[0].refNo, sent);
      return sent.map((x) => ({ request: x.request.refNo, productionOrder: x.order.refNo }));
    });
  }

  acceptRequest(id: string, dto: AcceptRequestDto, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(PortalRequest, { where: { id }, relations: ['product', 'distributor'] });
      if (!r || r.status !== 'Requested') throw new BadRequestException('This request is no longer waiting.');
      const s = await this.settings.get(em);
      if ((dto.into ?? 'Production') === 'Production') return this.requestToProduction(em, r, dto, user);
      if (!s.salesOrdersEnabled) throw new BadRequestException('Warehouse sales orders are switched off in Settings & Data; accept the request into a production order.');
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
      await this.notes.send(em, user,
        { to: { distributorId: r.distributorId }, kind: 'request.accepted', tone: 'success', refNo: r.refNo, link: LINK.portal('orders'),
          title: `Request ${r.refNo} accepted: order ${refNo}`, body: `${plural(r.cartons, 'bundle')} of ${r.product.sku} at PKR ${rate} a pack.` },
        { to: { staff: TEAM.desk }, kind: 'request.accepted', tone: 'success', refNo: r.refNo, link: LINK.desk,
          title: `Request ${r.refNo} (${r.distributor.name}) accepted into ${refNo}`, body: `By ${user.name}` },
      );
      return { request: r, order };
    });
  }

  /**
   * The request becomes a production order with the product's manufacturer, delivered to this distributor, and is
   * sent to the manufacturer straight away (unless kept as a draft). Bundles are rounded up to whole containers.
   */
  private async requestToProduction(em: EntityManager, r: PortalRequest, dto: AcceptRequestDto, user: PortalUser, direct = false, quiet = false) {
    const templates = r.product.packagings ?? [];
    const packaging = dto.packaging ?? r.packaging ?? null;
    const tpl = packaging ? templates.find((t) => t.name === packaging) : templates.find((t) => t.isDefault);
    // the packing asked for on the order wins over the template (unless staff pick another template when accepting)
    const own = !dto.packaging && !!r.containers;
    const perContainer = (own && r.bundlesPerContainer) || tpl?.bundlesPerContainer || r.product.bundlesPerContainer || 1;
    const containers = dto.containers ?? (own ? r.containers! : Math.max(1, Math.ceil(r.cartons / perContainer)));
    const date = today();
    const dueDate = dto.dueDate !== undefined ? dto.dueDate : r.requestedDate && r.requestedDate >= date ? r.requestedDate : null;
    const send = dto.send ?? true;
    // the distributor's own notes (route, delivery instruction) reach the manufacturer with the order
    const note = [r.groupRef && `Order ${r.groupRef}`, `From stock request ${r.refNo}`, r.poRef && `PO ${r.poRef}`, dto.note?.trim(), r.notes?.trim()].filter(Boolean).join(' · ');
    const o = await this.production.createIn(em, { id: user.id, name: user.name, role: user.role as Role }, {
      date, productId: r.productId, destination: 'Distributor', distributorId: r.distributorId, containers,
      packaging: tpl?.name ?? null, dueDate, notes: note, send,
      ...(own ? { packetsPerBundle: r.packetsPerBundle ?? undefined, bundlesPerContainer: r.bundlesPerContainer ?? undefined } : {}),
      transport: r.transport ?? null,
      containerUnit: (own && r.containerUnit) || undefined,
      ...(r.manufacturerId ? { manufacturerId: r.manufacturerId } : {}),
    }, direct ? `Ordered by ${r.distributor.name} (${r.groupRef ?? r.refNo})` : `From stock request ${r.refNo}`, r.groupRef ?? null);
    const full = await em.findOneOrFail(ProductionOrder, { where: { id: o.id }, relations: ['manufacturer'] });
    r.status = 'Accepted';
    r.productionOrderId = o.id;
    await em.save(r);
    const what = `${plural(containers, 'container')} (${plural(containers * o.bundlesPerContainer, 'bundle')}) of ${r.product.name} (${r.product.sku})`;
    if (direct) {
      await this.audit(em, user, 'Order sent to manufacturer', r.refNo, `${o.refNo} sent to ${full.manufacturer.name}`);
      if (!quiet) await this.notes.send(em, user,
        { to: { distributorId: r.distributorId }, kind: 'request.sent', tone: 'success', refNo: r.refNo, link: LINK.portal('stock'),
          title: `Order ${r.refNo} sent to ${full.manufacturer.name} as ${o.refNo}`,
          body: `${what}. You will be told when the manufacturer accepts it, gives a date, and when it is ready and dispatched.` },
        { to: { staff: TEAM.desk }, kind: 'request.sent', refNo: r.refNo, link: LINK.manufacturing('orders'),
          title: `${r.distributor.name} ordered ${what} from ${full.manufacturer.name}`,
          body: `${r.refNo} became ${o.refNo}. No approval needed (Settings): it is with the manufacturer.` },
      );
      return { request: r, productionOrder: full };
    }
    await this.audit(em, user, 'Request accepted', r.refNo, `Created ${o.refNo}${send ? ` and sent it to ${full.manufacturer.name}` : ' (draft)'}`);
    if (!quiet) await this.notes.send(em, user,
      { to: { distributorId: r.distributorId }, kind: 'request.accepted', tone: 'success', refNo: r.refNo, link: LINK.portal('stock'),
        title: `Request ${r.refNo} accepted: production order ${o.refNo}`,
        body: `${what}${send ? ` ordered from ${full.manufacturer.name}. You will be told when it is accepted, ready and dispatched.` : '. Zen Foods sends it to the manufacturer next.'}` },
      { to: { staff: TEAM.desk }, kind: 'request.accepted', tone: 'success', refNo: r.refNo, link: LINK.manufacturing('orders'),
        title: `Request ${r.refNo} (${r.distributor.name}) accepted into ${o.refNo}`, body: `By ${user.name} · ${what}` },
    );
    return { request: r, productionOrder: full };
  }

  rejectRequest(id: string, note: string, user: PortalUser) {
    return this.db.transaction(async (em) => {
      const r = await em.findOne(PortalRequest, { where: { id }, relations: ['product', 'distributor'] });
      if (!r || r.status !== 'Requested') throw new BadRequestException('This request is no longer waiting.');
      r.status = 'Rejected';
      r.reviewNote = note;
      await em.save(r);
      await this.audit(em, user, 'Request rejected', r.refNo, note);
      await this.notes.send(em, user,
        { to: { distributorId: r.distributorId }, kind: 'request.rejected', tone: 'danger', refNo: r.refNo, link: LINK.portal('orders'),
          title: `Request ${r.refNo} rejected`, body: `${plural(r.cartons, 'bundle')} of ${r.product.sku} · Reason: ${note}` },
        { to: { staff: TEAM.desk }, kind: 'request.rejected', tone: 'danger', refNo: r.refNo, link: LINK.desk,
          title: `Request ${r.refNo} (${r.distributor.name}) rejected`, body: `By ${user.name} · ${note}` },
      );
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
      if (discrepancy) {
        const what = `${dto.damagedCartons} damaged, ${dto.missingCartons} missing of ${o.cartons} bundles on ${o.refNo}`;
        await this.notes.send(em, user,
          { to: { staff: TEAM.desk }, kind: 'claim.filed', tone: 'danger', refNo, link: LINK.desk,
            title: `${o.distributor.name} claims damaged or missing goods on ${o.refNo}`, body: [what, dto.reason].filter(Boolean).join(' · ') },
          { to: { distributorId }, kind: 'claim.filed', refNo, link: LINK.portal('cargo'),
            title: `Claim ${refNo} sent to Zen Foods`, body: what },
        );
      } else {
        await this.notes.send(em, user, { to: { staff: TEAM.desk }, kind: 'delivery.received', tone: 'success', refNo, link: LINK.desk,
          title: `${o.distributor.name} received ${o.refNo} complete` });
      }
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
      await this.notes.send(em, user,
        { to: { distributorId: r.order.distributorId }, kind: 'claim.decided', tone: 'success', refNo: r.refNo, link: LINK.portal('cargo'),
          title: `Claim ${r.refNo} approved: credit note ${refNo}`, body: `PKR ${amount} credited on ${r.order.refNo}${note.refund > 0 ? ` (PKR ${note.refund} owed back to you)` : ''}.` },
        { to: { staff: TEAM.desk }, kind: 'claim.decided', tone: 'success', refNo: r.refNo, link: LINK.desk,
          title: `Claim ${r.refNo} approved (${refNo}, PKR ${amount})`, body: `By ${user.name}` },
      );
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
      await this.notes.send(em, user,
        { to: { distributorId: r.order.distributorId }, kind: 'claim.decided', tone: 'danger', refNo: r.refNo, link: LINK.portal('cargo'),
          title: `Claim ${r.refNo} rejected`, body: `On ${r.order.refNo} · Reason: ${noteText}` },
        { to: { staff: TEAM.desk }, kind: 'claim.decided', tone: 'danger', refNo: r.refNo, link: LINK.desk,
          title: `Claim ${r.refNo} rejected`, body: `By ${user.name} · ${noteText}` },
      );
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
      await this.notes.send(em, user,
        { to: { staff: TEAM.finance }, kind: 'advice.filed', tone: 'warning', refNo, link: LINK.desk,
          title: `${await this.distName(em, distributorId)} reports paying PKR ${dto.amount} on ${order.refNo}`, body: `${a.method}${dto.bankRef ? ` · ref ${dto.bankRef}` : ''}. Verify it before it counts as cash.` },
        { to: { distributorId }, kind: 'advice.filed', refNo, link: LINK.portal('payments'),
          title: `Payment advice ${refNo} sent`, body: `PKR ${dto.amount} on ${order.refNo}; it counts once Zen Foods confirms it.` },
      );
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
      await this.notes.send(em, user,
        { to: { distributorId: a.distributorId }, kind: 'advice.confirmed', tone: 'success', refNo: a.refNo, link: LINK.portal('payments'),
          title: `Payment of PKR ${Number(a.amount)} confirmed`, body: `Advice ${a.refNo} · receipt ${c.refNo}` },
        { to: { staff: TEAM.desk }, kind: 'advice.confirmed', tone: 'success', refNo: a.refNo, link: LINK.desk,
          title: `Payment advice ${a.refNo} confirmed (PKR ${Number(a.amount)})`, body: `By ${user.name} · receipt ${c.refNo}` },
      );
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
      await this.notes.send(em, user,
        { to: { distributorId: a.distributorId }, kind: 'advice.rejected', tone: 'danger', refNo: a.refNo, link: LINK.portal('payments'),
          title: `Payment advice ${a.refNo} rejected`, body: `PKR ${Number(a.amount)} · Reason: ${note}` },
        { to: { staff: TEAM.desk }, kind: 'advice.rejected', tone: 'danger', refNo: a.refNo, link: LINK.desk,
          title: `Payment advice ${a.refNo} rejected`, body: `By ${user.name} · ${note}` },
      );
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
