import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Currency } from '../setup/setup.entities';
import { Distributor, DistributorPrice, PriceUnit, Product } from './catalog.entities';
import { CreateDistributorPriceDto, DistributorCreditDto } from './catalog.dto';
import { RegistrationUser } from './registration.service';

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** what one pack costs Zen Foods, in PKR, before any distributor margin */
export const costPerPack = (p: Product) =>
  Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate) + Number(p.outboundRate);

/**
 * The commercial side of an international distributor (spec sections 3 and 4): Finance-approved credit, verified
 * bank accounts, and a versioned price list per SKU in the distributor's currency with a margin guardrail.
 */
@Injectable()
export class CommercialService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  // ───────────── credit ─────────────

  /** Finance sets the credit limit (0 = advance only), its currency, expiry and control; who and when are kept */
  async setCredit(user: RegistrationUser, id: string, dto: DistributorCreditDto) {
    const em = this.db.manager;
    const d = await this.international(em, id);
    await this.currency(em, dto.creditCurrency);
    if (dto.creditExpiry && dto.creditExpiry < today()) throw new BadRequestException('The credit expiry is already past.');
    Object.assign(d, {
      creditLimit: dto.creditLimit, creditCurrency: dto.creditCurrency.toUpperCase(), creditExpiry: dto.creditExpiry ?? null,
      creditControl: dto.creditControl, creditApprovedBy: user.name, creditApprovedAt: new Date(),
    });
    return em.save(d);
  }

  // ───────────── bank accounts ─────────────

  /** Finance confirms a bank account (call-back, bank letter) before remittances from it are accepted */
  async verifyBank(user: RegistrationUser, id: string, index: number) {
    const em = this.db.manager;
    const d = await this.international(em, id);
    const bank = (d.bankAccounts ?? [])[index];
    if (!bank) throw new NotFoundException('Bank account not found');
    if (bank.verifiedAt) throw new BadRequestException('This bank account is already verified.');
    d.bankAccounts = d.bankAccounts.map((b, i) => (i === index ? { ...b, verifiedBy: user.name, verifiedAt: new Date().toISOString() } : b));
    return em.save(d);
  }

  // ───────────── price list ─────────────

  /** every version, newest first, with the SKU and whether it applies today */
  async prices(id: string) {
    const em = this.db.manager;
    await this.load(em, id);
    const rows = await em.find(DistributorPrice, { where: { distributorId: id }, relations: { product: true }, order: { createdAt: 'DESC' } });
    const t = today();
    return rows.map((r) => ({
      ...r,
      product: { id: r.product.id, sku: r.product.sku, name: r.product.name },
      current: r.status === 'Active' && r.effectiveFrom <= t && (!r.effectiveTo || r.effectiveTo >= t),
      netPerUnit: round(r.price * (1 - r.discountPct / 100), 4),
      pkrPerPack: round((r.price * (1 - r.discountPct / 100) * r.fxRate) / r.packsPerUnit, 4),
    }));
  }

  /** a new version; under the margin floor (or a promotional price) it waits for Finance */
  async addPrice(user: RegistrationUser, id: string, dto: CreateDistributorPriceDto) {
    return this.db.transaction(async (em) => {
      const d = await this.international(em, id);
      const p = await em.findOne(Product, { where: { id: dto.productId } });
      if (!p) throw new NotFoundException('Product not found');
      if (!(d.approvedProductIds ?? []).includes(p.id)) throw new BadRequestException(`${p.sku} is not on ${d.name}'s approved products. Add it to the agreement first.`);
      const cur = await this.currency(em, dto.currency);
      if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) throw new BadRequestException('The price ends before it starts.');
      if (dto.promo && !dto.effectiveTo) throw new BadRequestException('A promotional or sample price needs an end date.');
      const moq = dto.moq ?? 0;
      const increment = dto.increment ?? 0;
      if (moq > 0 && increment > 0 && Math.abs(moq / increment - Math.round(moq / increment)) > 1e-9) {
        throw new BadRequestException('The minimum order must be a multiple of the order increment.');
      }
      const packsPerUnit = this.packsPerUnit(p, dto.unit, dto.packsPerUnit);
      const discountPct = dto.discountPct ?? 0;
      const net = dto.price * (1 - discountPct / 100);
      const pkrPerPack = (net * Number(cur.rate)) / packsPerUnit;
      const cost = costPerPack(p);
      const marginPct = pkrPerPack > 0 ? round(((pkrPerPack - cost) / pkrPerPack) * 100) : -100;
      const floor = Number(d.minMarginPct ?? 0);
      const needsApproval = !!dto.promo || (floor > 0 && marginPct < floor);
      const promo = !!dto.promo;
      if (!promo) {
        const later = await em.findOne(DistributorPrice, {
          where: { distributorId: d.id, productId: p.id, unit: dto.unit, status: In(['Active', 'Pending approval']), promo: false },
          order: { effectiveFrom: 'DESC' },
        });
        if (later && later.effectiveFrom >= dto.effectiveFrom) {
          throw new ConflictException(`Version ${later.version} of ${p.sku} per ${dto.unit.toLowerCase()} already starts on ${later.effectiveFrom}. Start this one later.`);
        }
      }
      const [{ v }] = await em.query(
        `SELECT COALESCE(MAX(version), 0) AS v FROM distributor_prices WHERE "distributorId" = $1 AND "productId" = $2 AND unit = $3`,
        [d.id, p.id, dto.unit]);
      const row = await em.save(em.create(DistributorPrice, {
        distributorId: d.id, productId: p.id, version: Number(v) + 1, currency: cur.code, unit: dto.unit, packsPerUnit,
        price: dto.price, discountPct, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null, moq, increment,
        promo, note: dto.note?.trim() || null, fxRate: Number(cur.rate), costPerPack: round(cost, 4), marginPct,
        status: needsApproval ? 'Pending approval' : 'Active', createdBy: user.name,
      }));
      if (row.status === 'Active') await this.closeEarlier(em, row);
      return row;
    });
  }

  /** Finance accepts a price under the floor (or a promotional price), with a note */
  async approvePrice(user: RegistrationUser, id: string, priceId: string, note?: string) {
    return this.db.transaction(async (em) => {
      const r = await this.pending(em, id, priceId);
      if (r.createdBy === user.name && user.role !== 'Admin') throw new ForbiddenException('Someone other than the person who entered the price must approve it.');
      Object.assign(r, { status: 'Active', decidedBy: user.name, decidedAt: new Date(), decisionNote: note?.trim() || null });
      await em.save(r);
      await this.closeEarlier(em, r);
      return r;
    });
  }

  async rejectPrice(user: RegistrationUser, id: string, priceId: string, note?: string) {
    if (!note?.trim()) throw new BadRequestException('Say why the price is rejected.');
    const em = this.db.manager;
    const r = await this.pending(em, id, priceId);
    Object.assign(r, { status: 'Rejected', decidedBy: user.name, decidedAt: new Date(), decisionNote: note.trim() });
    return em.save(r);
  }

  /** only a price that never applied can be removed; an active one stays on record */
  async removePrice(id: string, priceId: string) {
    const em = this.db.manager;
    const r = await em.findOne(DistributorPrice, { where: { id: priceId, distributorId: id } });
    if (!r) throw new NotFoundException('Price not found');
    if (r.status === 'Active') throw new BadRequestException('An active price stays on record. Add a new version instead.');
    await em.remove(r);
    return { ok: true };
  }

  // ───────────── helpers ─────────────

  /** the previous open-ended regular version ends the day before this one starts */
  private async closeEarlier(em: EntityManager, row: DistributorPrice) {
    if (row.promo) return;
    const earlier = await em.find(DistributorPrice, {
      where: { distributorId: row.distributorId, productId: row.productId, unit: row.unit, status: 'Active', promo: false },
    });
    for (const e of earlier) {
      if (e.id === row.id || e.effectiveFrom >= row.effectiveFrom) continue;
      if (!e.effectiveTo || e.effectiveTo >= row.effectiveFrom) {
        e.effectiveTo = dayBefore(row.effectiveFrom);
        await em.save(e);
      }
    }
  }

  /** packs in one unit: fixed for pack and dozen, from the product's packaging for bundle and container, given for the rest */
  private packsPerUnit(p: Product, unit: PriceUnit, given?: number) {
    switch (unit) {
      case 'Pack': return 1;
      case 'Dozen': return 12;
      case 'Bundle': return p.packsPerCarton;
      case 'Container': return p.packsPerCarton * p.bundlesPerContainer;
      default:
        if (!given) throw new BadRequestException(`Say how many packs make one ${unit.toLowerCase()}.`);
        return given;
    }
  }

  private async pending(em: EntityManager, id: string, priceId: string) {
    const r = await em.findOne(DistributorPrice, { where: { id: priceId, distributorId: id } });
    if (!r) throw new NotFoundException('Price not found');
    if (r.status !== 'Pending approval') throw new BadRequestException(`This price is ${r.status.toLowerCase()}, not waiting for approval.`);
    return r;
  }

  private async currency(em: EntityManager, code: string) {
    const c = await em.findOne(Currency, { where: { code: code.toUpperCase() } });
    if (!c) throw new BadRequestException(`${code} is not a currency in Settings & Data.`);
    return c;
  }

  private async load(em: EntityManager, id: string) {
    const d = await em.findOne(Distributor, { where: { id } });
    if (!d) throw new NotFoundException('Distributor not found');
    return d;
  }

  private async international(em: EntityManager, id: string) {
    const d = await this.load(em, id);
    if (d.market === 'Local') throw new BadRequestException('This is for international distributors; a local one uses its agreed rate and credit limit.');
    return d;
  }
}
