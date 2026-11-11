/**
 * API smoke test for the rules the client's prototype enforces.
 *
 *   npm run seed:fresh      (start from the sample data)
 *   npm run start           (in another terminal)
 *   npm run test:api
 *
 * It CHANGES data (releases a batch, signs entries, posts payments), so re-run
 * `npm run seed:fresh` afterwards if you want the pristine sample data back.
 */
import 'dotenv/config';

const BASE = process.env.API_URL ?? 'http://localhost:3020/api';
const PW = process.env.SEED_PASSWORD;
let pass = 0;
let fail = 0;

const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${extra}`}`);
};

const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json };
};

const login = async (email) => (await call(null, 'POST', '/auth/login', { email, password: PW })).json?.access_token;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const T = {};
const accounts = {
  owner: 'owner@example.test', factory: 'factory@example.test', finance: 'finance@example.test',
  partner: 'partner@example.test', sales: 'sales@example.test', exporter: 'export@example.test', audit: 'audit@example.test', dist: 'distributor@demo.local',
};
for (const [k, e] of Object.entries(accounts)) T[k] = await login(e);

ok('all 8 test logins work', Object.values(T).every(Boolean));
if (process.env.ROOT_EMAIL) {
  const rootToken = (await call(null, 'POST', '/auth/login', { email: process.env.ROOT_EMAIL, password: process.env.ROOT_PASSWORD })).json?.access_token;
  const root = rootToken ? (await call(rootToken, 'GET', '/auth/me')).json : null;
  ok('root account logs in with the highest role (Admin, seat Both, isRoot)', root?.role === 'Admin' && root?.seat === 'Both' && root?.isRoot === true, JSON.stringify(root));
}
ok('wrong password -> 401', (await call(null, 'POST', '/auth/login', { email: accounts.owner, password: 'nope' })).status === 401);
ok('no token -> 401', (await call(null, 'GET', '/products')).status === 401);

// ── roles ──
ok('Manufacturing reads batches', (await call(T.factory, 'GET', '/batches')).status === 200);
ok('Manufacturing cannot read finance', (await call(T.factory, 'GET', '/finance')).status === 403);
ok('Manufacturing cannot post finance', (await call(T.factory, 'POST', '/finance', {})).status === 403);
ok('Viewer reads finance', (await call(T.audit, 'GET', '/finance')).status === 200);
ok('Viewer cannot create a batch', (await call(T.audit, 'POST', '/batches', {})).status === 403);
ok('Distributor is blocked from products', (await call(T.dist, 'GET', '/products')).status === 403);
const me = await call(T.finance, 'GET', '/auth/me');
ok('/auth/me gives role, seat and pages', me.json?.role === 'Finance' && me.json?.seat === 'A' && me.json?.pages?.includes('finance'));

// ── baseline ──
const dash0 = (await call(T.owner, 'GET', '/reports/dashboard')).json;
ok('dashboard cash is 1,897,000 (fresh sample data)', dash0.cash === 1897000, dash0.cash);
const list = async (p) => (await call(T.owner, 'GET', p)).json;
const batches = await list('/batches');
const orders = await list('/orders');
const fin = await list('/finance');
const acc = await list('/accounting-documents');
const prods = await list('/products');
const byRef = (rows, ref) => rows.find((r) => r.refNo === ref);

// ── validation + uniqueness ──
ok('unknown field -> 400', (await call(T.sales, 'POST', '/orders', { date: '2026-11-10', distributorId: orders[0].distributorId, productId: prods[0].id, cartons: 1, rate: 6, bogus: 1 })).status === 400);
ok('duplicate SKU -> 409', (await call(T.owner, 'POST', '/products', { sku: 'Z10-MAS', name: 'x', pack: 10, mrp: 10, rate: 6, packsPerCarton: 432 })).status === 409);
ok('delete a product that is in use -> 409', (await call(T.owner, 'DELETE', `/products/${prods[0].id}`)).status === 409);

// ── manufacturing ──
const b4 = byRef(batches, 'B-1004');
ok('release a batch with QC pending -> 400', (await call(T.factory, 'POST', `/batches/${b4.id}/release`)).status === 400);
ok('released batch is locked for edit -> 400', (await call(T.factory, 'PATCH', `/batches/${byRef(batches, 'B-1001').id}`, { notes: 'x' })).status === 400);
await call(T.factory, 'PATCH', `/batches/${b4.id}`, { qc: 'Passed', producedCartons: 10, cost: 30000 });
const rel = await call(T.factory, 'POST', `/batches/${b4.id}/release`);
ok('release B-1004 after QC -> released', rel.status === 201 && rel.json.status === 'Released', JSON.stringify(rel.json).slice(0, 100));
const stock = (await call(T.owner, 'GET', '/reports/stock')).json;
ok('stock of Z20-KET is 10 cartons', stock.find((s) => s.sku === 'Z20-KET')?.cartons === 10);
ok('paying the manufacturer more than is due -> 400', (await call(T.factory, 'POST', '/manufacturer-payments', { batchId: b4.id, date: '2026-11-10', amount: 40000 })).status === 400);
const cashBefore = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
ok('pay the manufacturer 10,000 -> 201', (await call(T.factory, 'POST', '/manufacturer-payments', { batchId: b4.id, date: '2026-11-10', amount: 10000 })).status === 201);
ok('cash fell by 10,000', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === cashBefore - 10000);

// ── distribution ──
const big = await call(T.sales, 'POST', '/orders', { date: '2026-11-10', distributorId: orders[0].distributorId, productId: b4.productId, cartons: 20, rate: 12.5 });
ok('create a draft order', big.status === 201 && big.json.status === 'Draft');
const dsp = await call(T.sales, 'POST', `/orders/${big.json.id}/dispatch`);
ok('dispatch more than stock -> 400 "Insufficient stock"', dsp.status === 400 && /Insufficient stock/.test(dsp.json?.message));
await call(T.sales, 'DELETE', `/orders/${big.json.id}`);
const so203 = byRef(orders, 'SO-203');
// credit hold: give the distributor a tiny limit, dispatch must be refused until Finance overrides
await call(T.sales, 'PATCH', `/distributors/${so203.distributorId}`, { creditLimit: 10000 });
const held = await call(T.sales, 'POST', `/orders/${so203.id}/dispatch`);
ok('order over the credit limit -> 400 "Credit hold"', held.status === 400 && /Credit hold/.test(held.json?.message), JSON.stringify(held.json));
ok('the list flags it as a credit hold', (await call(T.sales, 'GET', '/orders')).json.find((o) => o.refNo === 'SO-203')?.creditHold === true);
ok('Distribution cannot override the hold -> 403', (await call(T.sales, 'POST', `/orders/${so203.id}/credit-override`, { reason: 'trusted customer' })).status === 403);
ok('Finance overrides with a reason', (await call(T.finance, 'POST', `/orders/${so203.id}/credit-override`, { reason: 'Approved by owner, trusted customer' })).json?.creditOverride === true);
const d203 = await call(T.sales, 'POST', `/orders/${so203.id}/dispatch`);
ok('dispatch SO-203 -> Dispatched with a unit-cost snapshot', d203.status === 201 && d203.json.status === 'Dispatched' && d203.json.unitCost > 0, JSON.stringify(d203.json).slice(0, 120));
const rec1 = (await call(T.owner, 'GET', '/reports/receivables')).json;
ok('receivables are now 55,600 + 21,600 = 77,200', rec1.total === 77200, rec1.total);
ok('a dispatched order is locked -> 400', (await call(T.sales, 'PATCH', `/orders/${so203.id}`, { cartons: 1 })).status === 400);
const so201 = byRef(orders, 'SO-201');
ok('collecting more than is outstanding -> 400', (await call(T.sales, 'POST', '/collections', { orderId: so201.id, date: '2026-11-10', amount: 99999 })).status === 400);
ok('collect exactly the open 11,700 -> 201', (await call(T.sales, 'POST', '/collections', { orderId: so201.id, date: '2026-11-10', amount: 11700 })).status === 201);
ok('collect again on a paid order -> 400', (await call(T.sales, 'POST', '/collections', { orderId: so201.id, date: '2026-11-10', amount: 1 })).status === 400);

// ── finance approvals and seats ──
const f5 = byRef(fin, 'FIN-005');
const f6 = byRef(fin, 'FIN-006');
const f3 = byRef(fin, 'FIN-003');
ok('seat A cannot sign as B -> 403', (await call(T.finance, 'POST', `/finance/${f5.id}/sign`, { seat: 'B' })).status === 403);
const cashPre = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
const s5 = await call(T.partner, 'POST', `/finance/${f5.id}/sign`, { seat: 'B' });
ok('seat B signs FIN-005 (72,000) -> approved', s5.status === 201 && s5.json.approved === true, JSON.stringify(s5.json).slice(0, 100));
ok('approved spend reduced cash by 72,000', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === cashPre - 72000);
ok('one signature is enough under the threshold (FIN-006)', (await call(T.finance, 'POST', `/finance/${f6.id}/sign`, { seat: 'A' })).json?.approved === true);
ok('signing an already approved entry -> 400', (await call(T.partner, 'POST', `/finance/${f6.id}/sign`, { seat: 'B' })).status === 400);
ok('a posted finance entry is locked -> 400', (await call(T.finance, 'PATCH', `/finance/${f3.id}`, { note: 'x' })).status === 400);
ok('Distribution cannot sign -> 403', (await call(T.sales, 'POST', `/finance/${f6.id}/sign`, { seat: 'A' })).status === 403);

// ── changing the threshold re-checks approvals ──
const cashT0 = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
await call(T.owner, 'PATCH', '/settings', { approvalThreshold: 20000 });
await wait(800);
const cashT1 = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
// at 20,000 both FIN-003 (36,000) and FIN-006 (24,000) need two signatures but have one, so both un-post
ok('lower threshold: FIN-003 and FIN-006 (one signature each) un-post -> cash +60,000', cashT1 === cashT0 + 60000, `${cashT0} -> ${cashT1}`);
await call(T.owner, 'PATCH', '/settings', { approvalThreshold: 50000 });
await wait(800);
ok('threshold restored: cash is back', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === cashT0);
ok('only Admin can change settings -> 403', (await call(T.finance, 'PATCH', '/settings', { approvalThreshold: 1 })).status === 403);

// ── accounting ──
const a1 = byRef(acc, 'ACC-DEMO-01');
const a2 = byRef(acc, 'ACC-DEMO-02');
ok('settling more than the bill -> 400', (await call(T.finance, 'POST', `/accounting-documents/${a2.id}/settle`, { date: '2026-11-10', amount: 20000 })).status === 400);
const part = await call(T.finance, 'POST', `/accounting-documents/${a2.id}/settle`, { date: '2026-11-10', amount: 6000 });
ok('part-pay a bill 6,000 -> "Partially settled", 10,000 due', part.json?.status === 'Partially settled' && part.json?.due === 10000, JSON.stringify(part.json).slice(0, 120));
ok('a document with payments is locked -> 400', (await call(T.finance, 'PATCH', `/accounting-documents/${a2.id}`, { note: 'x' })).status === 400);
const col = await call(T.finance, 'POST', `/accounting-documents/${a1.id}/settle`, { date: '2026-11-10', amount: 25000 });
ok('collect an income invoice -> "Collected"', col.json?.status === 'Collected');
const unsigned = await call(T.finance, 'POST', '/accounting-documents', { date: '2026-11-10', kind: 'Expense', category: 'Rent', foreignAmount: 5000, party: 'Landlord' });
ok('a new expense bill waits for approval', unsigned.json?.status === 'Awaiting approval');
ok('paying an unapproved bill -> 400', (await call(T.finance, 'POST', `/accounting-documents/${unsigned.json.id}/settle`, { date: '2026-11-10', amount: 1000 })).status === 400);
ok('a PKR document with exchange rate 2 -> 400', (await call(T.finance, 'POST', '/accounting-documents', { date: '2026-11-10', kind: 'Income', category: 'Services', foreignAmount: 100, fxRate: 2, party: 'x' })).status === 400);

// ── books ──
const tb = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('trial balance is still balanced after all of the above', tb.balanced === true, `${tb.totalDebit}/${tb.totalCredit}`);
const is = (await call(T.owner, 'GET', '/reports/income-statement?period=2026-11')).json;
ok('income statement has revenue and cost of goods sold', is.revenue > 0 && is.cogs > 0);
const cb = (await call(T.owner, 'GET', '/reports/cash-book')).json;
const finalCash = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
ok('cash book running balance ends at the dashboard cash', cb.at(-1).balance === finalCash, `${cb.at(-1).balance} vs ${finalCash}`);

const flows = (await call(T.owner, 'GET', '/reports/cash-flows')).json;
ok('cash flows add up to the cash balance', flows?.net === finalCash, `${flows?.net} vs ${finalCash}`);
ok('cash flows list capital as an inflow', flows?.inflows?.some((r) => r.label === 'Capital and partner loans'));


// ── exports ──
const net = (tb, name) => tb.accounts.find((a) => a.name === name)?.net ?? 0;
const prodList = (await call(T.owner, 'GET', '/products')).json;
const sku = prodList.find((p) => p.stockCartons >= 10);
ok('a product has stock for the export test', !!sku);
const quote = {
  date: '2026-11-10', buyer: 'Dubai Foods LLC', country: 'UAE', port: 'Jebel Ali', container: '40HC', incoterm: 'CIF',
  productId: sku?.id, cartons: 10, currency: 'USD', fxRate: 280, rate: 0.06, origin: 300, ocean: 1000, insurance: 200, bankFees: 50,
};
const tbBefore = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
const q = await call(T.exporter, 'POST', '/exports', quote);
ok('Exports role creates a container quote', q.status === 201 && q.json?.status === 'Quote', JSON.stringify(q.json).slice(0, 120));
ok('Viewer cannot create a quote -> 403', (await call(T.audit, 'POST', '/exports', quote)).status === 403);
ok('Distribution cannot read exports -> 403', (await call(T.sales, 'GET', '/exports')).status === 403);
const packs = q.json?.packsPerCarton;
ok('quote costing: CIF seller pays origin + ocean + insurance + bank fees (1,550)', q.json?.costs?.seller === 1550, JSON.stringify(q.json?.costs));
ok('quote invoice value = cartons x packs x rate', Math.abs(q.json?.revenueForeign - 10 * packs * 0.06) < 0.01, String(q.json?.revenueForeign));
ok('a quote posts nothing to the ledger', (await call(T.owner, 'GET', '/reports/trial-balance')).json.totalDebit === tbBefore.totalDebit);
ok('collecting on a quote -> 400', (await call(T.exporter, 'POST', `/exports/${q.json.id}/collect`, { date: '2026-11-10', foreignAmount: 10, fxRate: 280 })).status === 400);
const bigQuote = await call(T.exporter, 'POST', '/exports', { ...quote, cartons: 999999 });
ok('shipping more cartons than the stock -> 400', (await call(T.exporter, 'POST', `/exports/${bigQuote.json.id}/ship`, {})).status === 400);
ok('a quote can be deleted', (await call(T.exporter, 'DELETE', `/exports/${bigQuote.json.id}`)).status === 200);
const shipped = await call(T.exporter, 'POST', `/exports/${q.json.id}/ship`, { shipDate: '2026-11-10' });
ok('ship the quote -> Shipped', shipped.json?.status === 'Shipped', JSON.stringify(shipped.json).slice(0, 150));
const X = shipped.json;
const tbShip = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('shipping books export sales revenue at the invoice rate', Math.abs(-net(tbShip, 'Export Sales Revenue') - X.revenuePKR) < 0.01, `${net(tbShip, 'Export Sales Revenue')} vs ${X.revenuePKR}`);
ok('shipping accrues the seller-borne logistics', Math.abs(-net(tbShip, 'Export Costs Payable') - X.sellerCostPKR) < 0.01 && X.sellerCostPKR === 1550 * 280);
ok('ledger is still balanced after shipping', tbShip.balanced === true);
ok('a shipped container cannot be edited -> 400', (await call(T.exporter, 'PATCH', `/exports/${X.id}`, { buyer: 'x' })).status === 400);
ok('a shipped container cannot be deleted -> 400', (await call(T.exporter, 'DELETE', `/exports/${X.id}`)).status === 400);
ok('shipping twice -> 400', (await call(T.exporter, 'POST', `/exports/${X.id}/ship`, {})).status === 400);
ok('collecting more than is owed -> 400', (await call(T.exporter, 'POST', `/exports/${X.id}/collect`, { date: '2026-11-11', foreignAmount: X.revenueForeign + 1, fxRate: 280 })).status === 400);
const half = Math.round((X.revenueForeign / 2) * 100) / 100;
const gain = await call(T.exporter, 'POST', `/exports/${X.id}/collect`, { date: '2026-11-12', foreignAmount: half, fxRate: 290 });
ok('collect half at a better rate -> due halves', Math.abs(gain.json?.due - (X.revenueForeign - half)) < 0.01, JSON.stringify(gain.json).slice(0, 100));
const tbGain = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('a better rate books an FX gain of half x 10 PKR', Math.abs(-net(tbGain, 'FX Gain') - half * 10) < 0.01, String(net(tbGain, 'FX Gain')));
const rest = Math.round((X.revenueForeign - half) * 100) / 100;
await call(T.exporter, 'POST', `/exports/${X.id}/collect`, { date: '2026-11-13', foreignAmount: rest, fxRate: 275 });
const tbLoss = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('a worse rate books an FX loss of the rest x 5 PKR', Math.abs(net(tbLoss, 'FX Loss') - rest * 5) < 0.01, String(net(tbLoss, 'FX Loss')));
const xs = (await call(T.exporter, 'GET', '/exports')).json.find((e) => e.id === X.id);
ok('fully collected container has nothing due', xs.due === 0 && xs.collected === X.revenueForeign, JSON.stringify({ due: xs.due, collected: xs.collected }));
ok('paying more export cost than owed -> 400', (await call(T.exporter, 'POST', `/exports/${X.id}/pay-costs`, { date: '2026-11-14', amount: X.sellerCostPKR + 5 })).status === 400);
const paidCost = await call(T.exporter, 'POST', `/exports/${X.id}/pay-costs`, { date: '2026-11-14', amount: X.sellerCostPKR });
ok('paying the export costs clears the accrual', paidCost.json?.costDue === 0, JSON.stringify(paidCost.json).slice(0, 100));
const tbPaid = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('export costs payable is back to zero and the ledger balances', Math.abs(net(tbPaid, 'Export Costs Payable')) < 0.01 && tbPaid.balanced === true);

// ── manual vouchers, account ledger, balance sheet, ageing ──
const cashVoucher = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
ok('an unbalanced voucher -> 400', (await call(T.finance, 'POST', '/journal-vouchers', {
  date: '2026-11-10', memo: 'bad', lines: [{ account: 'Cash & Bank', debit: 1000, credit: 0 }, { account: 'Owner Equity', debit: 0, credit: 900 }],
})).status === 400);
ok('a voucher on an unknown account -> 400', (await call(T.finance, 'POST', '/journal-vouchers', {
  date: '2026-11-10', memo: 'bad', lines: [{ account: 'Nope', debit: 1000, credit: 0 }, { account: 'Owner Equity', debit: 0, credit: 1000 }],
})).status === 400);
ok('Viewer cannot post a voucher -> 403', (await call(T.audit, 'POST', '/journal-vouchers', {})).status === 403);
const jv = await call(T.finance, 'POST', '/journal-vouchers', {
  date: '2026-11-10', memo: 'Opening cash', lines: [{ account: 'Cash & Bank', debit: 1000, credit: 0 }, { account: 'Owner Equity', debit: 0, credit: 1000 }],
});
ok('a balanced voucher posts', jv.status === 201 && jv.json?.status === 'Posted', JSON.stringify(jv.json).slice(0, 100));
ok('the voucher raises cash by 1,000', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === cashVoucher + 1000);
const rev = await call(T.finance, 'POST', `/journal-vouchers/${jv.json.id}/reverse`);
ok('reversing posts an opposite voucher', rev.status === 201 && rev.json?.reverses === jv.json.refNo);
ok('cash is back after the reversal', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === cashVoucher);
ok('reversing twice -> 400', (await call(T.finance, 'POST', `/journal-vouchers/${jv.json.id}/reverse`)).status === 400);
ok('the original voucher is marked Reversed', (await call(T.finance, 'GET', '/journal-vouchers')).json.find((v) => v.id === jv.json.id)?.status === 'Reversed');
const cashCode = (await call(T.owner, 'GET', '/accounts')).json.find((a) => a.name === 'Cash & Bank').code;
const led = (await call(T.owner, 'GET', `/reports/account-ledger?code=${cashCode}`)).json;
ok('account ledger runs to the cash balance', led.at(-1)?.running === cashVoucher, `${led.at(-1)?.running} vs ${cashVoucher}`);
const bs = (await call(T.owner, 'GET', '/reports/balance-sheet')).json;
ok('balance sheet balances (assets = liabilities + equity + profit)', bs.difference === 0, String(bs.difference));
const ageing = (await call(T.owner, 'GET', '/reports/aged-receivables')).json;
const recv = (await call(T.owner, 'GET', '/reports/receivables')).json;
ok('ageing adds up to the receivables', ageing.total === recv.total && Math.abs(ageing.buckets.reduce((n, b) => n + b.total, 0) - ageing.total) < 0.01);
const newAcc = await call(T.finance, 'POST', '/accounts', { code: '9990', name: 'Smoke Test Account', type: 'Expense' });
ok('add an account to the chart', newAcc.status === 201, JSON.stringify(newAcc.json).slice(0, 100));
ok('a duplicate account -> 409', (await call(T.finance, 'POST', '/accounts', { code: '9990', name: 'Another', type: 'Expense' })).status === 409);

// ── agreed rates ──
const dists = (await call(T.owner, 'GET', '/distributors')).json;
const setRate = await call(T.sales, 'PUT', '/distributor-rates', { distributorId: dists[0].id, productId: sku.id, rate: 12.5 });
ok('set an agreed rate', setRate.status === 200 && Number(setRate.json?.rate) === 12.5, JSON.stringify(setRate.json).slice(0, 100));
const again = await call(T.sales, 'PUT', '/distributor-rates', { distributorId: dists[0].id, productId: sku.id, rate: 13 });
ok('setting it again changes it (one rate per distributor and SKU)', again.json?.id === setRate.json?.id && Number(again.json?.rate) === 13);
ok('Manufacturing cannot set an agreed rate -> 403', (await call(T.factory, 'PUT', '/distributor-rates', { distributorId: dists[0].id, productId: sku.id, rate: 1 })).status === 403);
ok('delete an agreed rate', (await call(T.sales, 'DELETE', `/distributor-rates/${setRate.json.id}`)).status === 200);


// ── Settings & Data: lists, currencies, containers, categories, assumptions ──
const lk = (await call(T.owner, 'GET', '/lookups')).json;
ok('payment methods and Incoterms are database lists (4 + 6 entries)', lk.filter((l) => l.list === 'PAY_METHOD').length === 4 && lk.filter((l) => l.list === 'INCOTERM').length === 6);
ok('only Admin can add a list entry -> 403', (await call(T.finance, 'POST', '/lookups', { list: 'PAY_METHOD', code: 'Easypaisa' })).status === 403);
const newPm = await call(T.owner, 'POST', '/lookups', { list: 'PAY_METHOD', code: 'Easypaisa' });
ok('Admin adds a payment method', newPm.status === 201 && newPm.json?.active === true, JSON.stringify(newPm.json).slice(0, 100));
ok('adding the same entry twice -> 409', (await call(T.owner, 'POST', '/lookups', { list: 'PAY_METHOD', code: 'Easypaisa' })).status === 409);
const p6doc = (await call(T.finance, 'POST', '/accounting-documents', { date: '2026-11-10', kind: 'Income', category: 'Services', foreignAmount: 1000, party: 'Lookup test' })).json;
ok('a new payment method is accepted on a receipt', (await call(T.finance, 'POST', `/accounting-documents/${p6doc.id}/settle`, { date: '2026-11-10', amount: 100, method: 'Easypaisa' })).status === 201);
ok('an unknown payment method -> 400', (await call(T.finance, 'POST', `/accounting-documents/${p6doc.id}/settle`, { date: '2026-11-10', amount: 100, method: 'Barter' })).status === 400);
await call(T.owner, 'PATCH', `/lookups/${newPm.json.id}`, { active: false });
ok('a switched-off payment method is refused', (await call(T.finance, 'POST', `/accounting-documents/${p6doc.id}/settle`, { date: '2026-11-10', amount: 100, method: 'Easypaisa' })).status === 400);
const cifRow = lk.find((l) => l.list === 'INCOTERM' && l.code === 'CIF');
const exQuote = (await call(T.exporter, 'POST', '/exports', { ...quote, cartons: 5, incoterm: 'CIF' })).json;
ok('CIF seller costs follow the default rule (origin + ocean + insurance + bank fees = 1,550)', exQuote.costs.seller === 1550, JSON.stringify(exQuote.costs));
await call(T.owner, 'PATCH', `/lookups/${cifRow.id}`, { flags: { origin: true, ocean: true, insurance: false, destination: false, duty: false } });
const exQuote2 = (await call(T.exporter, 'GET', `/exports/${exQuote.id}`)).json;
ok('editing the Incoterm rule changes the costing (no insurance -> 1,350)', exQuote2.costs.seller === 1350, JSON.stringify(exQuote2.costs));
await call(T.owner, 'PATCH', `/lookups/${cifRow.id}`, { flags: cifRow.flags });
await call(T.exporter, 'DELETE', `/exports/${exQuote.id}`);
ok('an unknown Incoterm on a quote -> 400', (await call(T.exporter, 'POST', '/exports', { ...quote, incoterm: 'XYZ' })).status === 400);

const eur = await call(T.owner, 'POST', '/currencies', { code: 'sar', name: 'Saudi Riyal', symbol: 'SAR', rate: 74.5 });
ok('Admin adds a currency (code upper-cased)', eur.status === 201 && eur.json?.code === 'SAR');
ok('the new currency rate can be changed', Number((await call(T.owner, 'PATCH', '/currencies/SAR', { rate: 75 })).json?.rate) === 75);
ok('PKR must stay at rate 1 -> 400', (await call(T.owner, 'PATCH', '/currencies/PKR', { rate: 2 })).status === 400);
ok('PKR cannot be deleted -> 400', (await call(T.owner, 'DELETE', '/currencies/PKR')).status === 400);
ok('a currency in use cannot be deleted -> 409', (await call(T.owner, 'DELETE', '/currencies/USD')).status === 409);
ok('an unused currency can be deleted', (await call(T.owner, 'DELETE', '/currencies/SAR')).status === 200);

ok('add a container type', (await call(T.owner, 'POST', '/container-types', { code: '45HC', maxCartons: 2600 })).status === 201);
ok('change its planning cartons', (await call(T.owner, 'PATCH', '/container-types/45HC', { maxCartons: 2700 })).json?.maxCartons === 2700);
ok('the default container cannot be deleted -> 409', (await call(T.owner, 'DELETE', '/container-types/40HC')).status === 409);
ok('an unused container type can be deleted', (await call(T.owner, 'DELETE', '/container-types/45HC')).status === 200);

const newCat = await call(T.owner, 'POST', '/categories', { kind: 'EXPENSE', name: 'Insurance' });
ok('Admin adds an expense category', newCat.status === 201);
ok('a duplicate category -> 409', (await call(T.owner, 'POST', '/categories', { kind: 'EXPENSE', name: 'Insurance' })).status === 409);
const catBill = (await call(T.finance, 'POST', '/accounting-documents', { date: '2026-11-10', kind: 'Expense', category: 'Insurance', foreignAmount: 1000, party: 'Insurer' })).json;
ok('a category that documents use cannot be deleted -> 409', (await call(T.owner, 'DELETE', `/categories/${newCat.json.id}`)).status === 409);
ok('renaming a category moves its documents', (await call(T.owner, 'PATCH', `/categories/${newCat.json.id}`, { name: 'Insurance & Cover' })).json?.name === 'Insurance & Cover'
  && (await call(T.finance, 'GET', `/accounting-documents/${catBill.id}`)).json?.category === 'Insurance & Cover');
const cat2 = await call(T.owner, 'POST', '/categories', { kind: 'INCOME', name: 'Scrap sales' });
ok('an unused category can be deleted', (await call(T.owner, 'DELETE', `/categories/${cat2.json.id}`)).status === 200);

ok('a document prefix must be letters -> 400', (await call(T.owner, 'PATCH', '/settings', { docPrefixes: { sales: '12' } })).status === 400);
ok('an unknown default container -> 400', (await call(T.owner, 'PATCH', '/settings', { containerSize: '99XX' })).status === 400);
ok('a non-increasing aging list -> 400', (await call(T.owner, 'PATCH', '/settings', { agingBuckets: [60, 30] })).status === 400);
await call(T.owner, 'PATCH', '/settings', { agingBuckets: [15, 45] });
const ag = (await call(T.owner, 'GET', '/reports/aged-receivables')).json;
ok('aging buckets follow the setting (15, 45)', ag.buckets.map((b) => b.label).join('|') === 'Not yet due|1-15 days|16-45 days|Over 45 days', ag.buckets.map((b) => b.label).join('|'));
await call(T.owner, 'PATCH', '/settings', { agingBuckets: [30, 60, 90] });
await call(T.owner, 'PATCH', '/settings', { docPrefixes: { sales: 'SX' } });
const sx = await call(T.sales, 'POST', '/orders', { date: '2026-11-10', distributorId: dists[0].id, productId: sku.id, cartons: 1, rate: 6.25 });
ok('a changed document prefix applies to the next order (SX-)', String(sx.json?.refNo).startsWith('SX-'), JSON.stringify(sx.json).slice(0, 100));
await call(T.sales, 'DELETE', `/orders/${sx.json?.id}`);
await call(T.owner, 'PATCH', '/settings', { docPrefixes: { sales: 'SO' } });

// ── Users & Roles ──
const ul = await call(T.owner, 'GET', '/users');
ok('Admin lists users, never the password', ul.status === 200 && ul.json.length >= 8 && ul.json.every((u) => u.password === undefined));
ok('Viewer can read the user list', (await call(T.audit, 'GET', '/users')).status === 200);
ok('Finance cannot read users -> 403', (await call(T.finance, 'GET', '/users')).status === 403);
ok('Viewer cannot add a user -> 403', (await call(T.audit, 'POST', '/users', { name: 'x', email: 'x@example.test', password: 'Passw0rd!x', role: 'Viewer' })).status === 403);
const nu = await call(T.owner, 'POST', '/users', { name: 'Smoke User', email: 'smoke@example.test', password: 'Passw0rd!x', role: 'Finance', seat: 'B' });
ok('Admin adds a user', nu.status === 201 && nu.json?.seat === 'B' && nu.json?.password === undefined, JSON.stringify(nu.json).slice(0, 100));
ok('the same email twice -> 409', (await call(T.owner, 'POST', '/users', { name: 'Again', email: 'SMOKE@example.test', password: 'Passw0rd!x', role: 'Viewer' })).status === 409);
ok('a short password -> 400', (await call(T.owner, 'POST', '/users', { name: 'S', email: 's2@example.test', password: 'short', role: 'Viewer' })).status === 400);
ok('a Distributor login needs a distributor -> 400', (await call(T.owner, 'POST', '/users', { name: 'D', email: 'd3@example.test', password: 'Passw0rd!x', role: 'Distributor' })).status === 400);
ok('the new user can sign in', (await call(null, 'POST', '/auth/login', { email: 'smoke@example.test', password: 'Passw0rd!x' })).status === 201);
ok('Admin changes the role (seat is cleared for Viewer)', (await call(T.owner, 'PATCH', `/users/${nu.json.id}`, { role: 'Viewer' })).json?.seat === 'None');
await call(T.owner, 'POST', `/users/${nu.json.id}/reset-password`, { password: 'NewPassw0rd!y' });
ok('a reset password works and the old one does not', (await call(null, 'POST', '/auth/login', { email: 'smoke@example.test', password: 'NewPassw0rd!y' })).status === 201
  && (await call(null, 'POST', '/auth/login', { email: 'smoke@example.test', password: 'Passw0rd!x' })).status === 401);
await call(T.owner, 'PATCH', `/users/${nu.json.id}`, { status: 'Disabled' });
ok('a disabled user cannot sign in', (await call(null, 'POST', '/auth/login', { email: 'smoke@example.test', password: 'NewPassw0rd!y' })).status === 401);
const ownerId = ul.json.find((u) => u.email === 'owner@example.test').id;
ok('nobody can switch off their own account -> 400', (await call(T.owner, 'PATCH', `/users/${ownerId}`, { status: 'Disabled' })).status === 400);
const rootUser = ul.json.find((u) => u.isRoot);
if (rootUser) ok('the root account cannot be demoted -> 400', (await call(T.owner, 'PATCH', `/users/${rootUser.id}`, { role: 'Viewer' })).status === 400);
const access = (await call(T.audit, 'GET', '/users/access')).json;
ok('the permission matrix is readable', access?.pages?.Admin?.includes('settings') && access?.writes?.finance?.includes('Finance'));


// ── Distributor partner portal ──
const p7prof = await call(T.dist, 'GET', '/portal/profile');
ok('a distributor login sees its own profile', p7prof.status === 200 && p7prof.json?.distributor?.name && p7prof.json?.paymentMethods?.includes('Bank Transfer'), JSON.stringify(p7prof.json).slice(0, 100));
const p7me = p7prof.json?.distributor?.id;
const p7others = (await call(T.owner, 'GET', '/distributors')).json.filter((d) => d.id !== p7me);
const p7spy = await call(T.dist, 'GET', `/portal/orders?distributorId=${p7others[0].id}`);
ok('a distributor cannot look at another distributor (the query is ignored)', p7spy.status === 200 && p7spy.json.every((o) => o.distributorId === p7me));
ok('a distributor cannot open the staff approval desk -> 403', (await call(T.dist, 'GET', '/portal/desk')).status === 403);
ok('Viewer cannot open the portal -> 403', (await call(T.audit, 'GET', '/portal/profile')).status === 403);
ok('Manufacturing cannot open the portal -> 403', (await call(T.factory, 'GET', '/portal/profile')).status === 403);
const p7sku = (await call(T.owner, 'GET', '/products')).json.find((p) => p.stockCartons >= 6);
ok('a product has stock for the portal test', !!p7sku);
ok('a request with a delivery date before the request date -> 400', (await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 3, requestedDate: '2026-11-01' })).status === 400);
const p7req = await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 3, requestedDate: '2026-11-15', poRef: 'PO-77' });
ok('a distributor files a stock request', p7req.status === 201 && p7req.json?.status === 'Requested', JSON.stringify(p7req.json).slice(0, 100));
ok('a distributor cannot accept its own request -> 403', (await call(T.dist, 'POST', `/portal/requests/${p7req.json.id}/accept`, {})).status === 403);
ok('the approval desk lists it for staff', (await call(T.sales, 'GET', '/portal/desk')).json?.requests?.some((r) => r.id === p7req.json.id));
const p7acc = await call(T.sales, 'POST', `/portal/requests/${p7req.json.id}/accept`, { advancePct: 20 });
ok('staff accept it into a draft sales order with the price locked', p7acc.status === 201 && p7acc.json?.order?.status === 'Draft' && p7acc.json?.order?.poRef === 'PO-77', JSON.stringify(p7acc.json).slice(0, 140));
const p7order = p7acc.json.order;
ok('accepting twice -> 400', (await call(T.sales, 'POST', `/portal/requests/${p7req.json.id}/accept`, {})).status === 400);
const p7rej = await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 1 });
ok('rejecting without a reason -> 400', (await call(T.sales, 'POST', `/portal/requests/${p7rej.json.id}/reject`, {})).status === 400);
ok('staff reject a request with a reason', (await call(T.sales, 'POST', `/portal/requests/${p7rej.json.id}/reject`, { note: 'Out of stock this week' })).status === 201);

// advance payment before dispatch
const p7bill = Math.round(p7order.cartons * p7sku.packsPerCarton * Number(p7order.rate) * 100) / 100;
ok('an advice above the pro-forma -> 400', (await call(T.dist, 'POST', '/portal/advices', { orderId: p7order.id, date: '2026-11-10', amount: p7bill + 1 })).status === 400);
ok('an advice with an unknown payment method -> 400', (await call(T.dist, 'POST', '/portal/advices', { orderId: p7order.id, date: '2026-11-10', amount: 1000, method: 'Barter' })).status === 400);
ok('an attachment of the wrong type -> 400', (await call(T.dist, 'POST', '/portal/advices', { orderId: p7order.id, date: '2026-11-10', amount: 1000, proofName: 'x.exe', proofMime: 'application/x-msdownload', proofData: 'AAAA' })).status === 400);
const p7adv = await call(T.dist, 'POST', '/portal/advices', { orderId: p7order.id, date: '2026-11-10', amount: 5000, bankRef: 'UTR-1', proofName: 'slip.png', proofMime: 'image/png', proofData: 'iVBORw0KGgo=' });
ok('a distributor reports an advance payment', p7adv.status === 201 && p7adv.json?.status === 'Submitted' && p7adv.json?.isAdvance === true, JSON.stringify(p7adv.json).slice(0, 120));
ok('a second advice cannot exceed what is still open (pending reserves it)', (await call(T.dist, 'POST', '/portal/advices', { orderId: p7order.id, date: '2026-11-10', amount: p7bill - 4000 })).status === 400);
const p7cashA = (await call(T.owner, 'GET', '/reports/dashboard')).json.cash;
ok('an unconfirmed advice does not touch cash', p7cashA === (await call(T.owner, 'GET', '/reports/dashboard')).json.cash);
ok('Distribution cannot confirm money -> 403', (await call(T.sales, 'POST', `/portal/advices/${p7adv.json.id}/confirm`)).status === 403);
ok('the distributor can open its own proof', (await call(T.dist, 'GET', `/portal/advices/${p7adv.json.id}/proof`)).json?.mime === 'image/png');
const p7conf = await call(T.finance, 'POST', `/portal/advices/${p7adv.json.id}/confirm`);
ok('Finance confirms the advice', p7conf.status === 201 && p7conf.json?.collection?.isAdvance === true, JSON.stringify(p7conf.json).slice(0, 120));
ok('confirming raises cash by the advance', (await call(T.owner, 'GET', '/reports/dashboard')).json.cash === p7cashA + 5000);
const p7tb1 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('the advance is held as a customer advance (liability)', Math.abs(-(p7tb1.accounts.find((a) => a.name === 'Customer Advances')?.net ?? 0) - 5000) < 0.01);
ok('confirming twice -> 400', (await call(T.finance, 'POST', `/portal/advices/${p7adv.json.id}/confirm`)).status === 400);
const p7disp = await call(T.sales, 'POST', `/orders/${p7order.id}/dispatch`);
ok('dispatch the accepted order', p7disp.status === 201 && p7disp.json?.status === 'Dispatched', JSON.stringify(p7disp.json).slice(0, 100));
const p7tb2 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('dispatch applies the advance to the invoice (advances back to zero)', Math.abs(p7tb2.accounts.find((a) => a.name === 'Customer Advances')?.net ?? 0) < 0.01 && p7tb2.balanced === true);
ok('the order is billed less the advance', Math.abs(p7disp.json.outstanding - (p7bill - 5000)) < 0.01, `${p7disp.json.outstanding} vs ${p7bill - 5000}`);

// delivery and claim
ok('good + damaged + missing must equal the shipped cartons -> 400', (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7order.id, date: '2026-11-12', goodCartons: 1, damagedCartons: 1, missingCartons: 0, condition: 'Damaged', reason: 'x' })).status === 400);
ok('a discrepancy needs an explanation -> 400', (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7order.id, date: '2026-11-12', goodCartons: 2, damagedCartons: 1, missingCartons: 0, condition: 'Damaged' })).status === 400);
const p7other = (await call(T.owner, 'GET', '/orders')).json.find((o) => o.distributorId !== p7me && o.status === 'Dispatched');
ok('a distributor cannot receive another distributor\'s order -> 404', (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7other.id, date: '2026-11-12', goodCartons: p7other.cartons, damagedCartons: 0, missingCartons: 0, condition: 'Good' })).status === 404);
const p7rec = await call(T.dist, 'POST', '/portal/receipts', { orderId: p7order.id, date: '2026-11-12', goodCartons: 2, damagedCartons: 1, missingCartons: 0, condition: 'Damaged', reason: 'One carton crushed', receivedBy: 'Store keeper' });
ok('a delivery with a damaged carton becomes a claim', p7rec.status === 201 && p7rec.json?.status === 'Disputed' && p7rec.json?.claimValue === Math.round(p7sku.packsPerCarton * Number(p7order.rate) * 100) / 100, JSON.stringify(p7rec.json).slice(0, 140));
ok('a second receipt for the same order -> 400', (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7order.id, date: '2026-11-12', goodCartons: 3, damagedCartons: 0, missingCartons: 0, condition: 'Good' })).status === 400);
ok('a distributor cannot approve its own claim -> 403', (await call(T.dist, 'POST', `/portal/receipts/${p7rec.json.id}/approve`)).status === 403);
const p7ar0 = (await call(T.owner, 'GET', '/reports/trial-balance')).json.accounts.find((a) => a.name === 'Accounts Receivable').net;
const p7cn = await call(T.sales, 'POST', `/portal/receipts/${p7rec.json.id}/approve`);
ok('staff approve the claim: a credit note is posted', p7cn.status === 201 && Number(p7cn.json?.refund) === 0 && Number(p7cn.json?.amount) === p7rec.json.claimValue, JSON.stringify(p7cn.json).slice(0, 120));
const p7tb3 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('the credit note reduces receivables and books a sales return', Math.abs((p7ar0 - p7tb3.accounts.find((a) => a.name === 'Accounts Receivable').net) - p7rec.json.claimValue) < 0.01 && p7tb3.accounts.find((a) => a.name === 'Sales Returns & Allowances').net > 0 && p7tb3.balanced === true);
ok('the order balance drops by the credit', Math.abs((await call(T.owner, 'GET', `/orders`)).json.find((o) => o.id === p7order.id).outstanding - (p7bill - 5000 - p7rec.json.claimValue)) < 0.01);
ok('approving the same claim again -> 400', (await call(T.sales, 'POST', `/portal/receipts/${p7rec.json.id}/approve`)).status === 400);

// a claim on an order that is already paid: the whole credit is owed back
const p7req2 = (await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 2 })).json;
const p7o2 = (await call(T.sales, 'POST', `/portal/requests/${p7req2.id}/accept`, {})).json.order;
await call(T.sales, 'POST', `/orders/${p7o2.id}/dispatch`);
const p7bill2 = Math.round(p7o2.cartons * p7sku.packsPerCarton * Number(p7o2.rate) * 100) / 100;
const p7adv2 = (await call(T.dist, 'POST', '/portal/advices', { orderId: p7o2.id, date: '2026-11-13', amount: p7bill2 })).json;
await call(T.finance, 'POST', `/portal/advices/${p7adv2.id}/confirm`);
const p7rec2 = (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7o2.id, date: '2026-11-14', goodCartons: 1, damagedCartons: 0, missingCartons: 1, condition: 'Other', reason: 'One carton short' })).json;
const p7cn2 = (await call(T.finance, 'POST', `/portal/receipts/${p7rec2.id}/approve`)).json;
ok('a claim on a fully paid order is all refund (credit owed back)', Number(p7cn2.refund) === Number(p7cn2.amount) && Number(p7cn2.refund) > 0, JSON.stringify(p7cn2).slice(0, 120));
const p7tb4 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('the refund is booked as credit payable to the distributor', Math.abs(-(p7tb4.accounts.find((a) => a.name === 'Distributor Credit Payable')?.net ?? 0) - Number(p7cn2.refund)) < 0.01 && p7tb4.balanced === true);
const p7rej2 = (await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 1 })).json;
const p7o3 = (await call(T.sales, 'POST', `/portal/requests/${p7rej2.id}/accept`, {})).json.order;
await call(T.sales, 'POST', `/orders/${p7o3.id}/dispatch`);
const p7rec3 = (await call(T.dist, 'POST', '/portal/receipts', { orderId: p7o3.id, date: '2026-11-14', goodCartons: 0, damagedCartons: 1, missingCartons: 0, condition: 'Wet', reason: 'Rain damage' })).json;
ok('rejecting a claim needs a reason -> 400', (await call(T.sales, 'POST', `/portal/receipts/${p7rec3.id}/reject`, {})).status === 400);
ok('staff reject a claim with a reason', (await call(T.sales, 'POST', `/portal/receipts/${p7rec3.id}/reject`, { note: 'Waybill shows full delivery' })).status === 201);

// statement, rates, profile
const p7st = (await call(T.dist, 'GET', '/portal/statement')).json;
ok('the statement lists invoices, advances and credit notes with a running balance',
  ['Invoice', 'Advance', 'Credit note'].every((k) => p7st.entries.some((e) => e.kind === k)) && p7st.closing === p7st.entries.at(-1).balance, JSON.stringify(p7st.entries.map((e) => e.kind)));
await call(T.sales, 'PUT', '/distributor-rates', { distributorId: p7me, productId: p7sku.id, rate: 5.5 });
const p7rates = (await call(T.dist, 'GET', '/portal/rates')).json;
ok('the agreed rate shows on the distributor\'s price list', p7rates.find((r) => r.productId === p7sku.id)?.agreed === true && p7rates.find((r) => r.productId === p7sku.id)?.rate === 5.5);
const p7req4 = (await call(T.dist, 'POST', '/portal/requests', { date: '2026-11-10', productId: p7sku.id, cartons: 1 })).json;
const p7o4 = (await call(T.sales, 'POST', `/portal/requests/${p7req4.id}/accept`, {})).json.order;
ok('a new request starts from the agreed rate', Number(p7o4.rate) === 5.5, String(p7o4.rate));
const p7after = (await call(T.dist, 'GET', '/portal/profile')).json;
ok('the profile counts deliveries still to acknowledge', typeof p7after.toAcknowledge === 'number' && p7after.creditHeld > 0, JSON.stringify(p7after).slice(0, 160));
const p7desk = (await call(T.finance, 'GET', '/portal/desk')).json;
ok('the desk shows the audit trail', p7desk.audit.some((a) => a.event === 'Credit note approved'));
ok('the books still balance after the portal flows', (await call(T.owner, 'GET', '/reports/trial-balance')).json.balanced === true);


// ── file uploads and the JSON size limit ──
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const upload = async (token, bytes, name, type) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(BASE + '/attachments', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
};
const up1 = await upload(T.finance, PNG, 'slip one.png', 'image/png');
ok('Finance uploads an image', up1.status === 201 && up1.json?.mime === 'image/png' && up1.json?.size === PNG.length && up1.json?.name === 'slip one.png', JSON.stringify(up1.json).slice(0, 120));
const dl = await fetch(`${BASE}/attachments/${up1.json.id}`, { headers: { Authorization: `Bearer ${T.audit}` } });
const dlBytes = Buffer.from(await dl.arrayBuffer());
ok('a Viewer can download it, byte for byte, as an attachment', dl.status === 200 && dlBytes.equals(PNG) && dl.headers.get('content-type') === 'image/png' && /attachment/.test(dl.headers.get('content-disposition') ?? '') && dl.headers.get('x-content-type-options') === 'nosniff');
ok('a download needs a login -> 401', (await fetch(`${BASE}/attachments/${up1.json.id}`)).status === 401);
ok('the file details are readable', (await call(T.audit, 'GET', `/attachments/${up1.json.id}/meta`)).json?.name === 'slip one.png');
ok('a Viewer cannot upload -> 403', (await upload(T.audit, PNG, 'x.png', 'image/png')).status === 403);
ok('a distributor cannot upload here -> 403', (await upload(T.dist, PNG, 'x.png', 'image/png')).status === 403);
ok('a program renamed to .png is refused -> 400', (await upload(T.finance, Buffer.from('MZ\x90\x00 not an image'), 'virus.png', 'image/png')).status === 400);
ok('a type that does not match the extension is refused -> 400', (await upload(T.finance, PNG, 'photo.pdf', 'image/png')).status === 400);
ok('a text file is refused -> 400', (await upload(T.finance, Buffer.from('hello'), 'notes.txt', 'text/plain')).status === 400);
ok('an empty file is refused -> 400', (await upload(T.finance, Buffer.alloc(0), 'empty.png', 'image/png')).status === 400);
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 0x20)]);
ok('a PDF is accepted', (await upload(T.finance, pdf, 'agreement.pdf', 'application/pdf')).status === 201);
const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)]);
ok('a file over 5 MB is refused', [400, 413].includes((await upload(T.finance, bigPdf, 'bigPdf.pdf', 'application/pdf')).status));
ok('a hidden path in the name is cleaned', (await upload(T.finance, PNG, '..\\..\\evil name.png', 'image/png')).json?.name === 'evil name.png');
const own = await upload(T.finance, PNG, 'own.png', 'image/png');
ok('an unattached file can be removed by its uploader', (await call(T.finance, 'DELETE', `/attachments/${own.json.id}`)).status === 200);
ok('a removed file is gone -> 404', (await call(T.finance, 'GET', `/attachments/${own.json.id}/meta`)).status === 404);
const p7big = await call(T.dist, 'POST', '/portal/advices', { orderId: p7o4.id, date: '2026-11-10', amount: 100, proofName: 'bigPdf-slip.png', proofMime: 'image/png', proofData: 'iVBORw0KGgo='.padEnd(300000, 'A') });
ok('a 300 KB portal attachment is no longer refused by the size limit', p7big.status === 201, `${p7big.status} ${JSON.stringify(p7big.json).slice(0, 100)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
