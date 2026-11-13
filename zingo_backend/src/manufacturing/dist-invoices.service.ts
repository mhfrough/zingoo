import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { SettingsService } from '../setup/setup.service';
import { Actor, LINK, NotificationsService, TEAM } from '../notifications/notifications.service';
import { CreateDistInvoiceDto, DistInvoicePayDto } from './dist-invoices.dto';
import { DistributorInvoice, DistributorInvoiceLine, DistributorInvoicePayment } from './dist-invoices.entities';
import { ShipmentUser } from './shipments.service';
import { ProductionShipment } from './shipments.entities';
import { creditsByShipment } from './delivery-claims.service';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Distributor sales invoices. The distributor reports the containers it distributed, delivery by delivery; the
 * containers stop counting as stock with it at once. The company verifies the invoice: income (distributor rate)
 * and the receivable post, and the goods leave Inventory at Distributor at the manufacturer's rate. Then the
 * company records the distributor's payments against it.
 */
@Injectable()
export class DistInvoicesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
    private readonly notes: NotificationsService,
  ) {}

  /** tells the distributor and the Zen Foods desk about an invoice step */
  private async tell(em: EntityManager, actor: Actor | null, inv: DistributorInvoice, kind: string, tone: 'info' | 'success' | 'warning' | 'danger', mine: string, staff: string, body: string | null) {
    await this.notes.send(em, actor,
      { to: { distributorId: inv.distributorId }, kind, tone, refNo: inv.refNo, link: LINK.portal('stock'), title: mine, body },
      { to: { staff: TEAM.desk }, kind, tone, refNo: inv.refNo, link: LINK.distribution('sales'), title: staff, body },
    );
  }

  /** a distributor sees its own invoices, staff everything (or one distributor's) */
  async list(user: ShipmentUser, distributorId?: string) {
    const scope = user.role === 'Distributor' ? this.own(user) : distributorId;
    const rows = await this.db.manager.find(DistributorInvoice, {
      where: scope ? { distributorId: scope } : {},
      relations: ['distributor', 'lines', 'lines.product', 'lines.shipment'],
      order: { date: 'DESC', refNo: 'DESC' },
    });
    return this.shapeAll(this.db.manager, rows);
  }

  async create(user: ShipmentUser, dto: CreateDistInvoiceDto) {
    return this.db.transaction(async (em) => {
      const distributorId = user.role === 'Distributor' ? this.own(user) : dto.distributorId;
      if (!distributorId) throw new BadRequestException('Choose the distributor.');
      const d = await em.findOne(Distributor, { where: { id: distributorId } });
      if (!d) throw new BadRequestException('Choose a distributor from Settings & Data.');
      if (dto.date > today()) throw new BadRequestException('An invoice cannot be dated in the future.');
      const ids = dto.lines.map((l) => l.shipmentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Put each delivery on one line only.');
      const lots = await em.find(ProductionShipment, { where: { id: In(ids) } });
      const sold = await this.soldMap(em, ids);
      // an accepted credit claim lowers the cost of what is still in stock: spread over the packets not yet sold
      const credits = await creditsByShipment(em, ids);
      const usedRows: { shipmentId: string; v: number }[] = await em.query(
        `SELECT l."shipmentId", SUM(l.packets * (s.rate - l."costRate"))::float8 AS v FROM distributor_invoice_lines l
           JOIN distributor_invoices i ON i.id = l."invoiceId" JOIN production_shipments s ON s.id = l."shipmentId"
          WHERE i.status <> 'Rejected' AND l."shipmentId" = ANY($1) GROUP BY l."shipmentId"`, [ids]);
      const used = Object.fromEntries(usedRows.map((r) => [r.shipmentId, Number(r.v)]));
      const lines: Partial<DistributorInvoiceLine>[] = [];
      for (const l of dto.lines) {
        const lot = lots.find((x) => x.id === l.shipmentId);
        if (!lot || lot.distributorId !== distributorId || lot.destination !== 'Distributor') throw new BadRequestException('A delivery on this invoice is not with this distributor.');
        if (lot.status !== 'Received') throw new BadRequestException(`${lot.refNo} has not been received yet.`);
        if (dto.date < lot.receivedDate!) throw new BadRequestException(`${lot.refNo} arrived on ${lot.receivedDate}; the invoice cannot be dated before that.`);
        const left = (lot.receivedContainers ?? 0) - (sold[lot.id] ?? 0);
        if (l.containers > left) throw new BadRequestException(`Only ${left} container${left === 1 ? '' : 's'} of ${lot.refNo} ${left === 1 ? 'is' : 'are'} still in stock.`);
        const packets = l.containers * lot.bundlesPerContainer * lot.packetsPerBundle;
        const rate = await this.saleRate(em, distributorId, lot.productId);
        const creditLeft = Math.max(0, (credits[lot.id] ?? 0) - (used[lot.id] ?? 0));
        const leftPackets = left * lot.bundlesPerContainer * lot.packetsPerBundle;
        const costRate = creditLeft > 0 && leftPackets > 0 ? Math.max(0, Number(lot.rate) - creditLeft / leftPackets) : Number(lot.rate);
        lines.push({
          shipmentId: lot.id, productId: lot.productId, containers: l.containers, packets, rate,
          costRate: Math.round(costRate * 10000) / 10000, amount: round2(packets * rate),
        });
      }
      const amount = round2(lines.reduce((n, l) => n + Number(l.amount), 0));
      const cost = round2(lines.reduce((n, l) => n + l.packets! * Number(l.costRate), 0));
      const s = await this.settings.get(em);
      const refNo = await nextRef(em, DistributorInvoice, s.docPrefixes['distInvoice'] ?? 'DI', 3);
      const inv = await em.save(em.create(DistributorInvoice, {
        refNo, date: dto.date, distributorId, invoiceNo: dto.invoiceNo?.trim() || null, note: dto.note?.trim() || null,
        amount, cost, dueDate: d.paymentDays === 0 ? null : addDays(dto.date, d.paymentDays ?? 30), status: 'Submitted', submittedBy: user.name,
        lines: lines as DistributorInvoiceLine[],
      }));
      const pk = `PKR ${amount.toLocaleString('en-US')}`;
      const boxes = lines.reduce((n, l) => n + (l.containers ?? 0), 0);
      await this.tell(em, user, inv, 'sales-invoice.filed', 'warning', `Sales invoice ${refNo} sent to Zen Foods`,
        `${d.name} reports selling ${boxes} container${boxes === 1 ? '' : 's'}: invoice ${refNo} (${pk}) to verify`, `${pk}${dto.invoiceNo ? ` · their no. ${dto.invoiceNo}` : ''}`);
      return this.one(em, inv.id);
    });
  }

  /** the company accepts the invoice: income, receivable and cost of goods post */
  async verify(user: ShipmentUser, id: string) {
    return this.db.transaction(async (em) => {
      const inv = await this.load(em, id);
      if (inv.status !== 'Submitted') throw new BadRequestException(`${inv.refNo} is already ${inv.status.toLowerCase()}.`);
      inv.status = 'Verified';
      inv.verifiedBy = user.name;
      await em.save(inv);
      await this.posting.syncDistInvoice(em, id);
      await this.tell(em, user, inv, 'sales-invoice.verified', 'success', `Sales invoice ${inv.refNo} verified`, `Sales invoice ${inv.refNo} verified`,
        `PKR ${Number(inv.amount).toLocaleString('en-US')}${inv.dueDate ? ` · due ${inv.dueDate}` : ''}`);
      return this.one(em, id);
    });
  }

  /** the company refuses it; its containers count as stock with the distributor again */
  async reject(id: string, reason: string, user?: Actor) {
    return this.db.transaction(async (em) => {
      const inv = await this.load(em, id);
      if (inv.status !== 'Submitted') throw new BadRequestException(`${inv.refNo} is already ${inv.status.toLowerCase()}.`);
      inv.status = 'Rejected';
      inv.reason = reason.trim();
      await em.save(inv);
      await this.tell(em, user ?? null, inv, 'sales-invoice.rejected', 'danger', `Sales invoice ${inv.refNo} rejected`, `Sales invoice ${inv.refNo} rejected`,
        `Reason: ${inv.reason}. Its containers count as your stock again.`);
      return this.one(em, id);
    });
  }

  async pay(id: string, dto: DistInvoicePayDto, user?: Actor) {
    return this.db.transaction(async (em) => {
      const inv = await this.load(em, id);
      if (inv.status !== 'Verified') throw new BadRequestException(`Verify ${inv.refNo} before recording a payment.`);
      const [shaped] = await this.shapeAll(em, [inv]);
      if (shaped.due <= 0) throw new BadRequestException(`${inv.refNo} is fully paid.`);
      if (dto.amount > shaped.due + 0.001) throw new BadRequestException(`Enter at most PKR ${shaped.due}, what is still due on ${inv.refNo}.`);
      if (dto.date > today()) throw new BadRequestException('A payment cannot be dated in the future.');
      if (dto.date < inv.date) throw new BadRequestException('A payment cannot be dated before its invoice.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.toAccount) await this.lookups.assertActive('BANK_ACCOUNT', dto.toAccount, em);
      const s = await this.settings.get(em);
      const refNo = await nextRef(em, DistributorInvoicePayment, s.docPrefixes['distReceipt'] ?? 'DRC', 3);
      const p = await em.save(em.create(DistributorInvoicePayment, {
        refNo, date: dto.date, invoiceId: id, amount: round2(dto.amount), method: dto.method, toAccount: dto.toAccount ?? null,
        reference: dto.reference?.trim() || null, note: dto.note?.trim() || null,
      }));
      await this.posting.syncDistInvoicePayment(em, p.id);
      const left = round2(shaped.due - dto.amount);
      await this.tell(em, user ?? null, inv, 'sales-invoice.paid', 'success', `Payment of PKR ${round2(dto.amount).toLocaleString('en-US')} recorded on ${inv.refNo}`,
        `PKR ${round2(dto.amount).toLocaleString('en-US')} received on ${inv.refNo}`, `${refNo} · ${dto.method}${left > 0 ? ` · PKR ${left.toLocaleString('en-US')} still due` : ' · paid in full'}`);
      return this.one(em, id);
    });
  }

  // ───────────── helpers ─────────────

  /** containers of each delivery already on an invoice that was not rejected */
  async soldMap(em: EntityManager, shipmentIds?: string[]): Promise<Record<string, number>> {
    const rows: { shipmentId: string; n: number }[] = await em.query(
      `SELECT l."shipmentId", SUM(l.containers)::int AS n
         FROM distributor_invoice_lines l JOIN distributor_invoices i ON i.id = l."invoiceId"
        WHERE i.status <> 'Rejected' ${shipmentIds ? 'AND l."shipmentId" = ANY($1)' : ''}
        GROUP BY l."shipmentId"`, shipmentIds ? [shipmentIds] : []);
    return Object.fromEntries(rows.map((r) => [r.shipmentId, Number(r.n)]));
  }

  /** the distributor's price per packet: its agreed rate for the SKU, else the product's */
  async saleRate(em: EntityManager, distributorId: string, productId: string): Promise<number> {
    const [agreed] = await em.query(`SELECT rate::float8 AS rate FROM distributor_rates WHERE "distributorId" = $1 AND "productId" = $2`, [distributorId, productId]);
    if (agreed) return Number(agreed.rate);
    return Number((await em.findOne(Product, { where: { id: productId } }))?.rate ?? 0);
  }

  private own(user: ShipmentUser): string {
    if (!user.distributorId) throw new ForbiddenException('This login is not linked to a distributor.');
    return user.distributorId;
  }

  private async load(em: EntityManager, id: string) {
    const inv = await em.findOne(DistributorInvoice, { where: { id } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  private async one(em: EntityManager, id: string) {
    const inv = await em.findOne(DistributorInvoice, { where: { id }, relations: ['distributor', 'lines', 'lines.product', 'lines.shipment'] });
    return (await this.shapeAll(em, [inv!]))[0];
  }

  /** each invoice with its payments, what is still due, whether it is overdue, and its containers */
  private async shapeAll(em: EntityManager, rows: DistributorInvoice[]) {
    const ids = rows.map((r) => r.id);
    const pays = ids.length ? await em.find(DistributorInvoicePayment, { where: { invoiceId: In(ids) }, order: { date: 'ASC', refNo: 'ASC' } }) : [];
    return rows.map((inv) => {
      const payments = pays.filter((p) => p.invoiceId === inv.id);
      const paid = round2(payments.reduce((n, p) => n + Number(p.amount), 0));
      const due = inv.status === 'Verified' ? round2(Number(inv.amount) - paid) : 0;
      const containers = (inv.lines ?? []).reduce((n, l) => n + l.containers, 0);
      const packets = (inv.lines ?? []).reduce((n, l) => n + l.packets, 0);
      const overdue = due > 0.01 && !!inv.dueDate && inv.dueDate < today();
      const state = inv.status !== 'Verified' ? (inv.status === 'Submitted' ? 'Waiting verification' : 'Rejected')
        : due <= 0.01 ? 'Paid' : paid > 0 ? 'Part paid' : overdue ? 'Overdue' : 'Open';
      return { ...inv, payments, paid, due, containers, packets, overdue, state, margin: round2(Number(inv.amount) - Number(inv.cost)) };
    });
  }
}
