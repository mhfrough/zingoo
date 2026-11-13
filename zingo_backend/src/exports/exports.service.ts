import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Distributor, DistributorPrice, Product } from '../catalog/catalog.entities';
import { effectiveAgreement } from '../catalog/registration.service';
import { StockService } from '../catalog/stock.service';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { ContainerType, Currency, Setting } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { flagsFor, shipmentMath } from './export-math';
import { CreateExportDto, ExportCostPaymentDto, ExportReceiptDto, UpdateExportDto } from './exports.dto';
import { ExportCostPayment, ExportReceipt, ExportShipment } from './exports.entities';

const today = () => new Date().toISOString().slice(0, 10);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** who is acting */
export interface ActingUser {
  name: string;
  role: string;
}

/** an international distributor's credit position, in its credit currency */
export interface CreditPosition {
  currency: string;
  limit: number;
  /** open invoices, converted at today's rates */
  outstanding: number;
  /** money received and not yet applied */
  unapplied: number;
  /** outstanding + this order - unapplied */
  exposure: number;
  available: number;
  overdue: number;
  expired: boolean;
  control: 'Block' | 'Warn';
  /** what is wrong, in words (empty = fine) */
  problems: string[];
}

/**
 * Export containers: a quote is a costing scenario; shipping it posts the invoice, the goods cost
 * and the seller-borne logistics. Foreign-currency collections post any realised exchange gain or loss.
 */
@Injectable()
export class ExportsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly lookups: LookupsService,
  ) {}

  /** factory cost per carton: the released-batch average, else the planning rates x packs */
  private async planningUnitCost(em: EntityManager, p: Product, packs: number): Promise<number> {
    const avg = await this.stock.unitCostFor(p.id, em);
    if (avg > 0) return avg;
    const variable = Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate);
    return round2(variable * packs);
  }

  private async view(em: EntityManager, x: ExportShipment, s: Setting) {
    const p = x.product ?? (await em.findOneOrFail(Product, { where: { id: x.productId } }));
    const packs = x.packsPerCarton ?? p.packsPerCarton ?? s.packsPerCarton;
    const unitCost = x.unitCost ?? (await this.planningUnitCost(em, p, packs));
    const m = shipmentMath(x, packs, unitCost, flagsFor(await this.lookups.incotermFlags(em), x.incoterm));
    const [paid] = await em.query(`SELECT COALESCE(SUM("foreignAmount"), 0)::float8 AS v FROM export_receipts WHERE "shipmentId" = $1`, [x.id]);
    const [costPaid] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM export_cost_payments WHERE "shipmentId" = $1`, [x.id]);
    const collected = round2(paid.v);
    const costsSettled = round2(costPaid.v);
    const due = Math.max(0, round2(m.revenueForeign - collected));
    const d = x.distributorId ? (x.distributor ?? (await em.findOne(Distributor, { where: { id: x.distributorId } }))) : null;
    return {
      ...x,
      product: { id: p.id, sku: p.sku, name: p.name },
      distributor: d ? { id: d.id, name: d.name, code: d.code } : null,
      overdue: x.status === 'Shipped' && !!x.dueDate && x.dueDate < today() && due > 0.005,
      ...m,
      unitCost,
      collected,
      due,
      costPaid: costsSettled,
      costDue: Math.max(0, round2(m.sellerCostPKR - costsSettled)),
    };
  }

  async list() {
    const em = this.db.manager;
    const s = await this.settings.get(em);
    const rows = await em.find(ExportShipment, { relations: ['product', 'distributor'], order: { date: 'DESC', refNo: 'DESC' } });
    return Promise.all(rows.map((x) => this.view(em, x, s)));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const x = await em.findOne(ExportShipment, { where: { id }, relations: ['product', 'distributor'] });
    if (!x) throw new NotFoundException('Container not found');
    return this.view(em, x, await this.settings.get(em));
  }

  receipts() {
    return this.db.manager.find(ExportReceipt, { relations: ['shipment'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  costPayments() {
    return this.db.manager.find(ExportCostPayment, { relations: ['shipment'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  /** the currency and container must be set up, and the rate must be positive */
  private async check(em: EntityManager, d: { currency?: string; container?: string; productId?: string; incoterm?: string }) {
    if (d.currency && !(await em.findOne(Currency, { where: { code: d.currency } }))) {
      throw new BadRequestException(`Currency ${d.currency} is not set up.`);
    }
    if (d.container && !(await em.findOne(ContainerType, { where: { code: d.container } }))) {
      throw new BadRequestException(`Container type ${d.container} is not set up.`);
    }
    if (d.productId && !(await em.findOne(Product, { where: { id: d.productId } }))) {
      throw new BadRequestException('Choose an existing product.');
    }
    if (d.incoterm) await this.lookups.assertActive('INCOTERM', d.incoterm, em);
  }

  create(dto: CreateExportDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const data = dto.distributorId ? await this.fromDistributor(em, dto) : dto;
      for (const k of ['buyer', 'country', 'incoterm', 'currency', 'fxRate', 'rate'] as const) {
        if (data[k] === undefined || data[k] === null || data[k] === '') {
          throw new BadRequestException('Choose a distributor, or enter the buyer, country, Incoterm, currency, rate and price.');
        }
      }
      await this.check(em, data);
      const refNo = opts.refNo ?? (await nextRef(em, ExportShipment, 'EXP', 3));
      const x = await em.save(em.create(ExportShipment, { ...data, refNo, status: 'Quote' }));
      return this.findOne(x.id, em);
    });
  }

  /**
   * An order for an international distributor: what the order leaves out comes from the distributor (legal name,
   * country, port, Incoterm, currency, today's rate, payment terms) and its price list; the distributor itself is
   * not changed. The SKU must be approved for it, and the quantity must meet the price's minimum and multiple.
   */
  private async fromDistributor(em: EntityManager, dto: CreateExportDto): Promise<CreateExportDto & { priceId?: string | null }> {
    const d = await em.findOne(Distributor, { where: { id: dto.distributorId! } });
    if (!d) throw new NotFoundException('Distributor not found');
    if (d.market === 'Local') throw new BadRequestException(`${d.name} is a local distributor; export orders are for international ones.`);
    if (d.registrationStatus === 'Archived') throw new BadRequestException(`${d.name} is archived.`);
    if (!(d.approvedProductIds ?? []).includes(dto.productId)) throw new BadRequestException(`This SKU is not on ${d.name}'s approved products.`);
    const currency = (dto.currency ?? d.invoiceCurrency ?? 'USD').toUpperCase();
    const cur = await em.findOne(Currency, { where: { code: currency } });
    if (!cur) throw new BadRequestException(`Currency ${currency} is not set up.`);
    let rate = dto.rate;
    let priceId: string | null = null;
    const price = await this.priceOn(em, d.id, dto.productId, currency, dto.date);
    if (rate === undefined) {
      if (!price) throw new BadRequestException(`${d.name} has no ${currency} price for this SKU on ${dto.date}. Add one under Credit & prices, or enter the rate.`);
      rate = round6((Number(price.price) * (1 - Number(price.discountPct) / 100)) / Number(price.packsPerUnit));
      priceId = price.id;
    }
    if (price) {
      const p = await em.findOneOrFail(Product, { where: { id: dto.productId } });
      const units = (dto.cartons * p.packsPerCarton) / Number(price.packsPerUnit);
      const unit = price.unit.toLowerCase();
      if (Number(price.moq) > 0 && units + 1e-9 < Number(price.moq)) {
        throw new BadRequestException(`The minimum order is ${price.moq} ${unit}(s); this is ${round2(units)}.`);
      }
      const inc = Number(price.increment);
      if (inc > 0 && Math.abs(units / inc - Math.round(units / inc)) > 1e-6) {
        throw new BadRequestException(`Order in multiples of ${inc} ${unit}(s); this is ${round2(units)}.`);
      }
    }
    return {
      ...dto,
      buyer: dto.buyer ?? d.legalName ?? d.name,
      country: dto.country ?? d.country ?? d.countries?.[0] ?? '',
      port: dto.port ?? d.incotermPlace ?? undefined,
      incoterm: dto.incoterm ?? d.incoterm ?? undefined,
      currency,
      fxRate: dto.fxRate ?? Number(cur.rate),
      rate,
      priceId,
      paymentDays: dto.paymentDays ?? d.paymentDays,
      paymentPlan: dto.paymentPlan ?? d.paymentPlan ?? [],
    };
  }

  /** the price that applies on a day: a promotional one first, else the latest regular version */
  private async priceOn(em: EntityManager, distributorId: string, productId: string, currency: string, day: string) {
    const rows = await em.find(DistributorPrice, { where: { distributorId, productId, currency, status: 'Active' }, order: { version: 'DESC' } });
    const live = rows.filter((r) => r.effectiveFrom <= day && (!r.effectiveTo || r.effectiveTo >= day));
    return live.find((r) => r.promo) ?? live.find((r) => !r.promo) ?? null;
  }

  /**
   * Credit check (spec section 8): exposure = open invoices + this order - money received and not applied, in the
   * credit currency at today's rates. Over the limit, with invoices overdue, or with the credit expired, a Block
   * distributor cannot ship without Finance's override; a Warn distributor ships with a note.
   */
  async creditPosition(em: EntityManager, d: Distributor, order: { amount: number; currency: string } | null = null): Promise<CreditPosition> {
    const rates = new Map((await em.find(Currency)).map((c) => [c.code, Number(c.rate)]));
    const currency = d.creditCurrency ?? d.invoiceCurrency ?? 'PKR';
    const conv = (amount: number, from: string) => round2((amount * (rates.get(from) ?? 1)) / (rates.get(currency) ?? 1));
    const s = await this.settings.get(em);
    let outstanding = 0;
    let overdue = 0;
    for (const x of await em.find(ExportShipment, { where: { distributorId: d.id, status: 'Shipped' }, relations: ['product'] })) {
      const v = await this.view(em, x, s);
      outstanding += conv(v.due, x.currency);
      if (v.overdue) overdue += 1;
    }
    const un: { currency: string; left: number }[] = await em.query(
      `SELECT r.currency, (r.amount - COALESCE((SELECT SUM("foreignAmount") FROM export_receipts e WHERE e."remittanceId" = r.id), 0))::float8 AS left
         FROM distributor_remittances r WHERE r."distributorId" = $1`, [d.id]);
    const unapplied = round2(un.reduce((sum, r) => sum + conv(Number(r.left), r.currency), 0));
    const expired = !!d.creditExpiry && d.creditExpiry < today();
    const limit = expired ? 0 : Number(d.creditLimit);
    const extra = order ? conv(order.amount, order.currency) : 0;
    const exposure = round2(outstanding + extra - unapplied);
    const problems: string[] = [];
    if (exposure > limit + 0.005) {
      problems.push(limit > 0
        ? `exposure ${currency} ${exposure.toLocaleString()} is over the ${currency} ${limit.toLocaleString()} credit limit`
        : `there is no credit${expired ? ' (it expired on ' + d.creditExpiry + ')' : ''}: ${currency} ${exposure.toLocaleString()} would be unpaid`);
    }
    if (overdue) problems.push(`${overdue} invoice(s) overdue`);
    return {
      currency, limit, outstanding: round2(outstanding), unapplied, exposure, available: round2(Math.max(0, limit - exposure)),
      overdue, expired, control: d.creditControl ?? 'Block', problems,
    };
  }

  /** Finance lets one order ship over the credit limit or with invoices overdue; who, when and why are kept */
  async creditOverride(user: ActingUser, id: string, reason: string) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id } });
      if (!x) throw new NotFoundException('Container not found');
      if (!x.distributorId) throw new BadRequestException('Only an order for a distributor has a credit check.');
      if (x.status === 'Shipped') throw new BadRequestException('This container has already shipped.');
      Object.assign(x, { creditOverrideBy: user.name, creditOverrideRole: user.role, creditOverrideReason: reason.trim(), creditOverrideAt: new Date() });
      await em.save(x);
      return this.findOne(id, em);
    });
  }

  /**
   * Before an order for a distributor ships (spec section 8): the distributor is active, its agreement is signed and
   * in date, its licence and KYC documents have not expired, the SKU is approved, and the credit check passes.
   */
  private async eligible(em: EntityManager, x: ExportShipment, revenueForeign: number) {
    const d = await em.findOneOrFail(Distributor, { where: { id: x.distributorId! } });
    const t = today();
    if (d.registrationStatus !== 'Active') throw new BadRequestException(`${d.name} is ${d.registrationStatus.toLowerCase()}; only an active distributor's order can ship.`);
    const ag = effectiveAgreement(d);
    if (ag !== 'Signed') throw new BadRequestException(`${d.name}'s agreement is ${ag.toLowerCase()}; renew it before shipping.`);
    if (d.licenceExpiry && d.licenceExpiry < t) throw new BadRequestException(`${d.name}'s import / food licence expired on ${d.licenceExpiry}.`);
    const lapsed = (d.kycDocs ?? []).filter((k) => k.expiry && k.expiry < t).map((k) => k.type);
    if (lapsed.length) throw new BadRequestException(`${d.name}'s KYC documents have expired: ${lapsed.join(', ')}.`);
    if (!(d.approvedProductIds ?? []).includes(x.productId)) throw new BadRequestException(`This SKU is not on ${d.name}'s approved products.`);
    const c = await this.creditPosition(em, d, { amount: revenueForeign, currency: x.currency });
    if (!c.problems.length) return null;
    const text = `Credit check: ${c.problems.join('; ')}.`;
    if (x.creditOverrideAt) return `${text} Shipped on the override by ${x.creditOverrideBy} (${x.creditOverrideReason}).`;
    if (c.control === 'Warn') return `${text} Shipped with a warning.`;
    throw new BadRequestException(`${text} Finance can approve an override for this order.`);
  }

  update(id: string, dto: UpdateExportDto) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id } });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('Shipped containers are locked; post an adjusting voucher for corrections.');
      await this.check(em, dto);
      const distributorId = dto.distributorId === undefined ? x.distributorId : dto.distributorId;
      if (distributorId) {
        const d = await em.findOne(Distributor, { where: { id: distributorId } });
        if (!d || d.market === 'Local') throw new BadRequestException('Choose an international distributor.');
        if (!(d.approvedProductIds ?? []).includes(dto.productId ?? x.productId)) throw new BadRequestException(`This SKU is not on ${d.name}'s approved products.`);
      }
      // an override was given for the old figures
      const changed = (['cartons', 'rate', 'fxRate', 'currency', 'distributorId', 'productId'] as const)
        .some((k) => dto[k] !== undefined && String(dto[k]) !== String(x[k]));
      if (changed) Object.assign(x, { creditOverrideBy: null, creditOverrideRole: null, creditOverrideReason: null, creditOverrideAt: null });
      await em.save(em.merge(ExportShipment, x, dto));
      return this.findOne(id, em);
    });
  }

  remove(id: string) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id } });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('Shipped containers cannot be deleted.');
      await em.remove(x);
      return { deleted: true };
    });
  }

  /** ship a quote: stock goes down, the goods cost is frozen and the invoice, cost and logistics post */
  ship(id: string, shipDate?: string) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id }, relations: ['product'] });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('This container has already shipped.');
      const available = await this.stock.stockOf(x.productId, em);
      if (x.cartons > available) {
        throw new BadRequestException(`Not enough stock: ${x.cartons} bundles needed, ${available} in the warehouse.`);
      }
      const s = await this.settings.get(em);
      const packs = x.product.packsPerCarton ?? s.packsPerCarton;
      if (x.distributorId) x.creditNote = await this.eligible(em, x, round2(x.cartons * packs * Number(x.rate)));
      x.packsPerCarton = packs;
      x.unitCost = await this.planningUnitCost(em, x.product, packs);
      x.shipDate = shipDate ?? today();
      x.dueDate = x.distributorId ? addDays(x.shipDate, x.paymentDays ?? 0) : null;
      x.status = 'Shipped';
      await em.save(x);
      await this.posting.syncShipment(em, id);
      return this.findOne(id, em);
    });
  }

  /** money from the buyer, in the invoice currency, at the rate of the day it arrived */
  collect(id: string, dto: ExportReceiptDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const x = await this.findOne(id, em);
      if (x.status !== 'Shipped') throw new BadRequestException('Ship the container before collecting payment.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.foreignAmount > x.due + 0.001) {
        throw new BadRequestException(`Enter an amount within the open balance of ${x.currency} ${x.due}.`);
      }
      const refNo = opts.refNo ?? (await nextRef(em, ExportReceipt, 'XRC', 3));
      const r = await em.save(em.create(ExportReceipt, { ...dto, refNo, shipmentId: id, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncExportReceipt(em, r.id);
      return this.findOne(id, em);
    });
  }

  /** PKR paid for the seller-side logistics; settles the accrual, so it is not a second expense */
  payCosts(id: string, dto: ExportCostPaymentDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const x = await this.findOne(id, em);
      if (x.status !== 'Shipped') throw new BadRequestException('Ship the container before paying its costs.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.amount > x.costDue + 0.01) {
        throw new BadRequestException(`Enter an amount within the open export costs of PKR ${x.costDue}.`);
      }
      const refNo = opts.refNo ?? (await nextRef(em, ExportCostPayment, 'XCP', 3));
      const p = await em.save(em.create(ExportCostPayment, { ...dto, refNo, shipmentId: id, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncExportCostPayment(em, p.id);
      return this.findOne(id, em);
    });
  }
}
