import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Distributor } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { Currency } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { AllocationDto, RemittanceDto } from './exports.dto';
import { DistributorRemittance, ExportReceipt, ExportShipment } from './exports.entities';
import { ActingUser, ExportsService } from './exports.service';

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * One international distributor's account (spec sections 4, 9 and 10): its export orders and invoices, the money it
 * sent and how that was applied, aging per currency with the PKR equivalent, a running statement and its credit.
 */
@Injectable()
export class DistributorAccountService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly exports: ExportsService,
    private readonly posting: PostingService,
    private readonly lookups: LookupsService,
    private readonly settings: SettingsService,
  ) {}

  async account(id: string) {
    const em = this.db.manager;
    const d = await this.load(em, id);
    const t = today();
    const rates = new Map((await em.find(Currency)).map((c) => [c.code, Number(c.rate)]));
    const pkr = (amount: number, cur: string) => round2(amount * (rates.get(cur) ?? 1));
    const buckets = (await this.settings.get(em)).agingBuckets ?? [30, 60, 90];
    const labels = ['Current', ...buckets.map((b, i) => `${(i ? buckets[i - 1] : 0) + 1}-${b}`), `Over ${buckets[buckets.length - 1]}`];

    const shipments = await em.find(ExportShipment, { where: { distributorId: id }, order: { date: 'DESC', refNo: 'DESC' } });
    const orders = await Promise.all(shipments.map((x) => this.exports.findOne(x.id, em)));
    const remittances = await em.find(DistributorRemittance, { where: { distributorId: id }, order: { date: 'DESC', refNo: 'DESC' } });
    const applied = remittances.length
      ? await em.find(ExportReceipt, { where: { remittanceId: In(remittances.map((r) => r.id)) }, relations: ['shipment'], order: { refNo: 'ASC' } })
      : [];
    const direct = shipments.length
      ? (await em.find(ExportReceipt, { where: { shipmentId: In(shipments.map((s) => s.id)) }, relations: ['shipment'] })).filter((r) => !r.remittanceId)
      : [];

    // per currency: invoiced, collected, open, overdue, money not applied, aging
    const byCur = new Map<string, { currency: string; invoiced: number; collected: number; open: number; overdue: number; unapplied: number; aging: number[] }>();
    const cur = (c: string) => {
      if (!byCur.has(c)) byCur.set(c, { currency: c, invoiced: 0, collected: 0, open: 0, overdue: 0, unapplied: 0, aging: labels.map(() => 0) });
      return byCur.get(c)!;
    };
    for (const o of orders.filter((o) => o.status === 'Shipped')) {
      const c = cur(o.currency);
      c.invoiced += o.revenueForeign;
      c.collected += o.collected;
      c.open += o.due;
      if (o.overdue) c.overdue += o.due;
      if (o.due > 0.005) {
        const late = o.dueDate ? daysBetween(o.dueDate, t) : 0;
        const k = buckets.findIndex((b) => late <= b);
        c.aging[late <= 0 ? 0 : k < 0 ? labels.length - 1 : k + 1] += o.due;
      }
    }
    const remView = remittances.map((r) => {
      const used = round2(applied.filter((a) => a.remittanceId === r.id).reduce((s, a) => s + Number(a.foreignAmount), 0));
      const left = round2(Number(r.amount) - used);
      cur(r.currency).unapplied += left;
      return {
        ...r, applied: used, unapplied: left,
        allocations: applied.filter((a) => a.remittanceId === r.id).map((a) => ({ refNo: a.refNo, shipment: a.shipment.refNo, amount: Number(a.foreignAmount) })),
      };
    });
    const currencies = [...byCur.values()].map((c) => ({
      ...c,
      invoiced: round2(c.invoiced), collected: round2(c.collected), open: round2(c.open), overdue: round2(c.overdue), unapplied: round2(c.unapplied),
      aging: c.aging.map(round2), openPKR: pkr(c.open, c.currency), unappliedPKR: pkr(c.unapplied, c.currency),
      /** what the distributor owes after its unapplied money */
      balance: round2(c.open - c.unapplied),
    }));

    // the statement: invoices up, money received down, a running balance per currency
    type Line = { date: string; ref: string; text: string; currency: string; debit: number; credit: number; balance?: number };
    const lines: Line[] = [
      ...orders.filter((o) => o.status === 'Shipped').map((o) => ({
        date: o.shipDate ?? o.date, ref: o.refNo, text: `Invoice · ${o.product.sku} · ${o.cartons} bundles${o.dueDate ? ' · due ' + o.dueDate : ''}`,
        currency: o.currency, debit: o.revenueForeign, credit: 0,
      })),
      ...remittances.map((r) => ({
        date: r.date, ref: r.refNo, text: `Remittance · ${r.method}${r.bankRef ? ' · ' + r.bankRef : ''}`, currency: r.currency, debit: 0, credit: Number(r.amount),
      })),
      ...direct.map((r) => ({ date: r.date, ref: r.refNo, text: `Receipt · ${r.shipment.refNo}`, currency: r.shipment.currency, debit: 0, credit: Number(r.foreignAmount) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
    const running = new Map<string, number>();
    for (const l of lines) {
      running.set(l.currency, round2((running.get(l.currency) ?? 0) + l.debit - l.credit));
      l.balance = running.get(l.currency);
    }

    return {
      distributor: {
        id: d.id, name: d.name, code: d.code, registrationStatus: d.registrationStatus, invoiceCurrency: d.invoiceCurrency,
        paymentDays: d.paymentDays, paymentTermType: d.paymentTermType, settlementMethods: d.settlementMethods ?? [],
        bankAccounts: (d.bankAccounts ?? []).map((b, i) => ({ index: i, label: `${b.bankName} · ${b.iban || b.account}`, verified: !!b.verifiedAt, currency: b.currency ?? null })),
      },
      credit: await this.exports.creditPosition(em, d),
      agingLabels: labels,
      currencies,
      orders,
      remittances: remView,
      statement: lines,
    };
  }

  /** money from the distributor: into Customer Advances, applied now to the invoices given (the rest stays as credit) */
  async remit(user: ActingUser, id: string, dto: RemittanceDto) {
    return this.db.transaction(async (em) => {
      const d = await this.load(em, id);
      if (d.market === 'Local') throw new BadRequestException('Remittances are for international distributors.');
      const currency = dto.currency.toUpperCase();
      if (!(await em.findOne(Currency, { where: { code: currency } }))) throw new BadRequestException(`${currency} is not a currency in Settings & Data.`);
      await this.lookups.assertActive('REMITTANCE_METHOD', dto.method, em);
      if ((d.settlementMethods ?? []).length && !d.settlementMethods.includes(dto.method)) {
        throw new BadRequestException(`${dto.method} is not one of ${d.name}'s agreed remittance methods (${d.settlementMethods.join(', ')}).`);
      }
      if ((dto.fees ?? 0) >= dto.amount) throw new BadRequestException('The bank fees cannot be the whole amount.');
      if (dto.date > today()) throw new BadRequestException('The money cannot arrive in the future.');
      let fromBank: string | null = null;
      const banks = d.bankAccounts ?? [];
      if (banks.length) {
        if (dto.bankIndex === undefined) throw new BadRequestException(`Say which of ${d.name}'s bank accounts the money came from.`);
        const b = banks[dto.bankIndex];
        if (!b) throw new BadRequestException('That bank account is not on the distributor.');
        if (!b.verifiedAt) throw new BadRequestException(`${b.bankName} · ${b.iban || b.account} is not verified yet. Finance verifies it under Credit & prices first.`);
        fromBank = `${b.bankName} · ${b.iban || b.account}`;
      }
      const r = await em.save(em.create(DistributorRemittance, {
        refNo: await nextRef(em, DistributorRemittance, 'IRC', 3), date: dto.date, distributorId: d.id, currency, amount: dto.amount,
        fees: dto.fees ?? 0, fxRate: dto.fxRate, method: dto.method, bankRef: dto.bankRef?.trim() || null, fromBank,
        note: dto.note?.trim() || null, by: user.name,
      }));
      await this.posting.syncRemittance(em, r.id);
      if (dto.allocations?.length) await this.apply(em, r, dto.allocations);
      return r;
    }).then(() => this.account(id));
  }

  /** apply money not yet used to invoices */
  async allocate(id: string, remittanceId: string, allocations: AllocationDto[]) {
    await this.db.transaction(async (em) => {
      const r = await em.findOne(DistributorRemittance, { where: { id: remittanceId, distributorId: id } });
      if (!r) throw new NotFoundException('Remittance not found');
      await this.apply(em, r, allocations);
    });
    return this.account(id);
  }

  /** each part becomes a receipt on the invoice; never more than the invoice's balance or the money left */
  private async apply(em: EntityManager, r: DistributorRemittance, allocations: AllocationDto[]) {
    const [{ used }] = await em.query(`SELECT COALESCE(SUM("foreignAmount"), 0)::float8 AS used FROM export_receipts WHERE "remittanceId" = $1`, [r.id]);
    let left = round2(Number(r.amount) - Number(used));
    const total = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (total > left + 0.005) throw new BadRequestException(`Only ${r.currency} ${left} of ${r.refNo} is left to apply; you applied ${total}.`);
    const per = new Map<string, number>();
    for (const a of allocations) per.set(a.shipmentId, round2((per.get(a.shipmentId) ?? 0) + a.amount));
    for (const [shipmentId, amount] of per) {
      const x = await this.exports.findOne(shipmentId, em);
      if (x.distributorId !== r.distributorId) throw new BadRequestException(`${x.refNo} is not this distributor's invoice.`);
      if (x.status !== 'Shipped') throw new BadRequestException(`${x.refNo} has not shipped, so there is no invoice yet.`);
      if (x.currency !== r.currency) throw new BadRequestException(`${x.refNo} is in ${x.currency}; this money is in ${r.currency}.`);
      if (amount > x.due + 0.005) throw new BadRequestException(`${x.refNo} has only ${x.currency} ${x.due} open; ${amount} would overpay it.`);
      const rec = await em.save(em.create(ExportReceipt, {
        refNo: await nextRef(em, ExportReceipt, 'XRC', 3), date: r.date, shipmentId, foreignAmount: amount, fxRate: r.fxRate,
        method: r.method.slice(0, 30), note: `From ${r.refNo}`, remittanceId: r.id,
      }));
      await this.posting.syncExportReceipt(em, rec.id);
      left = round2(left - amount);
    }
  }

  private async load(em: EntityManager, id: string) {
    const d = await em.findOne(Distributor, { where: { id } });
    if (!d) throw new NotFoundException('Distributor not found');
    return d;
  }
}
