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
  partner: 'partner@example.test', sales: 'sales@example.test', audit: 'audit@example.test', dist: 'distributor@demo.local',
};
for (const [k, e] of Object.entries(accounts)) T[k] = await login(e);

ok('all 7 test logins work', Object.values(T).every(Boolean));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
