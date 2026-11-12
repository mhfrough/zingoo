/**
 * Loads the client's sample data through the real services, so every ledger line is posted
 * exactly as it would be for a normal entry. Then checks the result against the prototype's numbers.
 *
 *   npm run seed          empty database only
 *   npm run seed:fresh    wipes the schema first (npm run db:reset), then seeds
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { DistributorsService, ManufacturersService, ProductsService } from '../catalog/catalog.service';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';
import { CollectionsService, OrdersService } from '../distribution/distribution.service';
import { AccountingService, FinanceService } from '../finance/finance.service';
import { BatchesService } from '../manufacturing/manufacturing.service';
import { PortalRequest } from '../portal/portal.entities';
import { ReportsService } from '../reports/reports.service';
import { Account, Category, ContainerType, Currency } from '../setup/setup.entities';
import {
  CONTAINER_TYPES, COST_CENTERS, CURRENCIES, EXPENSE_CATEGORIES, INCOME_CATEGORIES, STARTER_ACCOUNTS,
} from '../setup/setup.constants';
import { SettingsService } from '../setup/setup.service';
import { UsersService } from '../users/users.service';
import * as data from './seed-data';

const SYSTEM = { id: null, seat: 'Both' };

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(DataSource);

  try {
    // (the root account is created at start-up, so "users" is never empty here; look at real data instead)
    if ((await db.query('SELECT 1 FROM manufacturers LIMIT 1')).length) {
      console.log('Database already has data. Run `npm run seed:fresh` to wipe it and start over.');
      return;
    }
    const password = process.env.SEED_PASSWORD;
    if (!password) throw new Error('SEED_PASSWORD is missing in .env');

    // ── setup ──
    await app.get(SettingsService).get();
    await db.getRepository(Currency).save(CURRENCIES);
    await db.getRepository(ContainerType).save(CONTAINER_TYPES);
    await db.getRepository(Account).save(STARTER_ACCOUNTS.map(([code, name, type]) => ({ code, name, type, active: true })));
    const cats = db.getRepository(Category);
    await cats.save([
      ...Object.entries(COST_CENTERS).map(([name, budget]) => cats.create({ kind: 'COST_CENTER', name, budget })),
      ...INCOME_CATEGORIES.map((name) => cats.create({ kind: 'INCOME', name, budget: 0 })),
      ...EXPENSE_CATEGORIES.map((name) => cats.create({ kind: 'EXPENSE', name, budget: 0 })),
    ]);

    // ── masters ──
    const id: Record<string, string> = {};
    for (const m of data.manufacturers) {
      const { key, ...rest } = m;
      id[key] = ((await app.get(ManufacturersService).create(rest)) as Manufacturer).id;
    }
    for (const d of data.distributors) {
      const { key, ...rest } = d;
      id[key] = ((await app.get(DistributorsService).create(rest)) as Distributor).id;
    }
    // each SKU is assigned its manufacturer and distributor
    for (const p of data.products) {
      const { key, manufacturer, distributor, ...rest } = p;
      id[key] = ((await app.get(ProductsService).create({ ...rest, manufacturerId: id[manufacturer], distributorId: id[distributor] })) as Product).id;
    }
    for (const u of data.users) {
      await app.get(UsersService).createUser({
        email: u.email, name: u.name, password, role: u.role, seat: u.seat,
        distributorId: 'distributor' in u ? id[u.distributor] : null,
      });
    }

    // ── manufacturing: batches, released ones go into stock ──
    const batches = app.get(BatchesService);
    for (const b of data.batches) {
      const row = await batches.create(
        { date: b.date, productId: id[b.product], manufacturerId: id[b.manufacturer], targetCartons: b.targetCartons,
          producedCartons: b.producedCartons, cost: b.cost, qc: b.qc, notes: b.notes },
        { refNo: b.refNo },
      );
      if (b.release) await batches.release(row.id);
    }

    // ── distribution: orders, dispatch, collections ──
    const orders = app.get(OrdersService);
    const orderId: Record<string, string> = {};
    for (const o of data.orders) {
      const row = await orders.create(
        { date: o.date, distributorId: id[o.distributor], productId: id[o.product], cartons: o.cartons, rate: o.rate },
        { refNo: o.refNo },
      );
      orderId[o.refNo] = row.id;
      if (o.dispatch) await orders.dispatch(row.id, { dispatchDate: o.date });
    }
    for (const c of data.collections) {
      await app.get(CollectionsService).create(
        { orderId: orderId[c.order], date: c.date, amount: c.amount, method: c.method, note: c.note },
        { refNo: c.refNo },
      );
    }

    // ── finance + accounting, with their signatures ──
    const finance = app.get(FinanceService);
    for (const f of data.finance) {
      const row = await finance.create(
        { date: f.date, type: f.type, category: f.category, amount: f.amount, party: f.party, note: f.note, funding: f.funding },
        { refNo: f.refNo },
      );
      for (const seat of f.signed) {
        if (row.needsApproval) await finance.sign(row.id, seat as 'A' | 'B', SYSTEM, true).catch(() => undefined);
      }
    }
    const accounting = app.get(AccountingService);
    for (const a of data.accounting) {
      const row = await accounting.create(
        { date: a.date, kind: a.kind, category: a.category, foreignAmount: a.foreignAmount, party: a.party, dueDate: a.dueDate, note: a.note },
        { refNo: a.refNo },
      );
      for (const seat of a.signed) {
        if (row.needsApproval) await accounting.sign(row.id, seat as 'A' | 'B', SYSTEM, true).catch(() => undefined);
      }
    }

    // ── partner portal (tables only for now) ──
    const reqs = db.getRepository(PortalRequest);
    for (const r of data.portalRequests) {
      await reqs.save(reqs.create({
        refNo: r.refNo, date: r.date, distributorId: id[r.distributor], productId: id[r.product], cartons: r.cartons,
        requestedDate: r.requestedDate, notes: r.notes, status: r.status,
      }));
    }

    // ── summary + parity check ──
    console.log('Seeded:');
    for (const t of ['users', 'manufacturers', 'products', 'distributors', 'production_batches', 'sales_orders', 'collections',
      'finance_entries', 'approvals', 'accounting_documents', 'accounts', 'categories', 'currencies', 'ledger_entries']) {
      const [{ c }] = await db.query(`SELECT COUNT(*) AS c FROM ${t}`);
      console.log(`  ${t.padEnd(22)} ${c}`);
    }

    const reports = app.get(ReportsService);
    const dash = await reports.dashboard();
    const tb = await reports.trialBalance();
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const checks: [string, boolean, unknown, unknown][] = [
      ['Cash available', near(dash.cash, data.PARITY.cash), dash.cash, data.PARITY.cash],
      ['Stock cartons', dash.stockCartons === data.PARITY.stockCartons, dash.stockCartons, data.PARITY.stockCartons],
      ['Stock packs', dash.stockPacks === data.PARITY.stockPacks, dash.stockPacks, data.PARITY.stockPacks],
      ['Net profit', near(dash.netProfit, data.PARITY.netProfit), dash.netProfit, data.PARITY.netProfit],
      ['Open receivables', near(dash.openReceivables, data.PARITY.openReceivables), dash.openReceivables, data.PARITY.openReceivables],
      ['Capital raised', near(dash.capitalRaised, data.PARITY.capitalRaised), dash.capitalRaised, data.PARITY.capitalRaised],
      ['Alerts', dash.alerts.length === data.PARITY.alerts, dash.alerts.length, data.PARITY.alerts],
      ['Pending approvals', dash.pendingApprovals === data.PARITY.pendingApprovals, dash.pendingApprovals, data.PARITY.pendingApprovals],
      ['Ledger balanced', tb.balanced, `${tb.totalDebit} / ${tb.totalCredit}`, 'debit = credit'],
    ];
    for (const [ref, expected] of Object.entries(data.PARITY.orderValues)) {
      const o = (await orders.list()).find((x) => x.refNo === ref);
      checks.push([`Order ${ref} value`, !!o && near(o.billed, expected), o?.billed, expected]);
    }
    console.log('\nParity with the client prototype:');
    for (const [label, ok, got, want] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(20)} got ${got}  expected ${want}`);
    if (checks.some((c) => !c[1])) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
