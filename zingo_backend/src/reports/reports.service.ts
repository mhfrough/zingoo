import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StockService } from '../catalog/stock.service';
import { round2 } from '../common/numeric.transformer';
import { OrdersService } from '../distribution/distribution.service';
import { ExportsService } from '../exports/exports.service';
import { AccountingService, FinanceService } from '../finance/finance.service';
import { BatchesService } from '../manufacturing/manufacturing.service';
import { ProductionOrdersService } from '../manufacturing/production-orders.service';
import { PaymentRequestsService } from '../manufacturing/payment-requests.service';
import { ShipmentsService } from '../manufacturing/shipments.service';
import { DistInvoicesService } from '../manufacturing/dist-invoices.service';
import { SettingsService } from '../setup/setup.service';

/** Period filter: 'all' or 'YYYY-MM'. */
type Period = string;

/**
 * Read-only reports. Money figures come from the ledger (so they always agree with each other);
 * stock and approvals come from the documents.
 */
/** An investor's expected return shows as an alert from this many days before the date ... */
const RETURN_ALERT_BEFORE_DAYS = 14;
/** ... until this many days after it. */
const RETURN_ALERT_AFTER_DAYS = 30;

/** true when `date` (yyyy-mm-dd) is within the alert window around today */
function returnDue(date: string): boolean {
  const day = 86_400_000;
  const diff = (Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / day;
  return diff <= RETURN_ALERT_BEFORE_DAYS && diff >= -RETURN_ALERT_AFTER_DAYS;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly settings: SettingsService,
    private readonly stockSvc: StockService,
    private readonly orders: OrdersService,
    private readonly batches: BatchesService,
    private readonly finance: FinanceService,
    private readonly accounting: AccountingService,
    private readonly exportsSvc: ExportsService,
    private readonly productionOrders: ProductionOrdersService,
    private readonly paymentRequests: PaymentRequestsService,
    private readonly shipments: ShipmentsService,
    private readonly distInvoices: DistInvoicesService,
  ) {}

  /** net balance (debit - credit) of one ledger account */
  async accountNet(name: string): Promise<number> {
    const [r] = await this.db.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS net
         FROM ledger_entries l JOIN accounts a ON a.code = l."accountCode" WHERE a.name = $1`,
      [name],
    );
    return round2(r.net);
  }

  // ───────────── income statement ─────────────

  async incomeStatement(period: Period = 'all') {
    const rows: { name: string; type: string; debit: number; credit: number }[] = await this.db.query(
      `SELECT a.name, a.type, SUM(l.debit)::float8 AS debit, SUM(l.credit)::float8 AS credit
         FROM ledger_entries l JOIN accounts a ON a.code = l."accountCode"
        WHERE $1::text = 'all' OR to_char(l."entryDate", 'YYYY-MM') = $1::text
        GROUP BY a.name, a.type`,
      [period],
    );
    let sales = 0, other = 0, cogs = 0, opex = 0;
    const income: Record<string, number> = {};
    const expenses: Record<string, number> = {};
    for (const r of rows) {
      if (r.type === 'Revenue') {
        const v = r.credit - r.debit;
        if (['Sales Revenue', 'Export Sales Revenue', 'Sales Returns & Allowances'].includes(r.name)) sales += v; else other += v;
        income[r.name] = round2(v);
      } else if (r.type === 'COGS') {
        cogs += r.debit - r.credit;
      } else if (r.type === 'Expense') {
        const v = r.debit - r.credit;
        opex += v;
        expenses[r.name] = round2(v);
      }
    }
    const revenue = sales + other;
    return {
      period,
      sales: round2(sales), other: round2(other), revenue: round2(revenue), cogs: round2(cogs),
      grossProfit: round2(revenue - cogs), operatingExpenses: round2(opex), netProfit: round2(revenue - cogs - opex),
      income, expenses,
    };
  }

  // ───────────── books ─────────────

  async trialBalance() {
    const rows: { code: string; name: string; type: string; debit: number; credit: number }[] = await this.db.query(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(l.debit), 0)::float8 AS debit, COALESCE(SUM(l.credit), 0)::float8 AS credit
         FROM accounts a LEFT JOIN ledger_entries l ON l."accountCode" = a.code
        GROUP BY a.code, a.name, a.type ORDER BY a.code`,
    );
    const accounts = rows.map((r) => ({ ...r, debit: round2(r.debit), credit: round2(r.credit), net: round2(r.debit - r.credit) }));
    const debit = round2(accounts.reduce((s, r) => s + r.debit, 0));
    const credit = round2(accounts.reduce((s, r) => s + r.credit, 0));
    return { accounts, totalDebit: debit, totalCredit: credit, balanced: Math.abs(debit - credit) < 0.005 };
  }

  /**
   * One account's ledger (or every account with code "all"), oldest first, with the running balance
   * (debit - credit). The period only filters the rows; the running balance carries on from earlier months.
   */
  async accountLedger(code = 'all', period: Period = 'all') {
    const rows: any[] = await this.db.query(
      `SELECT l.id, to_char(l."entryDate", 'YYYY-MM-DD') AS date, l.reference, l.source, l.description,
              a.code AS "accountCode", a.name AS account, l.debit::float8 AS debit, l.credit::float8 AS credit
         FROM ledger_entries l JOIN accounts a ON a.code = l."accountCode"
        WHERE $1::text = 'all' OR a.code = $1::text
        ORDER BY l."entryDate", l.seq`,
      [code],
    );
    let running = 0;
    const all = rows.map((r) => ({ ...r, running: (running = round2(running + r.debit - r.credit)) }));
    return period === 'all' ? all : all.filter((r) => r.date.slice(0, 7) === period);
  }

  /** assets, liabilities and equity from the ledger; current profit is shown on its own line */
  async balanceSheet() {
    const tb = await this.trialBalance();
    const of = (type: string, sign: 1 | -1) =>
      tb.accounts.filter((a) => a.type === type && Math.abs(a.net) > 0.004).map((a) => ({ code: a.code, name: a.name, balance: round2(sign * a.net) }));
    const sum = (rows: { balance: number }[]) => round2(rows.reduce((s, r) => s + r.balance, 0));
    const assets = of('Asset', 1);
    const liabilities = of('Liability', -1);
    const equity = of('Equity', -1);
    const revenue = round2(-tb.accounts.filter((a) => a.type === 'Revenue').reduce((s, a) => s + a.net, 0));
    const expense = round2(tb.accounts.filter((a) => a.type === 'COGS' || a.type === 'Expense').reduce((s, a) => s + a.net, 0));
    const profit = round2(revenue - expense);
    return {
      assets, liabilities, equity, revenue, expense, profit,
      totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity: round2(sum(equity) + profit),
      difference: round2(sum(assets) - sum(liabilities) - sum(equity) - profit),
    };
  }

  /** open receivables by how far past due they are, as of today */
  async agedReceivables() {
    const [{ rows }, s] = await Promise.all([this.receivables(), this.settings.get()]);
    const asOf = new Date().toISOString().slice(0, 10);
    const day = 86_400_000;
    // the day limits come from Settings & Data, e.g. [30, 60, 90] -> 1-30, 31-60, 61-90, over 90
    const limits = (s.agingBuckets?.length ? s.agingBuckets : [30, 60, 90]).map(Number);
    const buckets = [
      'Not yet due',
      ...limits.map((hi, i) => `${i === 0 ? 1 : limits[i - 1] + 1}-${hi} days`),
      `Over ${limits[limits.length - 1]} days`,
    ];
    const aged = rows.map((r) => {
      const overdue = Math.floor((Date.parse(asOf) - Date.parse(String(r.dueDate).slice(0, 10))) / day);
      const bucket = overdue <= 0 ? 0 : (limits.findIndex((hi) => overdue <= hi) + 1 || limits.length + 1);
      return { ...r, daysOverdue: Math.max(0, overdue), bucket: buckets[bucket], bucketIndex: bucket };
    });
    return {
      asOf,
      total: round2(aged.reduce((s, r) => s + r.outstanding, 0)),
      buckets: buckets.map((label, i) => ({ label, total: round2(aged.filter((r) => r.bucketIndex === i).reduce((s, r) => s + r.outstanding, 0)) })),
      rows: aged,
    };
  }

  async cashBook(period: Period = 'all') {
    const rows: any[] = await this.db.query(
      `SELECT l.id, to_char(l."entryDate", 'YYYY-MM-DD') AS date, l.reference, l.description, l.source,
              l.debit::float8 AS "cashIn", l.credit::float8 AS "cashOut"
         FROM ledger_entries l JOIN accounts a ON a.code = l."accountCode"
        WHERE a.name = 'Cash & Bank' ORDER BY l."entryDate", l.seq`,
    );
    let balance = 0;
    const all = rows.map((r) => ({ ...r, balance: (balance = round2(balance + r.cashIn - r.cashOut)) }));
    return period === 'all' ? all : all.filter((r) => r.date.slice(0, 7) === period);
  }

  journal(period: Period = 'all') {
    return this.db.query(
      `SELECT l.id, to_char(l."entryDate", 'YYYY-MM-DD') AS date, l.source, l.reference, l.description,
              a.code AS "accountCode", a.name AS account, l.debit::float8 AS debit, l.credit::float8 AS credit
         FROM ledger_entries l JOIN accounts a ON a.code = l."accountCode"
        WHERE $1::text = 'all' OR to_char(l."entryDate", 'YYYY-MM') = $1::text
        ORDER BY l."entryDate" DESC, l.seq DESC`,
      [period],
    );
  }

  /**
   * Where cash came from and where it went, grouped by kind of document
   * (capital, distributor collections, approved spend, bills paid, manufacturer payments ...).
   * Built from the "Cash & Bank" lines of the ledger, so it always adds up to the cash balance.
   */
  async cashFlows() {
    const rows: { label: string; cashIn: number; cashOut: number }[] = await this.db.query(`
      SELECT
        CASE
          WHEN l."refType" = 'COLLECTION'     THEN 'Distributor collections'
          WHEN l."refType" = 'MFR_PAYMENT'    THEN 'Manufacturer payments'
          WHEN l."refType" = 'EXPORT_RECEIPT' THEN 'Export receipts'
          WHEN l."refType" = 'EXPORT_COST'    THEN 'Export costs paid'
          WHEN l."refType" = 'VOUCHER'        THEN 'Journal vouchers'
          WHEN l."refType" = 'FUNDING_REPAY'  THEN 'Loan and advance repayments'
          WHEN l."refType" = 'FINANCE' THEN
            CASE f.type
              WHEN 'Capital Injection'  THEN CASE f.direction WHEN 'out' THEN 'Advances paid to partners' ELSE 'Capital and partner loans' END
              WHEN 'Other Receipt'      THEN 'Other receipts'
              WHEN 'Operating Expense'  THEN 'Approved operating expenses'
              ELSE 'Capital asset purchases'
            END
          WHEN l."refType" = 'ACC_SETTLEMENT' THEN
            CASE d.kind WHEN 'Income' THEN 'Other income collected' ELSE 'Bills paid' END
          ELSE l."refType"
        END AS label,
        COALESCE(SUM(l.debit), 0)::float8  AS "cashIn",
        COALESCE(SUM(l.credit), 0)::float8 AS "cashOut"
      FROM ledger_entries l
      JOIN accounts a ON a.code = l."accountCode" AND a.name = 'Cash & Bank'
      LEFT JOIN finance_entries f ON l."refType" = 'FINANCE' AND f.id = l."refId"
      LEFT JOIN accounting_settlements s ON l."refType" = 'ACC_SETTLEMENT' AND s.id = l."refId"
      LEFT JOIN accounting_documents d ON d.id = s."documentId"
      GROUP BY 1
      ORDER BY 1`);
    const inflows = rows.filter((r) => r.cashIn > 0).map((r) => ({ label: r.label, amount: round2(r.cashIn) }));
    const outflows = rows.filter((r) => r.cashOut > 0).map((r) => ({ label: r.label, amount: round2(r.cashOut) }));
    const cashIn = round2(inflows.reduce((n, r) => n + r.amount, 0));
    const cashOut = round2(outflows.reduce((n, r) => n + r.amount, 0));
    return { inflows, outflows, cashIn, cashOut, net: round2(cashIn - cashOut) };
  }

  async periods(): Promise<string[]> {
    const rows: { p: string }[] = await this.db.query(`SELECT DISTINCT to_char("entryDate", 'YYYY-MM') AS p FROM ledger_entries ORDER BY p DESC`);
    return rows.map((r) => r.p);
  }

  // ───────────── stock ─────────────

  async stock() {
    const [products, stock, s] = await Promise.all([
      this.db.query(`SELECT id, sku, name, pack, "packsPerCarton", active FROM products ORDER BY sku`),
      this.stockSvc.stockByProduct(),
      this.settings.get(),
    ]);
    return products.map((p: any) => {
      const cartons = stock[p.id] ?? 0;
      const packs = cartons * (p.packsPerCarton || s.packsPerCarton);
      return { productId: p.id, sku: p.sku, name: p.name, pack: p.pack, cartons, packs, low: cartons < s.lowStockCartons, active: p.active };
    });
  }

  // ───────────── money owed ─────────────

  async receivables() {
    const [orders, docs, shipments, dis] = await Promise.all([
      this.orders.list(), this.accounting.list(), this.exportsSvc.list(), this.distInvoices.list({ id: '', name: 'system', role: 'Admin' }),
    ]);
    const rows = [
      ...dis.filter((i) => i.status === 'Verified' && i.due > 0.01).map((i) => ({
        reference: i.refNo, type: 'Distributor sales', party: i.distributor.name, date: i.date, dueDate: i.dueDate ?? i.date, outstanding: i.due,
      })),
      ...shipments.filter((e) => e.status === 'Shipped' && e.due > 0.01).map((e) => ({
        reference: e.refNo, type: `Export · ${e.currency}`, party: e.buyer,
        date: e.shipDate ?? e.date, dueDate: e.shipDate ?? e.date, outstanding: round2(e.due * Number(e.fxRate)),
      })),
      ...orders.filter((o) => o.status === 'Dispatched' && o.outstanding > 0.01).map((o) => ({
        reference: o.refNo, type: 'Distributor invoice', party: o.distributor.name,
        date: o.dispatchDate ?? o.date, dueDate: o.dueDate, outstanding: o.outstanding,
      })),
      ...docs.filter((d) => d.kind === 'Income' && d.approved && d.due > 0.01).map((d) => ({
        reference: d.refNo, type: 'Other income', party: d.party, date: d.date, dueDate: d.dueDate ?? d.date, outstanding: d.due,
      })),
    ].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return { total: round2(rows.reduce((s, r) => s + r.outstanding, 0)), rows };
  }

  async payables() {
    const [docs, batches, shipments] = await Promise.all([this.accounting.list(), this.batches.list(), this.exportsSvc.list()]);
    const rows = [
      ...shipments.filter((e) => e.status === 'Shipped' && e.costDue > 0.01).map((e) => ({
        reference: e.refNo, type: 'Export costs', party: `Export logistics · ${e.buyer}`,
        dueDate: e.shipDate ?? e.date, outstanding: e.costDue,
      })),
      ...docs.filter((d) => d.kind === 'Expense' && d.approved && d.due > 0.01).map((d) => ({
        reference: d.refNo, type: d.category, party: d.party, dueDate: d.dueDate ?? d.date, outstanding: d.due,
      })),
      ...batches.filter((b) => b.status === 'Released' && b.due > 0.01).map((b) => ({
        reference: b.refNo, type: 'Manufacturer', party: b.manufacturer.name, dueDate: b.date, outstanding: b.due,
      })),
      // production orders: goods received and not yet covered by what was paid on the order
      ...(await this.db.query(`
        SELECT o."refNo" AS reference, m.name AS party, MAX(s."receivedDate")::text AS "dueDate",
               (SUM(s."receivedContainers" * s."bundlesPerContainer" * s."packetsPerBundle" * s.rate)
                - LEAST(SUM(s."receivedContainers" * s."bundlesPerContainer" * s."packetsPerBundle" * s.rate),
                        COALESCE((SELECT SUM(p.amount) FROM mfr_request_payments p JOIN mfr_payment_requests r ON r.id = p."requestId" WHERE r."orderId" = o.id), 0)))::float8 AS outstanding
          FROM production_shipments s JOIN production_orders o ON o.id = s."orderId" JOIN manufacturers m ON m.id = o."manufacturerId"
         WHERE s.status = 'Received' GROUP BY o.id, o."refNo", m.name`) as { reference: string; party: string; dueDate: string; outstanding: number }[])
        .filter((r) => Number(r.outstanding) > 0.01)
        .map((r) => ({ ...r, type: 'Manufacturer', outstanding: round2(Number(r.outstanding)) })),
    ].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return { total: round2(rows.reduce((s, r) => s + r.outstanding, 0)), rows };
  }

  // ───────────── budgets and alerts ─────────────

  async budgets() {
    const [centers, entries, docs] = await Promise.all([
      this.db.query(`SELECT id, name, budget::float8 AS budget, "streamType", "depreciationRate"::float8 AS "depreciationRate" FROM categories WHERE kind = 'COST_CENTER' ORDER BY name`),
      this.finance.list(),
      this.accounting.list(),
    ]);
    return centers.map((c: any) => {
      const spent = round2(
        entries.filter((f) => f.category === c.name && f.needsApproval && f.approved).reduce((s, f) => s + Number(f.amount), 0) +
        docs.filter((d) => d.kind === 'Expense' && d.category === c.name && d.approved).reduce((s, d) => s + Number(d.amount), 0),
      );
      return { ...c, spent, usedPct: Math.round((spent / Math.max(1, c.budget)) * 100) };
    });
  }

  async alerts() {
    const [docs, entries, stock, orders, batches, mos, prs, shs, dis] = await Promise.all([
      this.accounting.list(), this.finance.list(), this.stock(), this.orders.list(), this.batches.list(),
      this.productionOrders.list({ id: '', name: 'system', role: 'Admin' }),
      this.paymentRequests.list({ id: '', name: 'system', role: 'Admin' }),
      this.shipments.list({ id: '', name: 'system', role: 'Admin' }),
      this.distInvoices.list({ id: '', name: 'system', role: 'Admin' }),
    ]);
    const s = await this.settings.get();
    return [
      ...docs.filter((d) => d.needsApproval && !d.approved).map((d) => ({
        kind: 'approval', page: 'accounting', title: `Accounting expense approval · ${d.category}`,
        text: `PKR ${d.amount} for ${d.party} · ${d.signatures.length}/${d.requiredSignatures} approvals`,
      })),
      ...entries.filter((f) => f.needsApproval && !f.approved).map((f) => ({
        kind: 'approval', page: 'finance', title: `Approval required · ${f.category}`,
        text: `PKR ${f.amount} for ${f.party} · ${f.signatures.length}/${f.requiredSignatures} approvals`,
      })),
      // manufacturer payment requests: waiting for signatures, or approved and not yet paid
      ...prs.filter((r) => r.status === 'Submitted' && !r.approved).map((r) => ({
        kind: 'approval', page: 'manufacturing', title: `Manufacturer payment request · ${r.refNo}`,
        text: `PKR ${r.amount} ${r.kind.toLowerCase()} for ${r.manufacturer.name} (${r.order.refNo}) · ${r.signatures.length}/${r.requiredSignatures} approvals`,
      })),
      ...prs.filter((r) => r.approved && r.due > 0).map((r) => ({
        kind: 'payment', page: 'manufacturing', title: `Approved, not paid · ${r.refNo}`,
        text: `PKR ${r.due} to ${r.manufacturer.name} · ${r.bank.bank} ${r.bank.account}`,
      })),
      ...entries.filter((f) => f.type === 'Capital Injection' && f.chequeStatus === 'Pending').map((f) => ({
        kind: 'cheque', page: 'finance', title: `Cheque awaiting clearance · ${f.party}`,
        text: `PKR ${f.amount} · cheque ${f.chequeNo} · clears ${f.clearanceDate}`,
      })),
      // a loan or advance that is fully paid back no longer needs a reminder
      ...entries.filter((f) => f.type === 'Capital Injection' && f.cleared && f.expectedReturnDate && returnDue(f.expectedReturnDate) && (!f.liability || f.outstanding > 0)).map((f) => ({
        kind: 'return', page: 'finance', title: f.direction === 'out' ? `Advance due back · ${f.party}` : `Investor return due · ${f.party}`,
        text: f.liability
          ? `PKR ${f.outstanding} still outstanding of PKR ${f.amount} · due ${f.expectedReturnDate}`
          : `PKR ${f.amount} invested ${f.date} · expected back ${f.expectedReturnDate}`,
      })),
      ...stock.filter((p: any) => p.active && p.low).map((p: any) => ({
        kind: 'stock', page: 'manufacturing', title: `Low stock · ${p.sku}`,
        text: `${p.cartons} bundles available · replenish below ${s.lowStockCartons}`,
      })),
      ...orders.filter((o) => o.status === 'Draft').map((o) => ({
        kind: 'order', page: 'distribution', title: `Undispatched order · ${o.refNo}`,
        text: `${o.cartons} bundles for ${o.distributor.name}`,
      })),
      // distributor sales invoices: to verify, and overdue
      ...dis.filter((i) => i.status === 'Submitted').map((i) => ({
        kind: 'invoice', page: 'distribution', title: `Sales invoice to verify · ${i.refNo}`,
        text: `${i.distributor.name}: ${i.containers} container${i.containers > 1 ? 's' : ''} sold · PKR ${i.amount}`,
      })),
      ...dis.filter((i) => i.overdue).map((i) => ({
        kind: 'receivable', page: 'distribution', title: `Overdue · ${i.refNo}`,
        text: `${i.distributor.name} owes PKR ${i.due} · due ${i.dueDate}`,
      })),
      // shipments on the road, and distributor stock past its sell-by date
      ...shs.filter((s) => s.status === 'In transit').map((s) => ({
        kind: 'delivery', page: 'distribution', title: `Shipment to receive · ${s.refNo}`,
        text: `${s.containers} container${s.containers > 1 ? 's' : ''} of ${s.product.sku} for ${s.destination === 'Warehouse' ? 'the warehouse' : s.distributor?.name} · sent ${s.shipDate}`,
      })),
      ...shs.filter((s) => s.overdue).map((s) => ({
        kind: 'sellout', page: 'distribution', title: `Sell-out date passed · ${s.refNo}`,
        text: `${s.distributor?.name}: ${s.onHandContainers} container${s.onHandContainers > 1 ? 's' : ''} of ${s.product.sku} were due to be sold by ${s.sellBy}`,
      })),
      // production orders: waiting for the manufacturer, refused by it, or late
      ...mos.filter((o) => o.status === 'Sent').map((o) => ({
        kind: 'production', page: 'manufacturing', title: `Waiting for ${o.manufacturer.name} · ${o.refNo}`,
        text: `${o.containers} container${o.containers > 1 ? 's' : ''} of ${o.product.sku} · not accepted yet`,
      })),
      ...mos.filter((o) => o.status === 'Rejected').map((o) => ({
        kind: 'production', page: 'manufacturing', title: `Order rejected · ${o.refNo}`,
        text: `${o.manufacturer.name}: ${o.reason ?? 'no reason given'}`,
      })),
      ...mos.filter((o) => o.overdue).map((o) => ({
        kind: 'production', page: 'manufacturing', title: `Production late · ${o.refNo}`,
        text: `Due ${o.dueDate} · ${o.stage ?? 'no progress reported'}`,
      })),
      ...batches.filter((b) => b.status === 'Planned').map((b) => ({
        kind: 'batch', page: 'manufacturing', title: `Batch awaiting release · ${b.refNo}`,
        text: `${b.targetCartons} target bundles · ${b.qc} QC`,
      })),
      ...(await this.intlAlerts()),
    ];
  }

  /** international distributors: claims, market approvals and payment advices to decide, export invoices overdue */
  private async intlAlerts() {
    const q = (sql: string) => this.db.query(sql) as Promise<any[]>;
    const [claims, approvals, advices, overdue] = await Promise.all([
      q(`SELECT c."refNo", c.kind, c.quantity, x."refNo" AS ship, COALESCE(d.name, x.buyer) AS who FROM export_claims c JOIN export_shipments x ON x.id = c."shipmentId"
           LEFT JOIN distributors d ON d.id = c."distributorId" WHERE c.status = 'Submitted' ORDER BY c.date`),
      q(`SELECT a.country, p.sku FROM product_market_approvals a JOIN products p ON p.id = a."productId" WHERE a.status = 'Pending' ORDER BY a."createdAt"`),
      q(`SELECT a."refNo", a.currency, a.amount::float8 AS amount, d.name FROM remittance_advices a JOIN distributors d ON d.id = a."distributorId" WHERE a.status = 'Submitted' ORDER BY a.date`),
      q(`SELECT x."refNo", x."dueDate"::text AS due, d.name FROM export_shipments x JOIN distributors d ON d.id = x."distributorId"
           WHERE x.status = 'Shipped' AND x."dueDate" < CURRENT_DATE ORDER BY x."dueDate"`),
    ]);
    const open = new Set((await this.exportsSvc.list()).filter((x) => x.overdue).map((x) => x.refNo));
    return [
      ...claims.map((c) => ({ kind: 'claim', page: 'exports', title: `Claim to decide · ${c.refNo}`, text: `${c.who}: ${c.kind.toLowerCase()}, ${c.quantity} bundle(s) of ${c.ship}` })),
      ...approvals.map((a) => ({ kind: 'approval', page: 'exports', title: `Market approval to review · ${a.sku}`, text: `${a.sku} for ${a.country}` })),
      ...advices.map((a) => ({ kind: 'payment', page: 'exports', title: `Payment advice · ${a.refNo}`, text: `${a.name} says it paid ${a.currency} ${a.amount}` })),
      ...overdue.filter((x) => open.has(x.refNo)).map((x) => ({ kind: 'receivable', page: 'exports', title: `Export invoice overdue · ${x.refNo}`, text: `${x.name} · due ${x.due}` })),
    ];
  }

  // ───────────── the business chain ─────────────

  /**
   * One figure set per link of Investor -> Company -> Manufacturer -> Distributor -> Customer:
   * money invested, cash held, what is on order and owed to manufacturers, stock held by distributors,
   * and the sales they invoiced and paid.
   */
  async chain() {
    const sys = { id: '', name: 'system', role: 'Admin' as const };
    const [cash, advance, payable, distStock, capital, mos, lots, dis] = await Promise.all([
      this.accountNet('Cash & Bank'), this.accountNet('Advance to Manufacturer'), this.accountNet('Manufacturer Payable'),
      this.accountNet('Inventory at Distributor'),
      this.db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS total, COUNT(DISTINCT party)::int AS investors
                       FROM finance_entries WHERE type = 'Capital Injection' AND direction = 'in' AND "chequeStatus" IN ('', 'Cleared')`),
      this.productionOrders.list(sys), this.shipments.list(sys), this.distInvoices.list(sys),
    ]);
    const open = mos.filter((o) => o.status === 'Accepted' && o.receivedContainers < o.containers);
    const verified = dis.filter((i) => i.status === 'Verified');
    const held = lots.filter((s) => s.status === 'Received' && s.destination === 'Distributor');
    return {
      investors: { capital: round2(capital[0].total), investors: Number(capital[0].investors) },
      company: { cash: round2(cash) },
      manufacturers: {
        openOrders: open.length,
        containersOnOrder: open.reduce((n, o) => n + o.containers - o.receivedContainers, 0),
        valueOnOrder: round2(open.reduce((n, o) => n + (o.value * (o.containers - o.receivedContainers)) / o.containers, 0)),
        waiting: mos.filter((o) => o.status === 'Sent').length,
        inTransit: lots.filter((s) => s.status === 'In transit').reduce((n, s) => n + s.containers, 0),
        advances: round2(advance),
        owed: round2(-payable),
      },
      distributors: {
        containersHeld: held.reduce((n, s) => n + s.onHandContainers, 0),
        stockValue: round2(distStock),
        overdueLots: held.filter((s) => s.overdue).length,
        toVerify: dis.filter((i) => i.status === 'Submitted').length,
      },
      customers: {
        containersSold: verified.reduce((n, i) => n + i.containers, 0),
        invoiced: round2(verified.reduce((n, i) => n + Number(i.amount), 0)),
        collected: round2(verified.reduce((n, i) => n + i.paid, 0)),
        receivable: round2(verified.reduce((n, i) => n + i.due, 0)),
        margin: round2(verified.reduce((n, i) => n + i.margin, 0)),
      },
    };
  }

  // ───────────── dashboard ─────────────

  async dashboard() {
    const [cash, ar, ap, profit, stock, alerts, orders, s, capital] = await Promise.all([
      this.accountNet('Cash & Bank'),
      this.accountNet('Accounts Receivable'),
      this.accountNet('Accounts Payable'),
      this.incomeStatement('all'),
      this.stock(),
      this.alerts(),
      this.orders.list(),
      this.settings.get(),
      this.db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM finance_entries WHERE type = 'Capital Injection' AND direction = 'in' AND "chequeStatus" IN ('', 'Cleared')`),
    ]);
    return {
      cash,
      stockCartons: stock.reduce((n: number, p: any) => n + p.cartons, 0),
      stockPacks: stock.reduce((n: number, p: any) => n + p.packs, 0),
      netProfit: profit.netProfit,
      openReceivables: ar,
      payables: round2(-ap),
      capitalRaised: round2(capital[0].total),
      capitalTarget: s.capitalTarget,
      pendingApprovals: alerts.filter((a) => a.kind === 'approval').length,
      alerts,
      latestOrders: orders.slice(0, 5).map((o) => ({
        id: o.id, refNo: o.refNo, date: o.date, distributor: o.distributor.name, sku: o.product.sku,
        cartons: o.cartons, value: o.billed, status: o.status,
      })),
    };
  }
}
