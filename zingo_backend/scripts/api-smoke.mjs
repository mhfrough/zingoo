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

// ── capital injection: investors, payment details, cheques, stream split ──
const ciCash = async () => (await call(T.finance, 'GET', '/reports/cash-flows')).json.net;
const ciRaised = async () => (await call(T.owner, 'GET', '/reports/dashboard')).json.capitalRaised;
const ciIso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const ciDay = ciIso(0);
// an investor is an account: a person of the People list (Settings), a manufacturer or a distributor
const ciNames = ['Ali Khan', 'Sara Ahmed', 'Bilal Sheikh', 'Cash Cara', 'Chequer', 'Bouncer', 'File One', 'File Two', 'Reuse', 'Ghost', 'Ok One', 'Bad One', 'Loan Lara', 'Equity Eli', 'Dir Dan', 'Mach Mo'];
const ciPeople = {};
for (const name of ciNames) ciPeople[name] = (await call(T.owner, 'POST', '/lookups', { list: 'PERSON', code: name, description: 'test investor' })).json?.id;
ok('an Admin keeps the people who invest in Settings (People list)', ciNames.every((n) => !!ciPeople[n]));
ok('a Finance user cannot add a person -> 403', (await call(T.finance, 'POST', '/lookups', { list: 'PERSON', code: 'Nobody' })).status === 403);
const ciLine = (o = {}) => {
  const { party = 'Ali Khan', ...rest } = o;
  return {
    partyType: 'Person', partyId: ciPeople[party], amount: 100000, date: ciDay, paymentSource: 'Bank Transfer', paymentReference: 'TRF-9001',
    paymentAgainst: 'Agreement A-12', paidBy: 'Ali Khan', receivedBy: 'Arittek', issueDate: ciDay, streams: [{ stream: 'Manufacturing', pct: 100 }], ...rest,
  };
};
// the type of funding is chosen once for the whole injection: a test can still pass it on a line and it is lifted here
const ciPost = (body, token = T.finance) => {
  const funding = body.funding ?? body.investors?.map((l) => l.funding).find(Boolean);
  const investors = body.investors?.map(({ funding: _f, ...l }) => l);
  return call(token, 'POST', '/finance/capital-injection', { ...body, ...(funding ? { funding } : {}), investors });
};

const ciCash0 = await ciCash();
const ciRaised0 = await ciRaised();
const ciSolo = await ciPost({ note: 'Repay in 12 months, 8% profit share', investors: [ciLine({ streams: [{ stream: 'Manufacturing', pct: 60 }, { stream: 'Packaging', amount: 40000 }] })] });
const ciS = ciSolo.json?.[0];
ok('solo capital injection is created', ciSolo.status === 201 && ciSolo.json?.length === 1 && ciS?.type === 'Capital Injection', JSON.stringify(ciSolo.json).slice(0, 200));
ok('it keeps the terms and the payment details', ciS?.note === 'Repay in 12 months, 8% profit share' && ciS?.paymentSource === 'Bank Transfer' && ciS?.paymentReference === 'TRF-9001' && ciS?.paymentAgainst === 'Agreement A-12' && ciS?.paidBy === 'Ali Khan' && ciS?.receivedBy === 'Arittek' && ciS?.issueDate === ciDay);
ok('a solo investment has no group', ciS?.groupId === null && ciS?.coInvestors?.length === 0);
ok('the stream split adds up (60% + PKR 40,000 of 100,000)', ciS?.streams?.length === 2 && ciS.streams.reduce((n, x) => n + Number(x.amount), 0) === 100000 && ciS.streams.find((x) => x.stream === 'Manufacturing')?.amount === 60000 && ciS.streams.find((x) => x.stream === 'Packaging')?.pct === 40);
ok('the entry is filed under its biggest stream', ciS?.category === 'Manufacturing');
ok('a transfer posts to cash at once', (await ciCash()) === ciCash0 + 100000 && (await ciRaised()) === ciRaised0 + 100000);
ok('it is marked cleared (in the bank)', ciS?.cleared === true && ciS?.chequeStatus === '');

const ciShared = await ciPost({ note: 'Joint venture', funding: 'Shareholder Loan', investors: [
  ciLine({ party: 'Sara Ahmed', amount: 60000, streams: [{ stream: 'Marketing', amount: 60000 }] }),
  ciLine({ party: 'Bilal Sheikh', amount: 40000, paymentSource: 'Cash', streams: [{ stream: 'Marketing', pct: 25 }, { stream: 'Printing', pct: 75 }] }),
] });
const [ciA, ciB] = ciShared.json ?? [];
ok('a shared investment makes one entry per investor', ciShared.status === 201 && ciShared.json?.length === 2 && ciA?.refNo !== ciB?.refNo);
ok('they share one group and know each other', !!ciA?.groupId && ciA?.groupId === ciB?.groupId && ciA?.coInvestors?.[0] === 'Bilal Sheikh' && ciB?.coInvestors?.[0] === 'Sara Ahmed');
ok('the whole injection has one funding type and one set of terms', ciA?.funding === 'Shareholder Loan' && ciB?.funding === 'Shareholder Loan' && ciA?.note === 'Joint venture' && ciB?.note === 'Joint venture');
ok('an entry without a chosen type is Equity', ciS?.funding === 'Equity');
ok('each investor entry knows its account', ciS?.partyType === 'Person' && ciS?.partyId === ciPeople['Ali Khan'] && ciS?.party === 'Ali Khan');
ok('both amounts post to cash', (await ciCash()) === ciCash0 + 200000);

// the rules
ok('streams that do not add up -> 400', (await ciPost({ investors: [ciLine({ streams: [{ stream: 'Manufacturing', amount: 70000 }] })] })).status === 400);
ok('percentages over 100 -> 400', (await ciPost({ investors: [ciLine({ streams: [{ stream: 'Manufacturing', pct: 60 }, { stream: 'Packaging', pct: 60 }] })] })).status === 400);
ok('the same stream twice -> 400', (await ciPost({ investors: [ciLine({ streams: [{ stream: 'Manufacturing', pct: 50 }, { stream: 'Manufacturing', pct: 50 }] })] })).status === 400);
ok('an unknown stream -> 400', (await ciPost({ investors: [ciLine({ streams: [{ stream: 'Nope', pct: 100 }] })] })).status === 400);
ok('a stream with neither amount nor percent -> 400', (await ciPost({ investors: [ciLine({ streams: [{ stream: 'Manufacturing' }] })] })).status === 400);
ok('no streams -> 400', (await ciPost({ investors: [ciLine({ streams: [] })] })).status === 400);
ok('no investors -> 400', (await ciPost({ investors: [] })).status === 400);
ok('a payment source that is not in Settings -> 400', (await ciPost({ investors: [ciLine({ paymentSource: 'Barter' })] })).status === 400);
ok('an expected return before the investment date -> 400', (await ciPost({ investors: [ciLine({ expectedReturnDate: ciIso(-3) })] })).status === 400);
ok('an investor account is required -> 400', (await ciPost({ investors: [ciLine({ partyId: undefined })] })).status === 400);
ok('a free-typed investor name is no longer accepted -> 400', (await ciPost({ investors: [{ ...ciLine({ partyId: undefined, partyType: undefined }), party: 'Typed Tom' }] })).status === 400);
ok('an account that does not exist -> 400', (await ciPost({ investors: [ciLine({ partyId: '00000000-0000-4000-8000-000000000000' })] })).status === 400);
ok('a person id given as a manufacturer -> 400', (await ciPost({ investors: [ciLine({ partyType: 'Manufacturer' })] })).status === 400);
ok('the same account twice in one injection -> 400', (await ciPost({ investors: [ciLine({ party: 'Sara Ahmed' }), ciLine({ party: 'Sara Ahmed', amount: 5 })] })).status === 400);
ok('a kind of account that does not exist -> 400', (await ciPost({ investors: [ciLine({ partyType: 'Supplier' })] })).status === 400);
ok('one failing investor saves nobody (all or nothing)', (await ciPost({ investors: [ciLine({ party: 'Ok One' }), ciLine({ party: 'Bad One', streams: [{ stream: 'Nope', pct: 100 }] })] })).status === 400 && (await ciCash()) === ciCash0 + 200000);
ok('a Viewer cannot add capital -> 403', (await ciPost({ investors: [ciLine()] }, T.audit)).status === 403);
ok('Manufacturing cannot add capital -> 403', (await ciPost({ investors: [ciLine()] }, T.factory)).status === 403);
const ciCashNote = (await ciPost({ investors: [ciLine({ party: 'Cash Cara', paymentSource: 'Cash', chequeNo: '777', clearanceDate: ciIso(3) })] })).json?.[0];
ok('cheque details are ignored for a non-cheque payment', ciCashNote?.chequeNo === '' && ciCashNote?.chequeStatus === '' && ciCashNote?.clearanceDate === null);

// cheques
const ciChequeBase = { party: 'Chequer', paymentSource: 'Cheque', amount: 50000 };
ok('a cheque needs its number -> 400', (await ciPost({ investors: [ciLine({ ...ciChequeBase, clearanceDate: ciIso(3) })] })).status === 400);
ok('a cheque needs its clearance date -> 400', (await ciPost({ investors: [ciLine({ ...ciChequeBase, chequeNo: 'CH-1' })] })).status === 400);
ok('a cheque cannot clear before the cheque date -> 400', (await ciPost({ investors: [ciLine({ ...ciChequeBase, chequeNo: 'CH-1', clearanceDate: ciIso(-2) })] })).status === 400);
const ciBefore = await ciCash();
const ciRaisedBefore = await ciRaised();
const ciChq = (await ciPost({ investors: [ciLine({ ...ciChequeBase, chequeNo: 'CH-1001', clearanceDate: ciIso(4), expectedReturnDate: ciIso(5) })] })).json?.[0];
ok('a cheque starts as Pending, not cash', ciChq?.chequeStatus === 'Pending' && ciChq?.cleared === false && ciChq?.chequeNo === 'CH-1001' && ciChq?.clearanceDate === ciIso(4));
ok('a waiting cheque adds nothing to cash or to capital raised', (await ciCash()) === ciBefore && (await ciRaised()) === ciRaisedBefore);
const ciAlerts = (await call(T.owner, 'GET', '/reports/alerts')).json ?? [];
ok('a waiting cheque raises an alert', ciAlerts.some((a) => a.kind === 'cheque' && /Chequer/.test(a.title) && /CH-1001/.test(a.text)));
ok('no return reminder while the cheque is still waiting', !ciAlerts.some((a) => a.kind === 'return' && /Chequer/.test(a.title)));
ok('a waiting cheque cannot be deleted (locked)', (await call(T.finance, 'DELETE', `/finance/${ciChq.id}`)).status === 400);
ok('a Viewer cannot clear a cheque -> 403', (await call(T.audit, 'POST', `/finance/${ciChq.id}/cheque`, { status: 'Cleared' })).status === 403);
ok('a cheque cannot clear in the future -> 400', (await call(T.finance, 'POST', `/finance/${ciChq.id}/cheque`, { status: 'Cleared', date: ciIso(2) })).status === 400);
ok('a cheque cannot clear before its date -> 400', (await call(T.finance, 'POST', `/finance/${ciChq.id}/cheque`, { status: 'Cleared', date: ciIso(-9) })).status === 400);
const ciCleared = await call(T.finance, 'POST', `/finance/${ciChq.id}/cheque`, { status: 'Cleared' });
ok('clearing posts the cash', ciCleared.status === 201 && ciCleared.json?.chequeStatus === 'Cleared' && ciCleared.json?.cleared === true && (await ciCash()) === ciBefore + 50000 && (await ciRaised()) === ciRaisedBefore + 50000, JSON.stringify(ciCleared.json).slice(0, 160));
ok('it posts on the clearing date', ciCleared.json?.clearanceDate === ciDay);
ok('the alert is gone once it clears', !((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'cheque' && /Chequer/.test(a.title)));
ok('clearing twice -> 400', (await call(T.finance, 'POST', `/finance/${ciChq.id}/cheque`, { status: 'Cleared' })).status === 400);
ok('the return reminder shows once the money is in', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'return' && /Chequer/.test(a.title)));
const ciBounce = (await ciPost({ investors: [ciLine({ ...ciChequeBase, party: 'Bouncer', chequeNo: 'CH-2002', clearanceDate: ciIso(2) })] })).json?.[0];
const ciBounced = await call(T.finance, 'POST', `/finance/${ciBounce.id}/cheque`, { status: 'Bounced' });
ok('a bounced cheque never counts', ciBounced.json?.chequeStatus === 'Bounced' && ciBounced.json?.cleared === false && (await ciCash()) === ciBefore + 50000);
ok('a bounced cheque cannot be cleared later -> 400', (await call(T.finance, 'POST', `/finance/${ciBounce.id}/cheque`, { status: 'Cleared' })).status === 400);
ok('only cheques can be cleared -> 400', (await call(T.finance, 'POST', `/finance/${ciS.id}/cheque`, { status: 'Cleared' })).status === 400);
ok('a cleared cheque is in the journal with its cheque number', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === ciChq.refNo && /cheque CH-1001/.test(l.description)));

// proof and agreement
const ciProof = await upload(T.finance, PNG, 'proof.png', 'image/png');
const ciAgree = await upload(T.finance, pdf, 'agreement.pdf', 'application/pdf');
const ciFiles = await ciPost({ investors: [
  ciLine({ party: 'File One', amount: 1000, proofId: ciProof.json.id, agreementId: ciAgree.json.id }),
  ciLine({ party: 'File Two', amount: 2000, agreementId: ciAgree.json.id }),
] });
ok('proof and agreement attach to the entry', ciFiles.status === 201 && ciFiles.json?.[0]?.proof?.name === 'proof.png' && ciFiles.json?.[0]?.agreement?.name === 'agreement.pdf', JSON.stringify(ciFiles.json).slice(0, 160));
ok('one agreement can serve every investor', ciFiles.json?.[1]?.agreement?.id === ciAgree.json.id && ciFiles.json?.[1]?.proof === null);
ok('the file is now tied to the entry (removing it needs an Admin)', (await call(T.finance, 'DELETE', `/attachments/${ciProof.json.id}`)).status === 400);
ok('a proof already used on another entry -> 400', (await ciPost({ investors: [ciLine({ party: 'Reuse', proofId: ciProof.json.id })] })).status === 400);
ok('a missing file id -> 400', (await ciPost({ investors: [ciLine({ party: 'Ghost', proofId: '00000000-0000-4000-8000-000000000000' })] })).status === 400);
const ciList = await list('/finance');
ok('the listing carries the files', ciList.find((e) => e.id === ciFiles.json[0].id)?.proof?.name === 'proof.png');
ok('every entry in the listing has streams and a cleared flag', ciList.every((e) => Array.isArray(e.streams) && typeof e.cleared === 'boolean'));

// ── capital sources and stream types (controlled from Settings) ──
const slLookups = (await call(T.owner, 'GET', '/lookups')).json ?? [];
const slSources = slLookups.filter((l) => l.list === 'CAPITAL_SOURCE');
ok('capital sources start as Equity, Shareholder Loan and Partner Advance', ['Equity', 'Shareholder Loan', 'Partner Advance'].every((c) => slSources.some((l) => l.code === c && l.active)));
ok('the old "Partner Loan" is kept but switched off', slSources.some((l) => l.code === 'Partner Loan' && !l.active));
ok('loans and advances are marked as money to pay back; equity is not', slSources.find((l) => l.code === 'Shareholder Loan')?.flags?.liability === true && slSources.find((l) => l.code === 'Equity')?.flags?.liability === false);
ok('a switched-off capital source is refused -> 400', (await ciPost({ investors: [ciLine({ funding: 'Partner Loan' })] })).status === 400);
ok('an unknown capital source is refused -> 400', (await ciPost({ investors: [ciLine({ funding: 'Gift' })] })).status === 400);
ok('the old capital route refuses an unknown source too -> 400', (await call(T.finance, 'POST', '/finance', { date: ciDay, type: 'Capital Injection', category: 'Other', amount: 10, funding: 'Gift' })).status === 400);
const slBefore = await ciCash();
const slLoan = (await ciPost({ investors: [ciLine({ party: 'Loan Lara', amount: 20000, funding: 'Partner Advance' })] })).json?.[0];
ok('a loan or advance posts cash in', slLoan?.funding === 'Partner Advance' && (await ciCash()) === slBefore + 20000);
const slJournal = (await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? [];
ok('it is booked to the investor\'s own liability account, not equity', slJournal.some((l) => l.reference === slLoan.refNo && l.account === 'Capital Source · Partner Advance · Loan Lara' && l.credit === 20000));
const slEq = (await ciPost({ investors: [ciLine({ party: 'Equity Eli', amount: 5000 })] })).json?.[0];
ok('equity is booked to the investor\'s own equity account', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === slEq.refNo && l.account === 'Owner Equity · Equity Eli' && l.credit === 5000));
ok('a Finance user cannot add a capital source -> 403', (await call(T.finance, 'POST', '/lookups', { list: 'CAPITAL_SOURCE', code: 'Gift', flags: {} })).status === 403);
const slAdded = await call(T.owner, 'POST', '/lookups', { list: 'CAPITAL_SOURCE', code: 'Director Loan', flags: { liability: true } });
ok('an Admin adds a capital source in Settings', slAdded.status === 201 && slAdded.json?.flags?.liability === true);
ok('it can be used at once', (await ciPost({ investors: [ciLine({ party: 'Dir Dan', amount: 1000, funding: 'Director Loan' })] })).status === 201);

const slTypes = slLookups.filter((l) => l.list === 'STREAM_TYPE');
ok('stream types start as Fixed Asset, Movable Asset and Operation Cost', ['Fixed Asset', 'Movable Asset', 'Operation Cost'].every((c) => slTypes.some((l) => l.code === c)));
ok('only Fixed Asset is depreciable', slTypes.find((l) => l.code === 'Fixed Asset')?.flags?.depreciable === true && slTypes.find((l) => l.code === 'Operation Cost')?.flags?.depreciable === false);
const slCenter = await call(T.owner, 'POST', '/categories/cost-center', { name: 'Machinery', budget: 500000, streamType: 'Fixed Asset', depreciationRate: 12.5 });
ok('a stream can have a type and a depreciation rate', slCenter.status === 201 && slCenter.json?.streamType === 'Fixed Asset' && slCenter.json?.depreciationRate === 12.5, JSON.stringify(slCenter.json));
const slCenter2 = await call(T.owner, 'POST', '/categories/cost-center', { name: 'Running costs', budget: 1000, streamType: 'Operation Cost', depreciationRate: 20 });
ok('a type that does not depreciate keeps the rate at 0', slCenter2.status === 201 && slCenter2.json?.depreciationRate === 0);
ok('an unknown stream type -> 400', (await call(T.owner, 'POST', '/categories/cost-center', { name: 'Odd', budget: 0, streamType: 'Nope' })).status === 400);
ok('a rate over 100 -> 400', (await call(T.owner, 'POST', '/categories/cost-center', { name: 'Odd2', budget: 0, streamType: 'Fixed Asset', depreciationRate: 150 })).status === 400);
const slSet = await call(T.owner, 'PATCH', `/categories/${slCenter2.json.id}/stream`, { streamType: 'Fixed Asset', depreciationRate: 10 });
ok('the type of an existing stream can be changed', slSet.status === 200 && slSet.json?.streamType === 'Fixed Asset' && slSet.json?.depreciationRate === 10);
const slClear = await call(T.owner, 'PATCH', `/categories/${slCenter2.json.id}/stream`, { streamType: '' });
ok('and cleared', slClear.json?.streamType === '' && slClear.json?.depreciationRate === 0);
ok('only an Admin sets the type -> 403', (await call(T.finance, 'PATCH', `/categories/${slCenter2.json.id}/stream`, { streamType: 'Fixed Asset' })).status === 403);
const slBudgets = (await call(T.finance, 'GET', '/reports/budgets')).json ?? [];
ok('the budgets list carries each stream type and rate', slBudgets.find((b) => b.name === 'Machinery')?.streamType === 'Fixed Asset' && slBudgets.find((b) => b.name === 'Machinery')?.depreciationRate === 12.5);
ok('a capital injection can go against the new stream', (await ciPost({ investors: [ciLine({ party: 'Mach Mo', amount: 3000, streams: [{ stream: 'Machinery', pct: 100 }] })] })).status === 201);

// ── investor accounts: a person, a manufacturer or a distributor, each with its own ledger account ──
const iaAccounts = await call(T.finance, 'GET', '/finance/accounts');
ok('the investor account list is open to Finance', iaAccounts.status === 200 && Array.isArray(iaAccounts.json));
ok('it holds people, manufacturers and distributors', ['Person', 'Manufacturer', 'Distributor'].every((t) => iaAccounts.json?.some((a) => a.type === t)));
ok('every account has a kind, an id and a name', iaAccounts.json?.every((a) => a.type && a.id && a.name));
ok('Manufacturing cannot read the account list -> 403', (await call(T.factory, 'GET', '/finance/accounts')).status === 403);
const iaMfr = iaAccounts.json?.find((a) => a.type === 'Manufacturer');
const iaDist = iaAccounts.json?.find((a) => a.type === 'Distributor');
const iaMfrEntry = (await ciPost({ investors: [{ ...ciLine({ amount: 7000 }), partyType: 'Manufacturer', partyId: iaMfr.id }] })).json?.[0];
ok('a manufacturer can invest', iaMfrEntry?.partyType === 'Manufacturer' && iaMfrEntry?.party === iaMfr.name && iaMfrEntry?.partyId === iaMfr.id);
const iaDistEntry = (await ciPost({ funding: 'Shareholder Loan', investors: [{ ...ciLine({ amount: 9000 }), partyType: 'Distributor', partyId: iaDist.id }] })).json?.[0];
ok('a distributor can lend', iaDistEntry?.partyType === 'Distributor' && iaDistEntry?.party === iaDist.name && iaDistEntry?.funding === 'Shareholder Loan');
const iaJournal = (await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? [];
ok('a manufacturer\'s equity goes to its own account', iaJournal.some((l) => l.reference === iaMfrEntry.refNo && l.account === `Owner Equity · ${iaMfr.name}` && l.credit === 7000));
ok('a distributor\'s loan goes to its own liability account', iaJournal.some((l) => l.reference === iaDistEntry.refNo && l.account === `Capital Source · Shareholder Loan · ${iaDist.name}` && l.credit === 9000));
const iaAliLine = iaJournal.find((l) => l.reference === ciS.refNo && l.credit === 100000);
const iaSaraLine = iaJournal.find((l) => l.reference === ciA.refNo && l.credit === 60000);
ok('two investors never share an account', iaAliLine?.account === 'Owner Equity · Ali Khan' && iaSaraLine?.account === 'Capital Source · Shareholder Loan · Sara Ahmed' && iaAliLine.account !== iaSaraLine.account);
const iaChart = (await call(T.owner, 'GET', '/accounts')).json ?? [];
const iaCodes = iaChart.map((a) => a.code);
ok('the chart of accounts lists them: equity as Equity, a loan as Liability', iaChart.find((a) => a.name === 'Owner Equity · Ali Khan')?.type === 'Equity' && iaChart.find((a) => a.name === 'Capital Source · Shareholder Loan · Sara Ahmed')?.type === 'Liability');
ok('every account code is unique', new Set(iaCodes).size === iaCodes.length);
const iaTrial = (await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? [];
ok('the journal still balances', Math.abs(iaTrial.reduce((n, l) => n + l.debit - l.credit, 0)) < 0.01);

// a person switched off is no longer offered, and is refused
const iaOff = await call(T.owner, 'PATCH', `/lookups/${ciPeople['Dir Dan']}`, { active: false });
ok('a person can be switched off', iaOff.status === 200 && iaOff.json?.active === false);
ok('a switched-off person is refused -> 400', (await ciPost({ investors: [ciLine({ party: 'Dir Dan' })] })).status === 400);
ok('and no longer offered', !((await call(T.finance, 'GET', '/finance/accounts')).json ?? []).some((a) => a.id === ciPeople['Dir Dan']));

// ── loan and advance terms (options come from Settings) ──
const rpLookups = (await call(T.owner, 'GET', '/lookups')).json ?? [];
const rpHas = (list, code) => rpLookups.some((l) => l.list === list && l.code === code && l.active);
ok('Settings holds the loan and advance options', rpHas('LOAN_TENURE', 'On demand') && rpHas('REPAY_PLAN', 'Installments') && rpHas('REPAY_FREQUENCY', 'Monthly') && rpHas('ADVANCE_PURPOSE', 'Expense float') && rpHas('SETTLEMENT_METHOD', 'Cash repayment') && rpHas('BANK_ACCOUNT', 'Cash in Hand'));
ok('only Partner Advance is marked as an advance', rpLookups.find((l) => l.code === 'Partner Advance')?.flags?.advance === true && rpLookups.find((l) => l.code === 'Shareholder Loan')?.flags?.advance === false && rpLookups.find((l) => l.code === 'Equity')?.flags?.advance === false);
ok('a Finance user cannot edit the options -> 403', (await call(T.finance, 'POST', '/lookups', { list: 'LOAN_TENURE', code: 'Never' })).status === 403);
const rpLoan = (await ciPost({ funding: 'Shareholder Loan', tenure: 'Long-term (over 12 months)', repaymentPlan: 'Installments', repaymentFrequency: 'Quarterly', markupPct: 12, bankAccount: 'Zen Foods Bank Account', purpose: 'Procurement', investors: [ciLine({ party: 'Loan Lara', amount: 100000, expectedReturnDate: ciIso(365) })] })).json?.[0];
ok('a loan keeps its terms', rpLoan?.tenure === 'Long-term (over 12 months)' && rpLoan?.repaymentPlan === 'Installments' && rpLoan?.repaymentFrequency === 'Quarterly' && rpLoan?.markupPct === 12 && rpLoan?.bankAccount === 'Zen Foods Bank Account');
ok('advance-only fields are dropped from a loan', rpLoan?.purpose === '' && rpLoan?.direction === 'in');
const rpEq = (await ciPost({ tenure: 'On demand', markupPct: 9, bankAccount: 'Cash in Hand', investors: [ciLine({ party: 'Equity Eli', amount: 1000 })] })).json?.[0];
ok('equity has no loan terms, only the bank account', rpEq?.tenure === '' && rpEq?.markupPct === 0 && rpEq?.bankAccount === 'Cash in Hand');
ok('an option that is not in Settings -> 400', (await ciPost({ funding: 'Shareholder Loan', tenure: 'Forever', investors: [ciLine({ party: 'Loan Lara' })] })).status === 400);
ok('a bank account that is not in Settings -> 400', (await ciPost({ bankAccount: 'Offshore', investors: [ciLine({ party: 'Loan Lara' })] })).status === 400);
ok('a markup over 100 -> 400', (await ciPost({ funding: 'Shareholder Loan', markupPct: 150, investors: [ciLine({ party: 'Loan Lara' })] })).status === 400);
const rpAdv = (await ciPost({ funding: 'Partner Advance', purpose: 'Expense float', settlementMethod: 'Cash repayment', linkedReference: 'PO-77', tenure: 'On demand', investors: [ciLine({ party: 'Reuse', amount: 30000 })] })).json?.[0];
ok('an advance keeps its purpose, settlement and linked reference', rpAdv?.purpose === 'Expense float' && rpAdv?.settlementMethod === 'Cash repayment' && rpAdv?.linkedReference === 'PO-77' && rpAdv?.tenure === '');
ok('only an advance can be paid out -> 400', (await ciPost({ funding: 'Shareholder Loan', direction: 'out', investors: [ciLine({ party: 'Mach Mo' })] })).status === 400 && (await ciPost({ direction: 'out', investors: [ciLine({ party: 'Mach Mo' })] })).status === 400);

// ── repayments ──
const rpPost = (id, body, token = T.finance) => call(token, 'POST', `/finance/${id}/repayments`, body);
const rpCash0 = await ciCash();
const rpPos0 = (await call(T.finance, 'GET', `/finance/${rpLoan.id}/position`)).json;
ok('a new loan owes its full amount', rpPos0?.entry?.outstanding === 100000 && rpPos0?.entry?.repaid === 0 && rpPos0?.entry?.liability === true);
ok('the position shows the projected markup (12% for a year on 100,000)', rpPos0?.projectedMarkup === 12000);
ok('the position lists the streams with nothing spent yet', rpPos0?.streams?.length === 1 && rpPos0.streams[0].allocated === 100000 && rpPos0.streams[0].spent === 0 && rpPos0.streams[0].available === 100000);
const rpPart = await rpPost(rpLoan.id, { date: ciDay, amount: 30000, kind: 'principal', method: 'Bank Transfer', reference: 'RPY-TRF-1' });
ok('a part repayment is recorded', rpPart.status === 201 && rpPart.json?.repayments?.length === 1 && rpPart.json?.entry?.repaid === 30000 && rpPart.json?.entry?.outstanding === 70000, JSON.stringify(rpPart.json).slice(0, 160));
ok('it takes cash out', (await ciCash()) === rpCash0 - 30000);
const rpJournal = (await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? [];
const rpRef = rpPart.json?.repayments?.[0]?.refNo;
ok('it clears the investor\'s liability account', rpJournal.some((l) => l.reference === rpRef && l.account === 'Capital Source · Shareholder Loan · Loan Lara' && l.debit === 30000));
ok('it has a reference number of its own', /^RPY-\d+$/.test(rpRef ?? ''));
ok('more than the outstanding -> 400', (await rpPost(rpLoan.id, { date: ciDay, amount: 70001, kind: 'principal' })).status === 400);
ok('a repayment in the future -> 400', (await rpPost(rpLoan.id, { date: ciIso(2), amount: 10, kind: 'principal' })).status === 400);
ok('a repayment before the money arrived -> 400', (await rpPost(rpLoan.id, { date: ciIso(-5), amount: 10, kind: 'principal' })).status === 400);
ok('a payment method that is not in Settings -> 400', (await rpPost(rpLoan.id, { date: ciDay, amount: 10, kind: 'principal', method: 'Barter' })).status === 400);
ok('equity cannot be repaid -> 400', (await rpPost(rpEq.id, { date: ciDay, amount: 10, kind: 'principal' })).status === 400);
ok('a Viewer cannot record a repayment -> 403', (await rpPost(rpLoan.id, { date: ciDay, amount: 10, kind: 'principal' }, T.audit)).status === 403);
ok('Manufacturing cannot see a position -> 403', (await call(T.factory, 'GET', `/finance/${rpLoan.id}/position`)).status === 403);
const rpMark = await rpPost(rpLoan.id, { date: ciDay, amount: 1500, kind: 'markup', reference: 'MK-1' });
ok('markup paid does not reduce the principal', rpMark.status === 201 && rpMark.json?.entry?.outstanding === 70000 && rpMark.json?.entry?.markupPaid === 1500);
ok('markup is booked as an interest expense', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => /Markup paid/.test(l.description) && l.account === 'Expense · Interest & Bank Fees' && l.debit === 1500));
const rpFile = await upload(T.finance, PNG, 'repay.png', 'image/png');
const rpFull = await rpPost(rpLoan.id, { date: ciDay, amount: 70000, kind: 'principal', proofId: rpFile.json.id });
ok('the last repayment settles the loan, with its proof', rpFull.status === 201 && rpFull.json?.entry?.outstanding === 0 && rpFull.json?.repayments?.length === 3 && rpFull.json.repayments.some((r) => r.proof?.name === 'repay.png'));
ok('nothing more can be repaid -> 400', (await rpPost(rpLoan.id, { date: ciDay, amount: 1, kind: 'principal' })).status === 400);
ok('cash went out by the repayments and the markup', (await ciCash()) === rpCash0 - 101500);
ok('the cash flow report names them', ((await call(T.finance, 'GET', '/reports/cash-flows')).json?.outflows ?? []).some((o) => o.label === 'Loan and advance repayments' && o.amount >= 101500));
ok('the listing carries repaid, outstanding and liability', (await list('/finance')).find((e) => e.id === rpLoan.id)?.outstanding === 0);
// a loan that falls due soon reminds with what is still outstanding, and stops once it is paid back
const rpDue = (await ciPost({ funding: 'Shareholder Loan', investors: [ciLine({ party: 'Bilal Sheikh', amount: 8000, expectedReturnDate: ciIso(5) })] })).json?.[0];
const rpReminder = () => call(T.owner, 'GET', '/reports/alerts').then((r) => (r.json ?? []).find((a) => a.kind === 'return' && /Bilal Sheikh/.test(a.title)));
ok('a loan due soon shows what is still outstanding', /8000 still outstanding/.test((await rpReminder())?.text ?? ''));
await rpPost(rpDue.id, { date: ciDay, amount: 3000, kind: 'principal' });
ok('after a part repayment it shows the rest', /5000 still outstanding/.test((await rpReminder())?.text ?? ''));
await rpPost(rpDue.id, { date: ciDay, amount: 5000, kind: 'principal' });
ok('a settled loan raises no reminder', (await rpReminder()) === undefined);
ok('the journal still balances after repayments', Math.abs(((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).reduce((n, l) => n + l.debit - l.credit, 0)) < 0.01);

// ── an advance the company pays out to a partner ──
const rpCashOut0 = await ciCash();
const rpRaised0 = await ciRaised();
const rpOut = (await ciPost({ funding: 'Partner Advance', direction: 'out', purpose: 'Distribution', investors: [ciLine({ party: 'Mach Mo', amount: 20000 })] })).json?.[0];
ok('an advance paid out is recorded', rpOut?.direction === 'out' && rpOut?.outstanding === 20000);
ok('it takes cash out', (await ciCash()) === rpCashOut0 - 20000);
ok('it is not capital raised', (await ciRaised()) === rpRaised0);
const rpOutJ = (await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? [];
ok('it is booked to a receivable account of that partner', rpOutJ.some((l) => l.reference === rpOut.refNo && l.account === 'Advance Receivable · Mach Mo' && l.debit === 20000));
ok('that account is an asset', ((await call(T.owner, 'GET', '/accounts')).json ?? []).find((a) => a.name === 'Advance Receivable · Mach Mo')?.type === 'Asset');
const rpBack = await rpPost(rpOut.id, { date: ciDay, amount: 5000, kind: 'principal' });
ok('the partner paying it back brings cash in', rpBack.status === 201 && rpBack.json?.entry?.outstanding === 15000 && (await ciCash()) === rpCashOut0 - 15000);
ok('the cash flow report names the advance paid out', ((await call(T.finance, 'GET', '/reports/cash-flows')).json?.outflows ?? []).some((o) => o.label === 'Advances paid to partners'));

// ── spend paid from a funding ──
const fuFund = (await ciPost({ funding: 'Shareholder Loan', investors: [ciLine({ party: 'File One', amount: 60000, streams: [{ stream: 'Marketing', amount: 40000 }, { stream: 'Printing', amount: 20000 }] })] })).json?.[0];
const fuSpend = (body) => call(T.finance, 'POST', '/finance', { date: ciDay, type: 'Operating Expense', category: 'Marketing', amount: 15000, party: 'Agency', fundedById: fuFund.id, ...body });
const fuA = await fuSpend({});
ok('a spend can be paid from a funding', fuA.status === 201 && fuA.json?.fundedById === fuFund.id);
ok('a second spend within what is left', (await fuSpend({ amount: 20000 })).status === 201);
ok('a spend over what is left on the stream -> 400', (await fuSpend({ amount: 6000 })).status === 400);
ok('a stream with nothing set aside -> 400', (await fuSpend({ category: 'Exports' })).status === 400);
ok('only a spend can be paid from a funding -> 400', (await call(T.finance, 'POST', '/finance', { date: ciDay, type: 'Other Receipt', category: 'Marketing', amount: 10, fundedById: fuFund.id })).status === 400);
ok('a made-up funding -> 400', (await fuSpend({ fundedById: '00000000-0000-4000-8000-000000000000' })).status === 400);
const fuPos = (await call(T.finance, 'GET', `/finance/${fuFund.id}/position`)).json;
const fuMk = fuPos?.streams?.find((s) => s.stream === 'Marketing');
ok('the position shows spent and left per stream', fuMk?.allocated === 40000 && fuMk?.spent === 35000 && fuMk?.available === 5000 && fuPos.streams.find((s) => s.stream === 'Printing')?.available === 20000);
ok('and the spends that used it', fuPos?.spends?.length === 2 && fuPos.entry.usedAmount === 35000);
ok('raising a spend past the room left -> 400', (await call(T.finance, 'PATCH', `/finance/${fuA.json.id}`, { amount: 30000 })).status === 400);
ok('lowering it is fine', (await call(T.finance, 'PATCH', `/finance/${fuA.json.id}`, { amount: 10000 })).status === 200);
const fuChq = (await ciPost({ funding: 'Shareholder Loan', investors: [ciLine({ party: 'File Two', amount: 5000, paymentSource: 'Cheque', chequeNo: 'FU-1', clearanceDate: ciIso(3), streams: [{ stream: 'Marketing', pct: 100 }] })] })).json?.[0];
ok('a funding whose cheque has not cleared cannot be spent -> 400', (await fuSpend({ fundedById: fuChq.id, amount: 100 })).status === 400);
ok('a repayment on a waiting cheque -> 400', (await rpPost(fuChq.id, { date: ciDay, amount: 100, kind: 'principal' })).status === 400);

// ── equity: the bank is per investor ──
const bkEq = (await ciPost({ investors: [ciLine({ party: 'Equity Eli', amount: 1000, bankAccount: 'Cash in Hand' })] })).json?.[0];
ok('an equity investor line keeps its own bank', bkEq?.bankAccount === 'Cash in Hand');
ok('a bank that is not in Settings on a line -> 400', (await ciPost({ investors: [ciLine({ party: 'Equity Eli', amount: 1000, bankAccount: 'Offshore' })] })).status === 400);

// ── investor accounts: investor, business owner, or both, with company and point of contact ──
const iaBoth = await call(T.owner, 'POST', '/lookups', { list: 'PERSON', code: 'Both Bea', flags: { investor: true, owner: true }, meta: { company: 'Bea Holdings', poc: '0300-1234567', junk: 'x' } });
ok('an investor account can be investor and business owner', iaBoth.status === 201 && iaBoth.json?.flags?.investor && iaBoth.json?.flags?.owner);
ok('it keeps company and point of contact (and nothing else)', iaBoth.json?.meta?.company === 'Bea Holdings' && iaBoth.json?.meta?.poc === '0300-1234567' && iaBoth.json?.meta?.junk === undefined);
ok('neither role -> 400', (await call(T.owner, 'POST', '/lookups', { list: 'PERSON', code: 'Nobody Ned', flags: { investor: false, owner: false } })).status === 400);
ok('an account added without roles is an investor', ((await call(T.owner, 'GET', '/lookups')).json ?? []).find((l) => l.code === 'Ali Khan')?.flags?.investor === true);

// ── manufacturer and distributor: point of contact, contract, terms, several uploads ──
const pfUpload = async (name) => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), name);
  const r = await fetch(BASE + '/attachments', { method: 'POST', headers: { Authorization: `Bearer ${T.owner}` }, body: fd });
  return r.json();
};
const pfA = await pfUpload('contract.pdf');
const pfB = await pfUpload('licence.pdf');
const pfFiles = [pfA, pfB].map(({ id, name, mime, size }) => ({ id, name, mime, size }));
const pfMan = await call(T.owner, 'POST', '/manufacturers', { name: 'Contract Co', poc: 'Hamid', contract: 'MC-7', terms: '30 days, ex-works', files: pfFiles });
ok('a manufacturer keeps POC, contract, terms and several files', pfMan.status === 201 && pfMan.json?.poc === 'Hamid' && pfMan.json?.contract === 'MC-7' && pfMan.json?.files?.length === 2);
const pfDist = await call(T.owner, 'POST', '/distributors', { name: 'Contract Dist', region: 'Lahore', poc: 'Zara', contract: 'DC-1', terms: 'Net 30', files: [pfFiles[0]] });
ok('a file already on another record cannot be reused -> 400', pfDist.status === 400);
const pfC = await pfUpload('dist.pdf');
const pfDist2 = await call(T.owner, 'POST', '/distributors', { name: 'Contract Dist', region: 'Lahore', poc: 'Zara', contract: 'DC-1', terms: 'Net 30', files: [{ id: pfC.id, name: pfC.name, mime: pfC.mime, size: pfC.size }] });
ok('a distributor keeps POC, contract, terms and files', pfDist2.status === 201 && pfDist2.json?.poc === 'Zara' && pfDist2.json?.files?.length === 1);

// ── companies of the group ──
const coList0 = (await call(T.owner, 'GET', '/companies')).json ?? [];
ok('there is one primary company to start', coList0.filter((c) => c.primary).length === 1);
const coNew = await call(T.owner, 'POST', '/companies', { name: 'Zen Exports Ltd', taxNo: '1234567-8' });
ok('an Admin adds another company', coNew.status === 201 && coNew.json?.primary === false);
ok('a Finance user cannot add a company -> 403', (await call(T.finance, 'POST', '/companies', { name: 'X' })).status === 403);
const coOld = coList0.find((c) => c.primary);
ok('the primary company cannot be deleted -> 400', (await call(T.owner, 'DELETE', `/companies/${coOld.id}`)).status === 400);
await call(T.owner, 'PATCH', `/companies/${coNew.json.id}`, { primary: true });
const coList1 = (await call(T.owner, 'GET', '/companies')).json ?? [];
ok('making another company primary moves the flag', coList1.filter((c) => c.primary).map((c) => c.id).join() === coNew.json.id);
ok('and renames the business in Settings', (await call(T.owner, 'GET', '/settings')).json?.companyName === 'Zen Exports Ltd');
await call(T.owner, 'PATCH', `/companies/${coOld.id}`, { primary: true });
ok('the other company can then be deleted', (await call(T.owner, 'DELETE', `/companies/${coNew.json.id}`)).status === 200);

// ── switch account: an Admin switches to another login without signing in again ──
const vaOpts = (await call(T.owner, 'GET', '/auth/view-as')).json ?? {};
const vaDist = (vaOpts.users ?? []).find((u) => u.role === 'Distributor');
ok('an Admin lists the logins and every role to switch to', (vaOpts.users ?? []).length >= 8 && !!vaDist && vaOpts.roles?.includes('Investor'));
ok('a Finance user cannot switch -> 403', (await call(T.finance, 'GET', '/auth/view-as')).status === 403);
const va = await call(T.owner, 'POST', `/auth/view-as/${vaDist.id}`);
ok('switching to a distributor gives their role and pages', va.status === 201 && va.json?.user?.role === 'Distributor' && va.json?.user?.viewAs === true);
const vaT = va.json?.access_token;
ok('the switched session is that distributor', (await call(vaT, 'GET', '/portal/profile')).status === 200 && (await call(vaT, 'GET', '/products')).status === 403);
const vaInv = await call(T.owner, 'POST', '/auth/switch-role/Investor');
ok('switching to the Investor role uses its login', vaInv.status === 201 && vaInv.json?.user?.role === 'Investor' && vaInv.json?.user?.pages?.join() === 'overview,finance');
ok('an investor reads finance but changes nothing', (await call(vaInv.json?.access_token, 'GET', '/finance')).status === 200 && (await call(vaInv.json?.access_token, 'POST', '/finance', {})).status === 403);
await call(T.owner, 'PATCH', `/users/${vaInv.json.user.id}`, { status: 'Disabled' });
const vaNew = await call(T.owner, 'POST', '/auth/switch-role/Investor');
ok('a role with no active login gets one made', vaNew.status === 201 && vaNew.json?.user?.role === 'Investor' && vaNew.json?.user?.id !== vaInv.json.user.id && vaNew.json?.user?.email?.endsWith('@zingoo.local'));
ok('an unknown role -> 400', (await call(T.owner, 'POST', '/auth/switch-role/Pirate')).status === 400);

// ── income invoice with SKU lines, tax, seller costs, draft ──
const ivProducts = (await call(T.owner, 'GET', '/products')).json ?? [];
const ivP = ivProducts[0];
const ivCat = ((await call(T.owner, 'GET', '/categories?kind=INCOME')).json ?? [])[0]?.name ?? 'Other Income';
const ivBody = (o = {}) => ({
  kind: 'Income', date: ciDay, category: ivCat, party: 'Invoice Ina', paymentDays: 30, dueDate: ciIso(30), receivingAccount: 'Cash in Hand',
  deliveryStatus: 'Dispatched', deliveryProof: 'GRN-7', salesOwner: 'Route A', orderRef: 'ORD-1025', region: 'Hyderabad', customerTaxId: 'NTN-1',
  lines: [{ productId: ivP.id, qty: 10, uom: 'Dozens', sellPrice: 6.25, unitCost: 4 }], discount: 50, salesTaxPct: 18, whtPct: 4,
  sellerCosts: { freight: 100, insurance: 0, customs: 0, packaging: 20, other: 0, junk: 99 }, ...o,
});
const ivJ0 = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).length;
const ivDraft = await call(T.finance, 'POST', '/accounting-documents', ivBody({ status: 'Draft', invoiceNo: 'ZF-INV-0001' }));
// 10 dozen = 120 packs x 6.25 = 750; less 50 = 700; tax 18% = 126; total 826
ok('an invoice works its amount out from the SKU lines', ivDraft.status === 201 && ivDraft.json?.amount === 826 && ivDraft.json?.lines?.[0]?.packs === 120 && ivDraft.json?.taxAmount === 126);
ok('it keeps the cost of goods and only the known seller costs', ivDraft.json?.costOfGoods === 480 && ivDraft.json?.sellerCosts?.freight === 100 && ivDraft.json?.sellerCosts?.junk === undefined);
ok('it keeps the invoice details', ivDraft.json?.invoiceNo === 'ZF-INV-0001' && ivDraft.json?.deliveryStatus === 'Dispatched' && ivDraft.json?.receivingAccount === 'Cash in Hand');
ok('a draft is marked Draft and posts nothing', ivDraft.json?.status === 'Draft' && ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).length === ivJ0);
ok('a draft is not a receivable', !((await call(T.finance, 'GET', '/reports/receivables')).json?.rows ?? []).some((r) => r.reference === ivDraft.json.refNo));
ok('a draft cannot be collected -> 400', (await call(T.finance, 'POST', `/accounting-documents/${ivDraft.json.id}/settle`, { date: ciDay, amount: 10, method: 'Cash' })).status === 400);
const ivIssued = await call(T.finance, 'PATCH', `/accounting-documents/${ivDraft.json.id}`, { status: 'Issued' });
ok('issuing it posts', ivIssued.status === 200 && ivIssued.json?.status === 'Receivable');
const ivJ = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).filter((l) => l.reference === ivDraft.json.refNo);
ok('income and sales tax post separately', ivJ.some((l) => l.account === 'Sales Tax Payable' && l.credit === 126) && ivJ.some((l) => l.account === `Income · ${ivCat}` && l.credit === 700) && ivJ.filter((l) => l.account === 'Accounts Receivable').reduce((n, l) => n + l.debit, 0) === 826);
ok('an issued invoice cannot go back to draft -> 400', (await call(T.finance, 'PATCH', `/accounting-documents/${ivDraft.json.id}`, { status: 'Draft' })).status === 400);
ok('a discount over the lines -> 400', (await call(T.finance, 'POST', '/accounting-documents', ivBody({ discount: 5000 }))).status === 400);
ok('a delivery status not in Settings -> 400', (await call(T.finance, 'POST', '/accounting-documents', ivBody({ deliveryStatus: 'Lost at sea' }))).status === 400);
ok('cartons use the SKU packs per carton', (await call(T.finance, 'POST', '/accounting-documents', ivBody({ lines: [{ productId: ivP.id, qty: 1, uom: 'Cartons', sellPrice: 1 }], discount: 0, salesTaxPct: 0 }))).json?.lines?.[0]?.packs === (ivP.packsPerCarton || 24));
ok('an old-style income document without lines still works', (await call(T.finance, 'POST', '/accounting-documents', { kind: 'Income', date: ciDay, category: ivCat, party: 'Plain Pat', foreignAmount: 500 })).json?.amount === 500);

// ── universal bill: type, gross + tax - withholding, split across streams, approval before payment ──
const blCat = ((await call(T.owner, 'GET', '/categories?kind=EXPENSE')).json ?? [])[0]?.name;
const blStreams = ((await call(T.owner, 'GET', '/categories?kind=COST_CENTER')).json ?? []).map((c) => c.name);
const blBody = (o = {}) => ({
  kind: 'Expense', billType: 'Marketing Expense', date: ciDay, party: 'Agency Amy', category: blCat, grossAmount: 10000, billTax: 1600, billWht: 500,
  treatment: 'Operating expense', note: 'Eid campaign', billDetails: { 'Campaign name': 'Eid push' }, approver: 'Mudassir', paymentMethod: 'Bank Transfer',
  receivingAccount: 'Zen Foods Bank Account', costCenter: blStreams[0], projectRef: 'CMP-1', createdBy: 'Finance Controller',
  allocations: [{ stream: blStreams[0], amount: 6000 }, { stream: blStreams[1], amount: 4000 }], ...o,
});
const blJ0 = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).length;
const bl = await call(T.finance, 'POST', '/accounting-documents', blBody());
ok('a bill owes gross + tax - withholding', bl.status === 201 && bl.json?.amount === 11100 && bl.json?.whtAmount === 500 && bl.json?.allocations?.length === 2);
ok('it keeps type, treatment, approver and the type details', bl.json?.billType === 'Marketing Expense' && bl.json?.treatment === 'Operating expense' && bl.json?.approver === 'Mudassir' && bl.json?.billDetails?.['Campaign name'] === 'Eid push');
ok('a bill waits for approval and cannot be paid yet', bl.json?.approved === false && (await call(T.finance, 'POST', `/accounting-documents/${bl.json.id}/settle`, { date: ciDay, amount: 100, method: 'Cash' })).status === 400);
ok('nothing posts before approval', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).length === blJ0);
ok('streams that do not add up to the gross -> 400', (await call(T.finance, 'POST', '/accounting-documents', blBody({ allocations: [{ stream: blStreams[0], amount: 100 }] }))).status === 400);
ok('an unknown stream -> 400', (await call(T.finance, 'POST', '/accounting-documents', blBody({ allocations: [{ stream: 'Moon base', amount: 10000 }] }))).status === 400);
ok('an approver not in Settings -> 400', (await call(T.finance, 'POST', '/accounting-documents', blBody({ approver: 'Stranger' }))).status === 400);
ok('a bill type not in Settings -> 400', (await call(T.finance, 'POST', '/accounting-documents', blBody({ billType: 'Mystery' }))).status === 400);
ok('withholding over gross + tax -> 400', (await call(T.finance, 'POST', '/accounting-documents', blBody({ billWht: 99999 }))).status === 400);
const blDraft = await call(T.finance, 'POST', '/accounting-documents', blBody({ status: 'Draft', allocations: [{ stream: blStreams[0], amount: 1 }] }));
ok('a draft bill may be unfinished and posts nothing', blDraft.status === 201 && blDraft.json?.status === 'Draft');
await call(T.finance, 'POST', `/accounting-documents/${bl.json.id}/sign`, { seat: 'A' });
await call(T.partner, 'POST', `/accounting-documents/${bl.json.id}/sign`, { seat: 'B' });
const blJ = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).filter((l) => l.reference === bl.json.refNo);
ok('once approved: expense 11,600, payable 11,100, withholding payable 500',
  blJ.filter((l) => l.account === `Expense · ${blCat}`).reduce((n, l) => n + l.debit, 0) === 11600
  && blJ.some((l) => l.account === 'Accounts Payable' && l.credit === 11100) && blJ.some((l) => l.account === 'Withholding Tax Payable' && l.credit === 500));
ok('then it can be paid', (await call(T.finance, 'POST', `/accounting-documents/${bl.json.id}/settle`, { date: ciDay, amount: 11100, method: 'Bank Transfer' })).status === 201);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
