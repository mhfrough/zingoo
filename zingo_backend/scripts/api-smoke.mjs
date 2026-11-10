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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
