import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JournalSource } from '../common/enums';
import { round2 } from '../common/numeric.transformer';
import { Collection, SalesOrder } from '../distribution/distribution.entities';
import { CreditNote } from '../portal/portal.entities';
import { flagsFor, shipmentMath } from '../exports/export-math';
import { LookupsService } from '../setup/lookups.service';
import { ExportCostPayment, ExportReceipt, ExportShipment } from '../exports/exports.entities';
import { AccountingDocument, AccountingSettlement, Approval, FinanceEntry, FundingRepayment } from '../finance/finance.entities';
import { ManufacturerPayment, ProductionBatch } from '../manufacturing/manufacturing.entities';
import { Setting } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { JournalVoucher } from './ledger.entities';
import { LedgerRow, LedgerService } from './ledger.service';

/** Ledger account names (the chart of accounts is looked up by name). */
export const ACC = {
  CASH: 'Cash & Bank',
  AR: 'Accounts Receivable',
  INVENTORY: 'Inventory · Estimated',
  FIXED_ASSETS: 'Fixed Assets',
  AP: 'Accounts Payable',
  MFR_PAYABLE: 'Manufacturer Payable',
  PARTNER_LOANS: 'Partner Loans',
  EQUITY: 'Owner Equity',
  SALES: 'Sales Revenue',
  OTHER_INCOME: 'Other Income',
  COGS: 'Cost of Goods Sold',
  EXPORT_SALES: 'Export Sales Revenue',
  EXPORT_LOGISTICS: 'Export Logistics Expense',
  EXPORT_COSTS_PAYABLE: 'Export Costs Payable',
  FX_GAIN: 'FX Gain',
  FX_LOSS: 'FX Loss',
  CUSTOMER_ADVANCES: 'Customer Advances',
  SALES_RETURNS: 'Sales Returns & Allowances',
  DIST_CREDIT_PAYABLE: 'Distributor Credit Payable',
} as const;

export interface ApprovalState {
  /** does this document need signatures at all */
  needs: boolean;
  signed: string[];
  required: number;
  approved: boolean;
}

/**
 * Turns documents into journal lines. Each sync*() is safe to call again and again:
 * it works out what the document should look like in the ledger right now and rewrites it.
 *   - a batch only posts once Released
 *   - an order only posts once Dispatched
 *   - spend / bills only post once they have enough signatures
 */
@Injectable()
export class PostingService implements OnModuleInit {
  constructor(
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  onModuleInit() {
    // a new approval threshold can change which documents count as approved
    this.settings.changed$.subscribe(() => void this.resyncApprovals());
  }

  /** two lines, one debit one credit; nothing for a zero amount */
  private pair(
    date: string, source: JournalSource, reference: string, description: string,
    debit: string, credit: string, amount: number, extra: Partial<LedgerRow> = {},
  ): LedgerRow[] {
    const n = round2(Number(amount));
    if (!(n > 0)) return [];
    return [
      { date, source, reference, description, account: debit, debit: n, credit: 0, ...extra },
      { date, source, reference, description, account: credit, debit: 0, credit: n, ...extra },
    ];
  }

  // ───────────── approvals ─────────────

  required(amount: number, s: Setting) {
    return Number(amount) >= Number(s.approvalThreshold) ? 2 : 1;
  }

  async signatures(em: EntityManager, docType: 'FINANCE' | 'ACCOUNTING', docId: string): Promise<string[]> {
    const rows = await em.find(Approval, { where: { docType, docId }, order: { seat: 'ASC' } });
    return rows.map((r) => r.seat);
  }

  async financeState(em: EntityManager, f: FinanceEntry): Promise<ApprovalState> {
    const needs = f.type === 'Operating Expense' || f.type === 'Asset Purchase';
    if (!needs) return { needs, signed: [], required: 0, approved: true };
    const [s, signed] = await Promise.all([this.settings.get(em), this.signatures(em, 'FINANCE', f.id)]);
    const required = this.required(f.amount, s);
    return { needs, signed, required, approved: signed.length >= required };
  }

  async accountingState(em: EntityManager, a: AccountingDocument): Promise<ApprovalState> {
    if (a.status === 'Draft') return { needs: false, signed: [], required: 0, approved: false };
    const needs = a.kind === 'Expense';
    if (!needs) return { needs, signed: [], required: 0, approved: true };
    const [s, signed] = await Promise.all([this.settings.get(em), this.signatures(em, 'ACCOUNTING', a.id)]);
    const required = this.required(a.amount, s);
    return { needs, signed, required, approved: signed.length >= required };
  }

  // ───────────── manufacturing ─────────────

  async syncBatch(em: EntityManager, id: string) {
    const b = await em.findOne(ProductionBatch, { where: { id }, relations: ['product'] });
    if (!b) return;
    const rows = b.status === 'Released'
      ? this.pair(b.date, 'Manufacturing', b.refNo, `Factory goods received · ${b.product.sku}`, ACC.INVENTORY, ACC.MFR_PAYABLE, b.cost)
      : [];
    await this.ledger.replace(em, 'BATCH', id, rows);
  }

  async syncMfrPayment(em: EntityManager, id: string) {
    const p = await em.findOne(ManufacturerPayment, { where: { id }, relations: ['batch'] });
    if (!p) return;
    await this.ledger.replace(em, 'MFR_PAYMENT', id,
      this.pair(p.date, 'Manufacturing', p.refNo, `Factory payable settled · ${p.batch.refNo}`, ACC.MFR_PAYABLE, ACC.CASH, p.amount));
  }

  // ───────────── distribution ─────────────

  async syncOrder(em: EntityManager, id: string) {
    const o = await em.findOne(SalesOrder, { where: { id }, relations: ['product', 'distributor'] });
    if (!o) return;
    let rows: LedgerRow[] = [];
    if (o.status === 'Dispatched') {
      const s = await this.settings.get(em);
      const date = o.dispatchDate ?? o.date;
      const packs = o.packsPerCarton || o.product.packsPerCarton || s.packsPerCarton;
      const billed = round2(o.cartons * packs * Number(o.rate));
      rows = [
        ...this.pair(date, 'Distribution', o.refNo, `Distributor invoice · ${o.distributor.name}`, ACC.AR, ACC.SALES, billed),
        ...this.pair(date, 'Distribution', o.refNo, `COGS · ${o.product.sku}`, ACC.COGS, ACC.INVENTORY, o.cartons * Number(o.unitCost ?? 0)),
        ...this.pair(date, 'Distribution', o.refNo, `Apply advances paid before dispatch · ${o.distributor.name}`, ACC.CUSTOMER_ADVANCES, ACC.AR, await this.advancesOf(em, id)),
      ];
    }
    await this.ledger.replace(em, 'ORDER', id, rows);
  }

  async syncCollection(em: EntityManager, id: string) {
    const c = await em.findOne(Collection, { where: { id }, relations: ['order'] });
    if (!c) return;
    await this.ledger.replace(em, 'COLLECTION', id,
      this.pair(c.date, 'Distribution', c.refNo,
        c.isAdvance ? `Distributor advance · ${c.order.refNo}` : `Distributor collection · ${c.order.refNo}`,
        ACC.CASH, c.isAdvance ? ACC.CUSTOMER_ADVANCES : ACC.AR, c.amount));
  }

  /** money a distributor paid before the order was dispatched */
  private async advancesOf(em: EntityManager, orderId: string): Promise<number> {
    const [r] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM collections WHERE "orderId" = $1 AND "isAdvance" = true`, [orderId]);
    return round2(r.v);
  }

  /**
   * An approved damage / shortage claim. The part that fits inside the open invoice reduces the receivable;
   * anything beyond it is credit owed back to the distributor. Both are booked against Sales Returns & Allowances.
   */
  async syncCreditNote(em: EntityManager, id: string) {
    const c = await em.findOne(CreditNote, { where: { id }, relations: ['order'] });
    if (!c) return;
    const refund = round2(Number(c.refund));
    const applied = round2(Number(c.amount) - refund);
    await this.ledger.replace(em, 'CREDIT_NOTE', id, [
      ...this.pair(c.date, 'Distributor Portal', c.refNo, `Approved damaged / missing credit · ${c.order.refNo}`, ACC.SALES_RETURNS, ACC.AR, applied),
      ...this.pair(c.date, 'Distributor Portal', c.refNo, `Distributor refund / credit due · ${c.order.refNo}`, ACC.SALES_RETURNS, ACC.DIST_CREDIT_PAYABLE, refund),
    ]);
  }

  // ───────────── finance ─────────────

  /**
   * Every investor account is kept apart: equity goes to "Owner Equity · <name>", a loan or advance to
   * "Capital Source · <type> · <name>" (a liability). Older entries without an account keep the shared accounts
   * (Owner Equity, Partner Loans, or one account per capital source).
   */
  private async capitalAccount(em: EntityManager, funding: string, party: string, hasAccount: boolean, direction: 'in' | 'out' = 'in'): Promise<string> {
    const liability = !!funding && funding !== 'Equity' && (funding === 'Partner Loan' || (await this.lookups.isLiability(em, funding)));
    // an advance the company pays out is money it will get back: an asset account of its own per partner
    if (direction === 'out' && hasAccount && party) return `Advance Receivable · ${party}`.slice(0, 80).trim();
    // an account name holds at most 80 characters
    if (hasAccount && party) return (liability ? `Capital Source · ${funding} · ${party}` : `${ACC.EQUITY} · ${party}`).slice(0, 80).trim();
    if (!funding || funding === 'Equity') return ACC.EQUITY;
    if (funding === 'Partner Loan') return ACC.PARTNER_LOANS;
    return liability ? `Capital Source · ${funding}` : ACC.EQUITY;
  }

  async syncFinance(em: EntityManager, id: string) {
    const f = await em.findOne(FinanceEntry, { where: { id } });
    if (!f) return;
    const st = await this.financeState(em, f);
    let rows: LedgerRow[] = [];
    if (st.approved) {
      const n = Number(f.amount);
      switch (f.type) {
        case 'Capital Injection':
          // a cheque is not cash until it clears; a bounced one never is
          if (f.chequeStatus === 'Pending' || f.chequeStatus === 'Bounced') break;
          {
            const account = await this.capitalAccount(em, f.funding, f.party, !!f.partyId, f.direction);
            const date = f.chequeStatus === 'Cleared' ? f.clearanceDate ?? f.date : f.date;
            const paidOut = f.direction === 'out'; // an advance the company pays to a partner
            const text = paidOut ? `Advance paid · ${f.party}` : f.chequeStatus === 'Cleared' ? `Funding · ${f.party} · cheque ${f.chequeNo}` : `Funding · ${f.party}`;
            rows = paidOut
              ? this.pair(date, 'Investment', f.refNo, text, account, ACC.CASH, n)
              : this.pair(date, 'Investment', f.refNo, text, ACC.CASH, account, n);
          }
          break;
        case 'Operating Expense':
          rows = this.pair(f.date, 'Investment', f.refNo, `Operating expense · ${f.category}`, `Expense · ${f.category}`, ACC.CASH, n);
          break;
        case 'Asset Purchase':
          rows = this.pair(f.date, 'Investment', f.refNo, `Fixed asset · ${f.category}`, ACC.FIXED_ASSETS, ACC.CASH, n);
          break;
        case 'Other Receipt':
          rows = this.pair(f.date, 'Investment', f.refNo, `Other receipt · ${f.party}`, ACC.CASH, ACC.OTHER_INCOME, n);
          break;
      }
    }
    await this.ledger.replace(em, 'FINANCE', id, rows);
  }

  /**
   * A repayment of a loan or advance. Principal moves cash against the investor's own account (cash out and the
   * liability down; for an advance the company paid out, cash in and the receivable down). Markup is the cost of
   * the money: an interest expense when the company pays it, other income when a partner pays it.
   */
  async syncRepayment(em: EntityManager, id: string) {
    const r = await em.findOne(FundingRepayment, { where: { id }, relations: ['entry'] });
    if (!r) return;
    const f = r.entry;
    const account = await this.capitalAccount(em, f.funding, f.party, !!f.partyId, f.direction);
    const out = f.direction === 'out';
    let rows: LedgerRow[];
    if (r.kind === 'markup') {
      rows = out
        ? this.pair(r.date, 'Investment', r.refNo, `Markup received · ${f.party}`, ACC.CASH, ACC.OTHER_INCOME, r.amount)
        : this.pair(r.date, 'Investment', r.refNo, `Markup paid · ${f.party}`, 'Expense · Interest & Bank Fees', ACC.CASH, r.amount);
    } else {
      rows = out
        ? this.pair(r.date, 'Investment', r.refNo, `Advance returned · ${f.party}`, ACC.CASH, account, r.amount)
        : this.pair(r.date, 'Investment', r.refNo, `Repayment · ${f.party}`, account, ACC.CASH, r.amount);
    }
    await this.ledger.replace(em, 'FUNDING_REPAY', id, rows);
  }

  // ───────────── accounting (income invoices, expense bills) ─────────────

  async syncAccountingDoc(em: EntityManager, id: string) {
    const a = await em.findOne(AccountingDocument, { where: { id } });
    if (!a) return;
    const st = await this.accountingState(em, a);
    let rows: LedgerRow[] = [];
    if (st.approved) {
      const extra = { currency: a.currency, fxRate: a.fxRate };
      const tax = Math.min(Number(a.taxAmount) || 0, Number(a.amount));
      rows = a.kind === 'Income'
        ? [
            ...this.pair(a.date, 'Accounting', a.refNo, `Income invoice · ${a.party}`, ACC.AR, `Income · ${a.category}`, round2(Number(a.amount) - tax), extra),
            ...(tax > 0 ? this.pair(a.date, 'Accounting', a.refNo, `Sales tax on invoice · ${a.party}`, ACC.AR, 'Sales Tax Payable', tax, extra) : []),
          ]
        : this.pair(a.date, 'Accounting', a.refNo, `Supplier bill · ${a.party}`, `Expense · ${a.category}`, ACC.AP, a.amount, extra);
    }
    await this.ledger.replace(em, 'ACC_DOC', id, rows);
    // payments against it only count while the document itself is approved
    const settlements = await em.find(AccountingSettlement, { where: { documentId: id } });
    for (const s of settlements) await this.syncSettlement(em, s.id);
  }

  async syncSettlement(em: EntityManager, id: string) {
    const s = await em.findOne(AccountingSettlement, { where: { id }, relations: ['document'] });
    if (!s) return;
    const st = await this.accountingState(em, s.document);
    let rows: LedgerRow[] = [];
    if (st.approved) {
      rows = s.document.kind === 'Income'
        ? this.pair(s.date, 'Accounting', s.refNo, `Invoice collected · ${s.document.party}`, ACC.CASH, ACC.AR, s.amount)
        : this.pair(s.date, 'Accounting', s.refNo, `Bill paid · ${s.document.party}`, ACC.AP, ACC.CASH, s.amount);
    }
    await this.ledger.replace(em, 'ACC_SETTLEMENT', id, rows);
  }

  // ───────────── exports ─────────────

  /**
   * A shipped container: invoice (receivable / export sales at the invoice rate), the frozen goods cost,
   * and the logistics the seller carries under the Incoterm (accrued as a payable). A quote posts nothing.
   */
  async syncShipment(em: EntityManager, id: string) {
    const x = await em.findOne(ExportShipment, { where: { id }, relations: ['product'] });
    if (!x) return;
    let rows: LedgerRow[] = [];
    if (x.status === 'Shipped') {
      const s = await this.settings.get(em);
      const m = shipmentMath(x, x.packsPerCarton ?? x.product.packsPerCarton ?? s.packsPerCarton, Number(x.unitCost ?? 0), flagsFor(await this.lookups.incotermFlags(em), x.incoterm));
      const date = x.shipDate ?? x.date;
      const fx = { currency: x.currency, fxRate: x.fxRate };
      rows = [
        ...this.pair(date, 'Exports', x.refNo, `Export invoice ${x.incoterm} · ${x.buyer}`, ACC.AR, ACC.EXPORT_SALES, m.revenuePKR, fx),
        ...this.pair(date, 'Exports', x.refNo, `Export goods cost · ${x.product.sku}`, ACC.COGS, ACC.INVENTORY, m.cogs),
        ...this.pair(date, 'Exports', x.refNo, `Export seller-borne logistics · ${x.incoterm}`, ACC.EXPORT_LOGISTICS, ACC.EXPORT_COSTS_PAYABLE, m.sellerCostPKR),
      ];
    }
    await this.ledger.replace(em, 'EXPORT', id, rows);
    for (const r of await em.find(ExportReceipt, { where: { shipmentId: id } })) await this.syncExportReceipt(em, r.id);
    for (const p of await em.find(ExportCostPayment, { where: { shipmentId: id } })) await this.syncExportCostPayment(em, p.id);
  }

  /**
   * Money from the buyer. The receivable is cleared at the invoice rate; the difference to the rate on the
   * day the money arrived is a realised FX gain (more PKR than invoiced) or FX loss (less).
   */
  async syncExportReceipt(em: EntityManager, id: string) {
    const r = await em.findOne(ExportReceipt, { where: { id }, relations: ['shipment'] });
    if (!r) return;
    let rows: LedgerRow[] = [];
    if (r.shipment.status === 'Shipped') {
      const base = round2(Number(r.foreignAmount) * Number(r.shipment.fxRate));
      const cash = round2(Number(r.foreignAmount) * Number(r.fxRate));
      const desc = `Export collection · ${r.shipment.refNo}`;
      const fx = { currency: r.shipment.currency, fxRate: r.fxRate };
      rows = [
        ...this.pair(r.date, 'Exports', r.refNo, desc, ACC.CASH, ACC.AR, Math.min(base, cash), fx),
        ...(cash > base ? this.pair(r.date, 'Exports', r.refNo, `FX gain · ${r.shipment.refNo}`, ACC.CASH, ACC.FX_GAIN, cash - base, fx) : []),
        ...(base > cash ? this.pair(r.date, 'Exports', r.refNo, `FX loss · ${r.shipment.refNo}`, ACC.FX_LOSS, ACC.AR, base - cash, fx) : []),
      ];
    }
    await this.ledger.replace(em, 'EXPORT_RECEIPT', id, rows);
  }

  /** Paying the accrued logistics: the cost was booked at shipping, so this only moves cash against the payable. */
  async syncExportCostPayment(em: EntityManager, id: string) {
    const p = await em.findOne(ExportCostPayment, { where: { id }, relations: ['shipment'] });
    if (!p) return;
    await this.ledger.replace(em, 'EXPORT_COST', id,
      p.shipment.status === 'Shipped'
        ? this.pair(p.date, 'Exports', p.refNo, `Export costs settled · ${p.shipment.refNo}`, ACC.EXPORT_COSTS_PAYABLE, ACC.CASH, p.amount)
        : []);
  }

  // ───────────── manual journal vouchers ─────────────

  /**
   * A voucher posts every line in PKR (amount x the voucher's rate). A rounding difference of a few
   * paisa is moved onto the largest line of the lighter side, so the ledger always balances exactly.
   */
  async syncVoucher(em: EntityManager, id: string) {
    const v = await em.findOne(JournalVoucher, { where: { id } });
    if (!v) return;
    const fx = Number(v.fxRate) || 1;
    const rows: LedgerRow[] = v.lines
      .map((l) => ({
        date: v.date, source: 'Manual Voucher' as const, reference: v.refNo, description: v.memo, account: l.account,
        debit: round2(Number(l.debit) * fx), credit: round2(Number(l.credit) * fx), currency: v.currency, fxRate: fx,
      }))
      .filter((r) => r.debit > 0 || r.credit > 0);
    const diff = round2(rows.reduce((s, r) => s + r.debit - r.credit, 0));
    if (diff !== 0 && Math.abs(diff) <= 0.05) {
      const side = diff > 0 ? 'credit' : 'debit';
      const target = rows.filter((r) => r[side] > 0).sort((a, b) => b[side] - a[side])[0];
      if (target) target[side] = round2(target[side] + Math.abs(diff));
    }
    await this.ledger.replace(em, 'VOUCHER', id, rows);
  }

  /** Re-check every document that depends on signatures (called after the threshold changes). */
  async resyncApprovals() {
    await this.db.transaction(async (em) => {
      for (const f of await em.find(FinanceEntry)) await this.syncFinance(em, f.id);
      for (const a of await em.find(AccountingDocument)) await this.syncAccountingDoc(em, a.id);
    });
  }
}
