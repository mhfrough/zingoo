import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Distributor } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { LINK, NotificationsService, TEAM } from '../notifications/notifications.service';
import { LookupsService } from '../setup/lookups.service';
import { DistOrderPayment } from './dist-invoices.entities';
import { DistOrderPayDto } from './dist-invoices.dto';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface OrderUser { name: string; role: string; distributorId?: string | null }

/** one distributor order (DO- number, or the production order number of a single order) and its money */
export interface OrderMoney {
  orderRef: string;
  date: string;
  products: string[];
  containers: number;
  receivedContainers: number;
  /** the goods ordered and the goods received, at the distributor's price */
  orderedValue: number;
  receivedValue: number;
  /** what the distributor owes for this order: the received goods (the ordered goods while nothing arrived) */
  amount: number;
  /** order payments (advance and Pay) plus its share of payments recorded on its sales invoices */
  paid: number;
  balance: number;
  /** the first day goods arrived, the credit days and the due date that follows */
  receivedDate: string | null;
  creditDays: number;
  dueDate: string | null;
  daysSince: number | null;
  overdue: boolean;
  state: 'Acceptance pending' | 'In production' | 'Part received' | 'Received' | 'Cancelled';
}

/**
 * Money on a distributor's orders. The distributor pays on an order (an advance with the order, or Pay later); the
 * money is in the bank at once (Cash & Bank / Customer Advances) and is taken off the order's sales invoices as they
 * are verified (Customer Advances / Accounts Receivable), oldest invoice first. Income still posts when the
 * distributor reports what it sold, so the consignment accounting stays as it is.
 */
@Injectable()
export class DistOrderMoneyService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly lookups: LookupsService,
    private readonly notes: NotificationsService,
  ) {}

  private scope(user: OrderUser, distributorId?: string | null): string {
    if (user.role === 'Distributor') {
      if (!user.distributorId) throw new ForbiddenException('This login is not linked to a distributor.');
      return user.distributorId;
    }
    if (!distributorId) throw new BadRequestException('Choose the distributor.');
    return distributorId;
  }

  // ───────────── reads ─────────────

  /** every order of the distributor with its amount, payments, balance and days since the goods arrived */
  async orders(user: OrderUser, distributorId?: string | null) {
    const id = this.scope(user, distributorId);
    return this.ordersOf(this.db.manager, id);
  }

  async ordersOf(em: EntityManager, distributorId: string): Promise<OrderMoney[]> {
    const d = await em.findOne(Distributor, { where: { id: distributorId } });
    if (!d) throw new NotFoundException('Distributor not found');
    const rows: {
      ref: string; date: string; status: string; sku: string; name: string; containers: number; packets: number; rate: number;
      receivedContainers: number; receivedPackets: number; receivedDate: string | null;
    }[] = await em.query(
      `SELECT COALESCE(o."groupRef", o."refNo") AS ref, o.date::text AS date, o.status, p.sku, p.name,
              o.containers, o.containers * o."bundlesPerContainer" * o."packetsPerBundle" AS packets,
              COALESCE(r.rate, p.rate)::float8 AS rate,
              COALESCE(SUM(s."receivedContainers") FILTER (WHERE s.status = 'Received'), 0)::int AS "receivedContainers",
              COALESCE(SUM(s."receivedContainers" * s."bundlesPerContainer" * s."packetsPerBundle") FILTER (WHERE s.status = 'Received'), 0)::float8 AS "receivedPackets",
              MIN(s."receivedDate") FILTER (WHERE s.status = 'Received')::text AS "receivedDate"
         FROM production_orders o
         JOIN products p ON p.id = o."productId"
         LEFT JOIN distributor_rates r ON r."distributorId" = o."distributorId" AND r."productId" = o."productId"
         LEFT JOIN production_shipments s ON s."orderId" = o.id
        WHERE o."distributorId" = $1 AND o.status NOT IN ('Draft', 'Rejected')
        GROUP BY o.id, p.id, r.rate
        ORDER BY o.date DESC, o."refNo" DESC`, [distributorId]);
    const { pools, diShare } = await this.money(em, distributorId);
    const byRef = new Map<string, typeof rows>();
    for (const r of rows) byRef.set(r.ref, [...(byRef.get(r.ref) ?? []), r]);
    const out: OrderMoney[] = [];
    for (const [ref, lines] of byRef) {
      const live = lines.filter((l) => l.status !== 'Cancelled');
      const orderedValue = round2(live.reduce((n, l) => n + Number(l.packets) * Number(l.rate), 0));
      const receivedValue = round2(lines.reduce((n, l) => n + Number(l.receivedPackets) * Number(l.rate), 0));
      const containers = live.reduce((n, l) => n + Number(l.containers), 0);
      const receivedContainers = lines.reduce((n, l) => n + Number(l.receivedContainers), 0);
      const receivedDate = lines.map((l) => l.receivedDate).filter((x): x is string => !!x).sort()[0] ?? null;
      const amount = receivedContainers > 0 ? receivedValue : orderedValue;
      const paid = round2((pools[ref] ?? 0) + (diShare[ref] ?? 0));
      const balance = round2(Math.max(0, amount - paid));
      const creditDays = Number(d.paymentDays ?? 30);
      const dueDate = receivedDate ? addDays(receivedDate, creditDays) : null;
      const state: OrderMoney['state'] = !live.length ? 'Cancelled'
        : receivedContainers >= containers && containers > 0 ? 'Received'
          : receivedContainers > 0 ? 'Part received'
            : live.every((l) => l.status === 'Sent') ? 'Acceptance pending' : 'In production';
      out.push({
        orderRef: ref, date: lines.map((l) => l.date).sort()[0], products: [...new Set(lines.map((l) => `${l.name} · ${l.sku}`))],
        containers, receivedContainers, orderedValue, receivedValue, amount, paid, balance,
        receivedDate, creditDays, dueDate, daysSince: receivedDate ? daysBetween(receivedDate, today()) : null,
        overdue: balance > 0.01 && !!dueDate && dueDate < today(), state,
      });
    }
    return out;
  }

  /** one order's payments in date order with the balance after each (the Details view) */
  async ledger(user: OrderUser, orderRef: string, distributorId?: string | null) {
    const id = this.scope(user, distributorId);
    const em = this.db.manager;
    const order = (await this.ordersOf(em, id)).find((o) => o.orderRef === orderRef);
    if (!order) throw new NotFoundException('Order not found');
    const pays = await em.find(DistOrderPayment, { where: { distributorId: id, orderRef }, order: { date: 'ASC', refNo: 'ASC' } });
    // payments recorded on the order's sales invoices, its share of each
    const diPays: { refNo: string; date: string; method: string; reference: string | null; invoice: string; share: number }[] = await em.query(
      `SELECT p."refNo", p.date::text AS date, p.method, p.reference, i."refNo" AS invoice,
              (p.amount * x.part / NULLIF(i.amount, 0))::float8 AS share
         FROM distributor_invoice_payments p
         JOIN distributor_invoices i ON i.id = p."invoiceId"
         JOIN (SELECT l."invoiceId", SUM(l.amount) AS part FROM distributor_invoice_lines l
                 JOIN production_shipments s ON s.id = l."shipmentId" JOIN production_orders o ON o.id = s."orderId"
                WHERE COALESCE(o."groupRef", o."refNo") = $2 GROUP BY l."invoiceId") x ON x."invoiceId" = i.id
        WHERE i."distributorId" = $1 AND i.status = 'Verified'`, [id, orderRef]);
    const entries = [
      ...pays.map((p) => ({
        id: p.id, date: p.date, refNo: p.refNo, kind: p.kind === 'Advance' ? 'Advance with the order' : 'Payment', method: p.method,
        reference: p.reference, amount: p.status === 'Reversed' ? 0 : Number(p.amount), status: p.status, proofId: p.proofId, proofName: p.proofName, by: p.recordedBy,
      })),
      ...diPays.map((p) => ({
        id: null, date: p.date, refNo: p.refNo, kind: `Paid on sales invoice ${p.invoice}`, method: p.method, reference: p.reference,
        amount: round2(Number(p.share)), status: 'Active', proofId: null, proofName: null, by: null,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.refNo.localeCompare(b.refNo));
    let left = order.amount;
    return { order, entries: entries.map((e) => ({ ...e, balance: (left = round2(left - e.amount)) })) };
  }

  // ───────────── money in ─────────────

  /** the distributor (or staff for it) pays on an order: it counts at once */
  async pay(user: OrderUser, dto: DistOrderPayDto) {
    return this.db.transaction(async (em) => {
      const id = this.scope(user, dto.distributorId);
      const order = (await this.ordersOf(em, id)).find((o) => o.orderRef === dto.orderRef);
      if (!order || order.state === 'Cancelled') throw new BadRequestException('Choose one of your open orders.');
      const room = round2(Math.max(order.orderedValue, order.receivedValue) - order.paid);
      if (room <= 0.001) throw new BadRequestException(`${dto.orderRef} is paid in full.`);
      if (dto.amount > room + 0.001) throw new BadRequestException(`Enter at most PKR ${room.toLocaleString('en-US')}, what is still open on ${dto.orderRef}.`);
      return this.record(em, user, id, { ...dto, kind: 'Payment' });
    });
  }

  /** an advance paid with a new order (called when the order is placed) */
  async recordAdvance(em: EntityManager, user: OrderUser, distributorId: string, orderRef: string,
    a: { amount: number; method: string; date: string; reference?: string | null; proofId: string; proofName: string }) {
    return this.record(em, user, distributorId, { orderRef, ...a, kind: 'Advance' }, true);
  }

  private async record(em: EntityManager, user: OrderUser, distributorId: string,
    dto: { orderRef: string; amount: number; method: string; date: string; reference?: string | null; proofId: string; proofName?: string; kind: 'Advance' | 'Payment' },
    proofChecked = false) {
    if (dto.date > today()) throw new BadRequestException('A payment cannot be dated in the future.');
    await this.lookups.assertActive('PAY_METHOD', dto.method, em);
    let proofName = dto.proofName ?? '';
    if (!proofChecked) {
      const [f]: { name: string; ownerId: string | null }[] = await em.query(`SELECT name, "ownerId" FROM attachments WHERE id = $1`, [dto.proofId]);
      if (!f) throw new BadRequestException('Upload the proof of payment again.');
      if (f.ownerId) throw new BadRequestException('That proof is already on another record. Upload it again.');
      proofName = f.name;
    }
    const refNo = await nextRef(em, DistOrderPayment, 'DOP', 3);
    const p = await em.save(em.create(DistOrderPayment, {
      refNo, date: dto.date, distributorId, orderRef: dto.orderRef, amount: round2(dto.amount), method: dto.method,
      reference: dto.reference?.trim() || null, proofId: dto.proofId, proofName, kind: dto.kind, status: 'Active', recordedBy: user.name,
    }));
    if (!proofChecked) await em.query(`UPDATE attachments SET "ownerType" = 'DIST_ORDER_PAY', "ownerId" = $2 WHERE id = $1`, [dto.proofId, p.id]);
    await this.posting.syncDistOrderPayment(em, p.id);
    await this.syncApplied(em, distributorId);
    const d = await em.findOne(Distributor, { where: { id: distributorId } });
    const pk = `PKR ${round2(dto.amount).toLocaleString('en-US')}`;
    await this.notes.send(em, user,
      { to: { staff: TEAM.finance }, kind: 'order-payment.made', tone: 'success', refNo, link: LINK.desk,
        title: `${d?.name ?? 'A distributor'} paid ${pk} on ${dto.orderRef}`,
        body: `${dto.kind === 'Advance' ? 'Advance with the order' : 'Payment'} ${refNo} · ${dto.method}${dto.reference ? ` · ref ${dto.reference}` : ''}. Proof: ${proofName}. Check it against the bank; reverse it if it did not arrive.` },
      { to: { distributorId }, kind: 'order-payment.made', tone: 'success', refNo, link: LINK.portal('dashboard'),
        title: `${pk} recorded on ${dto.orderRef}`, body: `${refNo} · ${dto.method}` },
    );
    return p;
  }

  /** staff take back a payment that did not arrive: its money and what it paid off come off again */
  async reverse(user: OrderUser, id: string, reason: string) {
    return this.db.transaction(async (em) => {
      const p = await em.findOne(DistOrderPayment, { where: { id } });
      if (!p) throw new NotFoundException('Payment not found');
      if (p.status === 'Reversed') throw new BadRequestException(`${p.refNo} is already reversed.`);
      if (!reason?.trim()) throw new BadRequestException('Say why it is reversed.');
      p.status = 'Reversed';
      p.reason = reason.trim();
      p.reversedBy = user.name;
      await em.save(p);
      await this.posting.syncDistOrderPayment(em, p.id);
      await this.syncApplied(em, p.distributorId);
      await this.notes.send(em, user,
        { to: { distributorId: p.distributorId }, kind: 'order-payment.reversed', tone: 'danger', refNo: p.refNo, link: LINK.portal('dashboard'),
          title: `Payment ${p.refNo} on ${p.orderRef} was reversed`, body: `Reason: ${p.reason}` },
      );
      return p;
    });
  }

  // ───────────── applying the money to the sales invoices ─────────────

  /**
   * What the order payments pay off on each verified sales invoice. Each order's money goes to its own invoice
   * lines, oldest invoice first, never more than a line still owes after the payments recorded on its invoice.
   * Also: each order's share of the payments recorded on its sales invoices.
   */
  async money(em: EntityManager, distributorId: string) {
    const [poolRows, lines]: [{ orderRef: string; v: number }[], { invoiceId: string; amount: number; diAmount: number; diPaid: number; ref: string }[]] = await Promise.all([
      em.query(`SELECT "orderRef", SUM(amount)::float8 AS v FROM dist_order_payments WHERE "distributorId" = $1 AND status = 'Active' GROUP BY "orderRef"`, [distributorId]),
      em.query(
        `SELECT l."invoiceId", l.amount::float8 AS amount, i.amount::float8 AS "diAmount",
                COALESCE((SELECT SUM(p.amount) FROM distributor_invoice_payments p WHERE p."invoiceId" = i.id), 0)::float8 AS "diPaid",
                COALESCE(o."groupRef", o."refNo") AS ref
           FROM distributor_invoice_lines l
           JOIN distributor_invoices i ON i.id = l."invoiceId"
           JOIN production_shipments s ON s.id = l."shipmentId"
           JOIN production_orders o ON o.id = s."orderId"
          WHERE i."distributorId" = $1 AND i.status = 'Verified'
          ORDER BY i.date, i."refNo", l.id`, [distributorId]),
    ]);
    const pools: Record<string, number> = Object.fromEntries(poolRows.map((r) => [r.orderRef, round2(Number(r.v))]));
    const left = { ...pools };
    const byInvoice: Record<string, number> = {};
    const diShare: Record<string, number> = {};
    for (const l of lines) {
      const share = Number(l.diAmount) > 0 ? Number(l.amount) / Number(l.diAmount) : 0;
      diShare[l.ref] = round2((diShare[l.ref] ?? 0) + Number(l.diPaid) * share);
      const lineDue = Math.max(0, Number(l.amount) - Number(l.diPaid) * share);
      const take = Math.min(left[l.ref] ?? 0, lineDue);
      if (take > 0) {
        left[l.ref] = round2((left[l.ref] ?? 0) - take);
        byInvoice[l.invoiceId] = round2((byInvoice[l.invoiceId] ?? 0) + take);
      }
    }
    return { pools, byInvoice, diShare };
  }

  /** rewrites what the order payments pay off on each of the distributor's verified sales invoices */
  async syncApplied(em: EntityManager, distributorId: string) {
    const { byInvoice } = await this.money(em, distributorId);
    const invoices: { id: string; refNo: string; date: string }[] = await em.query(
      `SELECT id, "refNo", date::text AS date FROM distributor_invoices WHERE "distributorId" = $1`, [distributorId]);
    const d = await em.findOne(Distributor, { where: { id: distributorId } });
    for (const i of invoices) await this.posting.syncDistOrderApply(em, i.id, i.refNo, i.date, d?.name ?? '', byInvoice[i.id] ?? 0);
  }
}
