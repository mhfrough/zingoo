import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Manufacturer } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { Approval } from '../finance/finance.entities';
import { Signer, canSign } from '../finance/finance.service';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { SettingsService } from '../setup/setup.service';
import { CreatePaymentRequestDto, PayRequestDto } from './payment-requests.dto';
import { MfrPaymentRequest, MfrRequestPayment } from './payment-requests.entities';
import { ProductionOrder } from './production-orders.entities';
import { OrderUser } from './production-orders.service';

const today = () => new Date().toISOString().slice(0, 10);

/** a request with its approval and payment worked out */
export type ShapedRequest = Awaited<ReturnType<PaymentRequestsService['shapeAll']>>[number];

/**
 * Manufacturer payment requests (payment invoices): the advance of an accepted order (its advance %), or the balance.
 * The manufacturer raises them from its portal (staff may raise one for it), the company approves them with one
 * signature, or two at or above the approval threshold, then pays them, fully or in parts, from a company account.
 * A payment posts Advance to Manufacturer / Cash & Bank: until the goods are delivered, money paid to the
 * manufacturer is a prepayment, not a cost.
 */
@Injectable()
export class PaymentRequestsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
  ) {}

  // ───────────── reads ─────────────

  /** staff see every request (or one manufacturer's); a manufacturer sees its own */
  async list(user: OrderUser, manufacturerId?: string) {
    const scope = user.role === 'Manufacturer' ? this.ownId(user) : manufacturerId;
    const rows = await this.db.manager.find(MfrPaymentRequest, {
      where: scope ? { manufacturerId: scope } : {}, relations: ['order', 'order.product', 'manufacturer'], order: { date: 'DESC', refNo: 'DESC' },
    });
    return this.shapeAll(this.db.manager, rows);
  }

  /**
   * What the company owes each manufacturer, order by order: order value and advance, how much was asked for,
   * approved and paid, and what is left to pay.
   */
  async position(user: OrderUser, manufacturerId?: string) {
    const em = this.db.manager;
    const scope = user.role === 'Manufacturer' ? this.ownId(user) : manufacturerId;
    const orders = await em.find(ProductionOrder, {
      where: { status: In(['Accepted', 'Cancelled']), ...(scope ? { manufacturerId: scope } : {}) },
      relations: ['product', 'manufacturer'], order: { date: 'DESC', refNo: 'DESC' },
    });
    const requests = await this.list(user, scope);
    const rows = orders.map((o) => {
      const value = round2(o.containers * o.bundlesPerContainer * o.packetsPerBundle * Number(o.rate));
      const advance = round2((value * Number(o.advancePct)) / 100);
      const mine = requests.filter((r) => r.orderId === o.id && r.status === 'Submitted');
      const sum = (list: ShapedRequest[], f: (r: ShapedRequest) => number) => round2(list.reduce((n, r) => n + f(r), 0));
      const paid = sum(mine, (r) => r.paid);
      return {
        orderId: o.id, refNo: o.refNo, status: o.status, sku: o.product.sku, manufacturer: o.manufacturer.name,
        value, advancePct: Number(o.advancePct), advance,
        requested: sum(mine, (r) => r.amount),
        advanceRequested: sum(mine.filter((r) => r.kind === 'Advance'), (r) => r.amount),
        approved: sum(mine.filter((r) => r.approved), (r) => r.amount),
        paid,
        advancePaid: sum(mine.filter((r) => r.kind === 'Advance'), (r) => r.paid),
        toPay: round2(Math.max(0, value - paid)),
      };
    }).filter((r) => r.status === 'Accepted' || r.paid > 0); // a cancelled order stays only while money went out on it
    const total = (k: 'value' | 'advance' | 'requested' | 'approved' | 'paid' | 'toPay') => round2(rows.reduce((n, r) => n + r[k], 0));
    return {
      rows,
      totals: { value: total('value'), advance: total('advance'), requested: total('requested'), approved: total('approved'), paid: total('paid'), toPay: total('toPay') },
    };
  }

  // ───────────── manufacturer side (staff may act for it) ─────────────

  async create(user: OrderUser, dto: CreatePaymentRequestDto) {
    return this.db.transaction(async (em) => {
      const order = await em.findOne(ProductionOrder, { where: { id: dto.orderId }, relations: ['product'] });
      if (!order) throw new NotFoundException('Production order not found');
      if (user.role === 'Manufacturer' && order.manufacturerId !== this.ownId(user)) throw new ForbiddenException('This order belongs to another manufacturer.');
      if (order.status !== 'Accepted') throw new BadRequestException(`${order.refNo} is ${order.status.toLowerCase()}: payment can only be asked for on an accepted order.`);
      const date = dto.date ?? today();
      if (date > today()) throw new BadRequestException('A request cannot be dated in the future.');

      const value = round2(order.containers * order.bundlesPerContainer * order.packetsPerBundle * Number(order.rate));
      const advance = round2((value * Number(order.advancePct)) / 100);
      const open = await em.find(MfrPaymentRequest, { where: { orderId: order.id, status: 'Submitted' } });
      const asked = (kind?: string) => round2(open.filter((r) => !kind || r.kind === kind).reduce((n, r) => n + Number(r.amount), 0));
      const cap = dto.kind === 'Advance'
        ? round2(Math.min(advance - asked('Advance'), value - asked()))
        : round2(value - asked());
      if (cap <= 0) {
        throw new BadRequestException(dto.kind === 'Advance'
          ? (advance <= 0 ? `${order.refNo} has no advance (0%).` : `The whole advance of ${order.refNo} was already asked for.`)
          : `The whole value of ${order.refNo} was already asked for.`);
      }
      const amount = round2(dto.amount ?? cap);
      if (amount > cap + 0.001) throw new BadRequestException(`At most PKR ${cap} can still be asked for as ${dto.kind.toLowerCase()} on ${order.refNo}.`);

      const m = await em.findOne(Manufacturer, { where: { id: order.manufacturerId } });
      const banks = m?.bankAccounts ?? [];
      if (!banks.length) throw new BadRequestException('No bank account on file. Ask Zen Foods to add one to the manufacturer.');
      const chosen = dto.bankAccount ? banks.find((b) => b.account === dto.bankAccount!.replace(/\s+/g, '').toUpperCase()) : banks.find((b) => b.isDefault) ?? banks[0];
      if (!chosen) throw new BadRequestException('Choose one of the bank accounts on file.');

      const s = await this.settings.get(em);
      const refNo = await nextRef(em, MfrPaymentRequest, s.docPrefixes['mfrRequest'] ?? 'PR', 3);
      const r = await em.save(em.create(MfrPaymentRequest, {
        refNo, date, orderId: order.id, manufacturerId: order.manufacturerId, kind: dto.kind, amount,
        invoiceNo: dto.invoiceNo?.trim() || null, note: dto.note?.trim() || null, status: 'Submitted',
        bank: { bank: chosen.bank, title: chosen.title, account: chosen.account, ...(chosen.branch ? { branch: chosen.branch } : {}) },
        raisedBy: user.name,
      }));
      return this.one(em, r.id);
    });
  }

  /** the manufacturer takes a request back before anyone signed it */
  async withdraw(user: OrderUser, id: string) {
    return this.db.transaction(async (em) => {
      const r = await this.load(em, id);
      if (user.role === 'Manufacturer' && r.manufacturerId !== this.ownId(user)) throw new ForbiddenException('This request belongs to another manufacturer.');
      if (r.status !== 'Submitted') throw new BadRequestException(`${r.refNo} is already ${r.status.toLowerCase()}.`);
      if ((await this.posting.signatures(em, 'MFR_REQUEST', id)).length) throw new BadRequestException(`${r.refNo} is already signed; ask Zen Foods to reject it instead.`);
      r.status = 'Withdrawn';
      await em.save(r);
      return this.one(em, id);
    });
  }

  // ───────────── company side ─────────────

  sign(id: string, seat: 'A' | 'B', user: Signer) {
    return this.db.transaction(async (em) => {
      const r = await this.load(em, id);
      if (r.status !== 'Submitted') throw new BadRequestException(`${r.refNo} is ${r.status.toLowerCase()}.`);
      const [shaped] = await this.shapeAll(em, [r]);
      if (shaped.approved) throw new BadRequestException('Nothing is waiting for a signature.');
      if (!canSign(user, seat)) throw new ForbiddenException(`Your account cannot sign as seat ${seat}.`);
      if (shaped.signatures.includes(seat)) throw new BadRequestException(`Seat ${seat} has already signed.`);
      await em.save(em.create(Approval, { docType: 'MFR_REQUEST', docId: id, seat, userId: user.id ?? null }));
      return this.one(em, id);
    });
  }

  async reject(id: string, reason: string) {
    return this.db.transaction(async (em) => {
      const r = await this.load(em, id);
      if (r.status !== 'Submitted') throw new BadRequestException(`${r.refNo} is already ${r.status.toLowerCase()}.`);
      const [shaped] = await this.shapeAll(em, [r]);
      if (shaped.approved) throw new BadRequestException(`${r.refNo} is already approved and can no longer be rejected.`);
      r.status = 'Rejected';
      r.reason = reason.trim();
      await em.save(r);
      return this.one(em, id);
    });
  }

  async pay(id: string, dto: PayRequestDto) {
    return this.db.transaction(async (em) => {
      const r = await this.load(em, id);
      if (r.status !== 'Submitted') throw new BadRequestException(`${r.refNo} is ${r.status.toLowerCase()}.`);
      const [shaped] = await this.shapeAll(em, [r]);
      if (!shaped.approved) throw new BadRequestException(`Approve ${r.refNo} before paying it (${shaped.signatures.length}/${shaped.requiredSignatures} signatures).`);
      if (shaped.due <= 0) throw new BadRequestException(`${r.refNo} is already paid.`);
      if (dto.amount > shaped.due + 0.001) throw new BadRequestException(`Enter at most PKR ${shaped.due}, what is still due on ${r.refNo}.`);
      if (dto.date > today()) throw new BadRequestException('A payment cannot be dated in the future.');
      if (dto.date < r.date) throw new BadRequestException('A payment cannot be dated before its request.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.fromAccount) await this.lookups.assertActive('BANK_ACCOUNT', dto.fromAccount, em);
      const s = await this.settings.get(em);
      const refNo = await nextRef(em, MfrRequestPayment, s.docPrefixes['mfrPayment'] ?? 'MPY', 3);
      const p = await em.save(em.create(MfrRequestPayment, {
        refNo, date: dto.date, requestId: id, amount: round2(dto.amount), method: dto.method,
        fromAccount: dto.fromAccount ?? null, reference: dto.reference?.trim() || null, note: dto.note?.trim() || null,
      }));
      await this.posting.syncMfrRequestPayment(em, p.id);
      await this.posting.syncOrderAdvance(em, r.orderId);
      return this.one(em, id);
    });
  }

  // ───────────── helpers ─────────────

  private ownId(user: OrderUser): string {
    if (!user.manufacturerId) throw new ForbiddenException('This login is not linked to a manufacturer.');
    return user.manufacturerId;
  }

  private async load(em: EntityManager, id: string) {
    const r = await em.findOne(MfrPaymentRequest, { where: { id } });
    if (!r) throw new NotFoundException('Payment request not found');
    return r;
  }

  private async one(em: EntityManager, id: string) {
    const r = await em.findOne(MfrPaymentRequest, { where: { id }, relations: ['order', 'order.product', 'manufacturer'] });
    return (await this.shapeAll(em, [r!]))[0];
  }

  /** each request with its signatures, approval, payments, what is still due and a status in words */
  async shapeAll(em: EntityManager, rows: MfrPaymentRequest[]) {
    const s = await this.settings.get(em);
    const ids = rows.map((r) => r.id);
    const [signs, pays] = ids.length
      ? await Promise.all([
        em.find(Approval, { where: { docType: 'MFR_REQUEST', docId: In(ids) }, order: { seat: 'ASC' } }),
        em.find(MfrRequestPayment, { where: { requestId: In(ids) }, order: { date: 'ASC', refNo: 'ASC' } }),
      ])
      : [[], []];
    return rows.map((r) => {
      const signatures = signs.filter((a) => a.docId === r.id).map((a) => a.seat);
      const requiredSignatures = this.posting.required(r.amount, s);
      const approved = r.status === 'Submitted' && signatures.length >= requiredSignatures;
      const payments = pays.filter((p) => p.requestId === r.id);
      const paid = round2(payments.reduce((n, p) => n + Number(p.amount), 0));
      const due = approved ? round2(Number(r.amount) - paid) : 0;
      const state = r.status !== 'Submitted' ? r.status
        : !approved ? `Waiting approval (${signatures.length}/${requiredSignatures})`
          : paid <= 0 ? 'Approved' : paid < Number(r.amount) - 0.001 ? 'Part paid' : 'Paid';
      return { ...r, signatures, requiredSignatures, approved, payments, paid, due, state };
    });
  }
}
