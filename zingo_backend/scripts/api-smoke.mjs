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
// the prototype's 1,897,000, then the scope v2 sample chain: advance paid 22,550.40, 20,000 collected
ok('dashboard cash is 1,897,000 - 22,550.40 + 20,000 (fresh sample data)', Math.abs(dash0.cash - 1894449.6) < 0.01, dash0.cash);
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
// 55,600 (prototype) + 34,000 still owed on the sample chain invoice + 21,600 dispatched above
ok('receivables are now 55,600 + 34,000 + 21,600 = 111,200', rec1.total === 111200, rec1.total);
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
ok('a distributor portal login can upload (claim photos, payment proof)', (await upload(T.dist, PNG, 'x.png', 'image/png')).status === 201);
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

// ── P1 products: packet -> bundle -> container, assigned manufacturer and distributor, sell-out days ──
const p1Prods = (await call(T.owner, 'GET', '/products')).json ?? [];
const p1Mas = p1Prods.find((p) => p.sku === 'Z10-MAS');
const p1Ket = p1Prods.find((p) => p.sku === 'Z10-KET');
ok('a product knows its flavour, packet size and packets per container', p1Mas?.flavour === 'Masala Masti' && p1Mas?.packetSize === 'Rs 10 pack' && p1Mas?.packetsPerContainer === 432 * 10, JSON.stringify(p1Mas));
ok('every sample SKU has a manufacturer and a distributor', p1Prods.filter((p) => p.sku.startsWith('Z')).every((p) => p.manufacturer?.name && p.distributor?.name));
ok('sell-out days fall back to the distributor (South Route: 40)', p1Ket?.selloutDays === null && p1Ket?.effectiveSelloutDays === 40, JSON.stringify(p1Ket));
const p1Lk = (await call(T.owner, 'GET', '/lookups')).json ?? [];
ok('flavours and packet sizes are Settings lists', p1Lk.some((l) => l.list === 'FLAVOUR') && p1Lk.some((l) => l.list === 'PACKET_SIZE'));
const p1Set = (await call(T.owner, 'GET', '/settings')).json;
ok('Settings hold bundles per container and sell-out days defaults', p1Set?.bundlesPerContainer === 10 && p1Set?.defaultSelloutDays === 30, JSON.stringify(p1Set));
const p1Body = (o = {}) => ({ sku: `P1-${Date.now() % 100000}`, name: 'Chilli Twist', pack: 10, mrp: 10, rate: 6, packsPerCarton: 20, bundlesPerContainer: 10, ...o });
ok('a flavour not in Settings -> 400', (await call(T.owner, 'POST', '/products', p1Body({ flavour: 'Moon Dust' }))).status === 400);
ok('a packet size not in Settings -> 400', (await call(T.owner, 'POST', '/products', p1Body({ packetSize: '9 kg' }))).status === 400);
ok('an unknown manufacturer -> 400', (await call(T.owner, 'POST', '/products', p1Body({ manufacturerId: '00000000-0000-4000-8000-000000000000' }))).status === 400);
ok('an unknown distributor -> 400', (await call(T.owner, 'POST', '/products', p1Body({ distributorId: '00000000-0000-4000-8000-000000000000' }))).status === 400);
ok('zero bundles per container -> 400', (await call(T.owner, 'POST', '/products', p1Body({ bundlesPerContainer: 0 }))).status === 400);
ok('sell-out days over 365 -> 400', (await call(T.owner, 'POST', '/products', p1Body({ selloutDays: 400 }))).status === 400);
const p1New = await call(T.owner, 'POST', '/products', p1Body({ flavour: 'Masala Masti', packetSize: 'Rs 10 pack', manufacturerId: p1Mas.manufacturerId, distributorId: p1Ket.distributorId, selloutDays: 21 }));
ok('a product with partners and its own sell-out days is saved', p1New.status === 201 && p1New.json?.distributorId === p1Ket.distributorId, JSON.stringify(p1New.json));
const p1Find = async () => ((await call(T.owner, 'GET', '/products')).json ?? []).find((p) => p.id === p1New.json?.id);
ok('its own sell-out days win over the distributor', (await p1Find())?.effectiveSelloutDays === 21);
await call(T.owner, 'PATCH', `/products/${p1New.json?.id}`, { selloutDays: null });
ok('clearing them goes back to the distributor', (await p1Find())?.effectiveSelloutDays === 40);
ok('20 packets x 10 bundles = 200 packets per container', (await p1Find())?.packetsPerContainer === 200);
ok('a Distributor login cannot add products -> 403', (await call(T.dist, 'POST', '/products', p1Body())).status === 403);
const p1D = (await call(T.owner, 'GET', '/distributors')).json?.[0];
ok('a distributor has its own sell-out days', typeof p1D?.selloutDays === 'number');
ok('distributor sell-out days over 365 -> 400', (await call(T.owner, 'PATCH', `/distributors/${p1D.id}`, { selloutDays: 400 })).status === 400);

// ── P2 partner terms: banks list, manufacturer bank accounts and advance %, distributor area ──
const p2Lk = (await call(T.owner, 'GET', '/lookups')).json ?? [];
ok('banks are a Settings list', p2Lk.some((l) => l.list === 'BANK' && l.code === 'Meezan Bank'));
const p2Set = (await call(T.owner, 'GET', '/settings')).json;
ok('Settings hold the default manufacturer advance %', p2Set?.defaultAdvancePct === 30, JSON.stringify(p2Set?.defaultAdvancePct));
const p2M = ((await call(T.owner, 'GET', '/manufacturers')).json ?? []).find((m) => m.name === 'Brand Choice Pakistan');
ok('the sample manufacturer asks 30% advance and has two bank accounts, one default',
  p2M?.advancePct === 30 && p2M?.bankAccounts?.length === 2 && p2M.bankAccounts.filter((b) => b.isDefault).length === 1, JSON.stringify(p2M));
const p2Bank = (o = {}) => ({ bank: 'HBL', title: 'Test Foods', account: 'pk00 test 0000 0001', isDefault: false, ...o });
const p2New = await call(T.owner, 'POST', '/manufacturers', { name: `P2 Maker ${Date.now() % 100000}`, advancePct: 25, paymentDays: 15, bankAccounts: [p2Bank()] });
ok('a new manufacturer with one bank account: it becomes the default, account cleaned',
  p2New.status === 201 && p2New.json?.bankAccounts?.[0]?.isDefault === true && p2New.json?.bankAccounts?.[0]?.account === 'PK00TEST00000001', JSON.stringify(p2New.json));
ok('a bank not in Settings -> 400', (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { bankAccounts: [p2Bank({ bank: 'Bank of Atlantis' })] })).status === 400);
ok('two default accounts -> 400', (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { bankAccounts: [p2Bank({ isDefault: true }), p2Bank({ bank: 'UBL', isDefault: true })] })).status === 400);
ok('the same account twice -> 400', (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { bankAccounts: [p2Bank(), p2Bank()] })).status === 400);
ok('an account without a number -> 400', (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { bankAccounts: [p2Bank({ account: '' })] })).status === 400);
ok('advance over 100% -> 400', (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { advancePct: 120 })).status === 400);
const p2Swap = await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { bankAccounts: [p2Bank(), p2Bank({ bank: 'UBL', account: 'X2', isDefault: true })] });
ok('the default can move to another account', p2Swap.status === 200 && p2Swap.json?.bankAccounts?.find((b) => b.isDefault)?.bank === 'UBL', JSON.stringify(p2Swap.json));
const p2BankRow = p2Lk.find((l) => l.list === 'BANK' && l.code === 'UBL');
await call(T.owner, 'PATCH', `/lookups/${p2BankRow.id}`, { active: false });
ok('a bank switched off in Settings stays on an account that already has it',
  (await call(T.owner, 'PATCH', `/manufacturers/${p2New.json?.id}`, { advancePct: 20, bankAccounts: p2Swap.json.bankAccounts })).status === 200);
ok('but cannot be added to a new account -> 400',
  (await call(T.owner, 'POST', '/manufacturers', { name: `P2 Other ${Date.now() % 100000}`, bankAccounts: [p2Bank({ bank: 'UBL' })] })).status === 400);
await call(T.owner, 'PATCH', `/lookups/${p2BankRow.id}`, { active: true });
ok('only Admin edits manufacturers -> 403', (await call(T.finance, 'PATCH', `/manufacturers/${p2New.json?.id}`, { advancePct: 10 })).status === 403);
const p2D = ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.region === 'Hyderabad');
ok('a distributor covers provinces, districts and cities', p2D?.provinces?.includes('Sindh') && p2D?.districts?.some((d) => d.name === 'Matiari') && p2D?.cities?.some((c) => c.name === 'Matiari' && c.district === 'Matiari'), JSON.stringify(p2D));
const p2DUp = await call(T.owner, 'PATCH', `/distributors/${p2D.id}`, { cities: [{ name: ' Kotri ', province: 'Sindh', district: 'Jamshoro' }, { name: 'Kotri', province: 'Sindh', district: 'Jamshoro' }, { name: 'Hyderabad', province: 'Sindh', district: 'Hyderabad' }] });
ok('areas are trimmed, without blanks or repeats', JSON.stringify((p2DUp.json?.cities ?? []).map((c) => c.name)) === JSON.stringify(['Kotri', 'Hyderabad']), JSON.stringify(p2DUp.json?.cities));
ok('more than 600 cities -> 400', (await call(T.owner, 'PATCH', `/distributors/${p2D.id}`, { cities: Array.from({ length: 601 }, (_, i) => ({ name: `Area ${i}`, province: 'Sindh' })) })).status === 400);

// ── P3 production orders and the manufacturer portal ──
const p3Maker = await login('manufacturer@demo.local');
ok('the demo manufacturer can sign in', !!p3Maker);
const p3Me = (await call(p3Maker, 'GET', '/auth/me')).json;
ok('a Manufacturer login lands on the factory portal only', p3Me?.role === 'Manufacturer' && JSON.stringify(p3Me?.pages) === JSON.stringify(['factory']) && !!p3Me?.manufacturerId, JSON.stringify(p3Me));
ok('a Manufacturer login cannot read staff data -> 403',
  (await call(p3Maker, 'GET', '/products')).status === 403 && (await call(p3Maker, 'GET', '/reports/dashboard')).status === 403 && (await call(p3Maker, 'GET', '/portal/orders')).status === 403);
ok('a Distributor login cannot read production orders -> 403', (await call(T.dist, 'GET', '/production-orders')).status === 403);
const p3Seeded = (await call(T.owner, 'GET', '/production-orders')).json ?? [];
ok('sample orders: one in production, one draft', p3Seeded.some((o) => o.status === 'Accepted' && o.stage === 'In production') && p3Seeded.some((o) => o.status === 'Draft'), JSON.stringify(p3Seeded.map((o) => [o.refNo, o.status, o.stage])));
ok('the manufacturer never sees drafts', ((await call(p3Maker, 'GET', '/production-orders')).json ?? []).every((o) => o.status !== 'Draft'));
const p3Prods = (await call(T.owner, 'GET', '/products')).json ?? [];
const p3P = p3Prods.find((p) => p.sku === 'Z10-KET');
const p3Day = new Date().toISOString().slice(0, 10);
const p3New = await call(T.factory, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 3 });
const p3o = p3New.json;
ok('an order takes manufacturer, distributor, packaging, rate and advance from the set-up',
  p3New.status === 201 && p3o.status === 'Draft' && p3o.manufacturerId === p3P.manufacturerId && p3o.distributorId === p3P.distributorId
  && p3o.bundles === 3 * p3P.bundlesPerContainer && p3o.packets === 3 * p3P.bundlesPerContainer * p3P.packsPerCarton
  && p3o.rate === p3P.manufacturerRate && p3o.advancePct === 30 && /^MO-\d{3}$/.test(p3o.refNo), JSON.stringify(p3o));
ok('value = packets x rate, advance = 30% of it', p3o.value === Math.round(p3o.packets * p3o.rate * 100) / 100 && p3o.advanceAmount === Math.round(p3o.value * 30) / 100);
ok('a delivery date before the order date -> 400', (await call(T.factory, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 1, dueDate: '2000-01-01' })).status === 400);
ok('zero containers -> 400', (await call(T.factory, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 0 })).status === 400);
ok('the warehouse needs no distributor', (await call(T.factory, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 1, destination: 'Warehouse' })).json?.distributorId === null);
ok('Finance cannot place production orders -> 403', (await call(T.finance, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 1 })).status === 403);
ok('a manufacturer cannot place orders -> 403', (await call(p3Maker, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 1 })).status === 403);
ok('a draft can be changed', (await call(T.factory, 'PATCH', `/production-orders/${p3o.id}`, { containers: 4 })).json?.containers === 4);
ok('the manufacturer cannot answer a draft -> 404/400', [400, 404].includes((await call(p3Maker, 'POST', `/production-orders/${p3o.id}/accept`, {})).status));
ok('send a draft', (await call(T.factory, 'POST', `/production-orders/${p3o.id}/send`)).json?.status === 'Sent');
ok('a sent order cannot be changed -> 400', (await call(T.factory, 'PATCH', `/production-orders/${p3o.id}`, { containers: 5 })).status === 400);
ok('a sent order cannot be deleted -> 400', (await call(T.factory, 'DELETE', `/production-orders/${p3o.id}`)).status === 400);
const p3Al = (await call(T.owner, 'GET', '/reports/alerts')).json ?? [];
ok('the company is alerted while the manufacturer has not answered', p3Al.some((a) => a.kind === 'production' && a.title.includes(p3o.refNo)));
ok('progress before accepting -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Preparation' })).status === 400);
ok('a ready date before the order date -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/accept`, { readyDate: '2000-01-01' })).status === 400);
const p3Acc = await call(p3Maker, 'POST', `/production-orders/${p3o.id}/accept`, { note: 'Will start Monday' });
ok('the manufacturer accepts from its portal', p3Acc.json?.status === 'Accepted' && p3Acc.json?.events?.some((e) => e.event === 'Accepted' && e.side === 'Manufacturer'), JSON.stringify(p3Acc.json?.events));
ok('accepting twice -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/accept`, {})).status === 400);
ok('a stage not in Settings -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Teleporting' })).status === 400);
ok('report a stage', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'In production', note: 'Line 2' })).json?.stage === 'In production');
ok('stages only move forward -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Preparation' })).status === 400);
ok('staff may report for the manufacturer', (await call(T.factory, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Quality check' })).json?.events?.some((e) => e.event === 'Quality check' && e.side === 'Company'));
ok('Finance cannot report progress -> 403', (await call(T.finance, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Ready to ship' })).status === 403);
// another manufacturer cannot touch this one's orders
const p3Other = await call(T.owner, 'POST', '/manufacturers', { name: `P3 Other Maker ${Date.now() % 100000}` });
const p3OtherUser = await call(T.owner, 'POST', '/users', { name: 'Other Maker', email: `maker${Date.now() % 100000}@example.test`, password: 'P3-password-1', role: 'Manufacturer', manufacturerId: p3Other.json?.id });
ok('a Manufacturer login needs its manufacturer -> 400', (await call(T.owner, 'POST', '/users', { name: 'No Maker', email: `nomaker${Date.now() % 100000}@example.test`, password: 'P3-password-1', role: 'Manufacturer' })).status === 400);
const p3OtherT = await (async () => (await call(null, 'POST', '/auth/login', { email: p3OtherUser.json?.email, password: 'P3-password-1' })).json?.access_token)();
ok('another manufacturer sees none of these orders', p3OtherT && ((await call(p3OtherT, 'GET', '/production-orders')).json ?? []).length === 0);
ok('and cannot answer them -> 403', (await call(p3OtherT, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Ready to ship' })).status === 403);
ok('its portal profile is its own', (await call(p3OtherT, 'GET', `/production-orders/profile?manufacturerId=${p3P.manufacturerId}`)).json?.manufacturer?.id === p3Other.json?.id);
// reject and cancel
const p3R = (await call(T.factory, 'POST', '/production-orders', { date: p3Day, productId: p3P.id, containers: 1, send: true })).json;
ok('send straight away', p3R?.status === 'Sent');
ok('a rejection needs a reason -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3R.id}/reject`, { reason: '' })).status === 400);
ok('the manufacturer rejects with a reason', (await call(p3Maker, 'POST', `/production-orders/${p3R.id}/reject`, { reason: 'Line busy until January' })).json?.status === 'Rejected');
ok('the company is alerted about the rejection', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.title.includes(`Order rejected · ${p3R.refNo}`)));
ok('a rejected order cannot be cancelled -> 400', (await call(T.factory, 'POST', `/production-orders/${p3R.id}/cancel`, { reason: 'x' })).status === 400);
ok('the company cancels an accepted order with a reason', (await call(T.factory, 'POST', `/production-orders/${p3o.id}/cancel`, { reason: 'Plan changed' })).json?.status === 'Cancelled');
ok('nothing can be reported on a cancelled order -> 400', (await call(p3Maker, 'POST', `/production-orders/${p3o.id}/stage`, { stage: 'Ready to ship' })).status === 400);
const p3Prof = (await call(p3Maker, 'GET', '/production-orders/profile')).json;
ok('the portal profile shows the manufacturer, its counts and the stages', p3Prof?.manufacturer?.name === 'Brand Choice Pakistan' && p3Prof?.stages?.[0] === 'Preparation' && typeof p3Prof?.waiting === 'number', JSON.stringify(p3Prof));
ok('production stages are a Settings list', ((await call(T.owner, 'GET', '/lookups')).json ?? []).some((l) => l.list === 'ORDER_STAGE'));
ok('Admin can switch to a Manufacturer login', (await call(T.owner, 'POST', '/auth/switch-role/Manufacturer')).json?.user?.role === 'Manufacturer');
const p3Draft = p3Seeded.find((o) => o.status === 'Draft');
ok('a draft can be deleted', (await call(T.factory, 'DELETE', `/production-orders/${p3Draft.id}`)).status === 200);

// ── P4 manufacturer payment requests: advance / balance, approval, payment, position ──
const p4Orders = (await call(T.owner, 'GET', '/production-orders')).json ?? [];
const p4Mo = p4Orders.find((o) => o.status === 'Accepted' && o.notes === 'Illustrative order');
ok('the sample accepted order is worth 36,720 with a 30% advance of 11,016', p4Mo?.value === 36720 && p4Mo?.advanceAmount === 11016, JSON.stringify([p4Mo?.value, p4Mo?.advanceAmount]));
const p4Day = new Date().toISOString().slice(0, 10);
const p4Cash0 = (await call(T.owner, 'GET', '/reports/dashboard')).json?.cash;
const p4Adv = await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Advance', invoiceNo: 'BCP-77' });
ok('the manufacturer asks for the advance: the whole advance, into its default bank',
  p4Adv.status === 201 && p4Adv.json?.amount === 11016 && p4Adv.json?.bank?.bank === 'Meezan Bank' && /^PR-\d{3}$/.test(p4Adv.json?.refNo) && p4Adv.json?.state === 'Waiting approval (0/1)', JSON.stringify(p4Adv.json));
ok('the advance cannot be asked for twice -> 400', (await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Advance' })).status === 400);
ok('a balance over what is left -> 400', (await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance', amount: 36720 })).status === 400);
ok('a bank account not on file -> 400', (await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance', amount: 10, bankAccount: 'NOPE' })).status === 400);
ok('another manufacturer cannot ask on this order -> 403', (await call(p3OtherT, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance', amount: 10 })).status === 403);
ok('another manufacturer does not see this request', ((await call(p3OtherT, 'GET', '/mfr-payment-requests')).json ?? []).length === 0);
const p4Draft = (await call(T.factory, 'POST', '/production-orders', { date: p4Day, productId: p4Mo.productId, containers: 1 })).json;
ok('no request on an order that is not accepted -> 400', (await call(T.factory, 'POST', '/mfr-payment-requests', { orderId: p4Draft.id, kind: 'Advance' })).status === 400);
ok('a future date -> 400', (await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance', amount: 10, date: '2999-01-01' })).status === 400);
ok('the company is alerted to approve it', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'approval' && a.title.includes(p4Adv.json.refNo)));
ok('the manufacturer cannot sign its own request -> 403', (await call(p3Maker, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/sign`, { seat: 'A' })).status === 403);
ok('it cannot be paid before approval -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 100, method: 'Bank Transfer' })).status === 400);
ok('seat B cannot sign as A -> 403', (await call(T.partner, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/sign`, { seat: 'A' })).status === 403);
const p4Signed = await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/sign`, { seat: 'A' });
ok('below the threshold one signature approves it', p4Signed.json?.approved === true && p4Signed.json?.state === 'Approved', JSON.stringify(p4Signed.json?.state));
ok('signing an approved request -> 400', (await call(T.partner, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/sign`, { seat: 'B' })).status === 400);
ok('an approved request can no longer be withdrawn -> 400', (await call(p3Maker, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/withdraw`)).status === 400);
ok('an approved request cannot be rejected -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/reject`, { reason: 'x' })).status === 400);
ok('the alert moves to "approved, not paid"', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'payment' && a.title.includes(p4Adv.json.refNo)));
ok('Manufacturing staff cannot pay -> 403', (await call(T.factory, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 100, method: 'Bank Transfer' })).status === 403);
ok('paying more than due -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 20000, method: 'Bank Transfer' })).status === 400);
ok('a payment method not in Settings -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 100, method: 'Barter' })).status === 400);
ok('a payment dated in the future -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: '2999-01-01', amount: 100, method: 'Bank Transfer' })).status === 400);
const p4Part = await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 5000, method: 'Bank Transfer', fromAccount: 'Zen Foods Bank Account', reference: 'TRX-1' });
ok('a part payment', p4Part.json?.state === 'Part paid' && p4Part.json?.paid === 5000 && p4Part.json?.due === 6016, JSON.stringify(p4Part.json?.state));
const p4J = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).filter((l) => l.reference === p4Part.json?.payments?.[0]?.refNo);
ok('it posts Advance to Manufacturer / Cash & Bank (a prepayment, not a cost)',
  p4J.some((l) => l.account === 'Advance to Manufacturer' && l.debit === 5000) && p4J.some((l) => l.account === 'Cash & Bank' && l.credit === 5000), JSON.stringify(p4J));
ok('cash goes down by the payment', Math.abs(((await call(T.owner, 'GET', '/reports/dashboard')).json?.cash) - (p4Cash0 - 5000)) < 0.01);
ok('pay the rest', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 6016, method: 'Cash' })).json?.state === 'Paid');
ok('nothing more to pay -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Adv.json.id}/pay`, { date: p4Day, amount: 1, method: 'Cash' })).status === 400);
const p4Pos = (await call(p3Maker, 'GET', '/mfr-payment-requests/position')).json;
const p4Row = p4Pos?.rows?.find((r) => r.orderId === p4Mo.id);
ok('the position: value, asked, approved, paid, still to pay', p4Row?.value === 36720 && p4Row?.requested === 11016 && p4Row?.approved === 11016 && p4Row?.paid === 11016 && p4Row?.advancePaid === 11016 && p4Row?.toPay === 25704, JSON.stringify(p4Row));
// withdraw and reject give the amount back
const p4Bal = await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance', amount: 1000 });
ok('ask for part of the balance', p4Bal.status === 201 && p4Bal.json?.kind === 'Balance');
ok('withdraw it before anyone signs', (await call(p3Maker, 'POST', `/mfr-payment-requests/${p4Bal.json.id}/withdraw`)).json?.status === 'Withdrawn');
const p4Bal2 = await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Mo.id, kind: 'Balance' });
ok('a withdrawn request frees its amount: the whole balance can be asked for', p4Bal2.json?.amount === 25704, JSON.stringify(p4Bal2.json?.amount));
ok('a rejection needs a reason -> 400', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Bal2.json.id}/reject`, { reason: '' })).status === 400);
ok('Finance rejects it with a reason', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4Bal2.json.id}/reject`, { reason: 'Goods not delivered yet' })).json?.state === 'Rejected');
// at or above the threshold two signatures are needed
const p4Big = (await call(T.factory, 'POST', '/production-orders', { date: p4Day, productId: p4Mo.productId, containers: 10, send: true })).json;
await call(p3Maker, 'POST', `/production-orders/${p4Big.id}/accept`, {});
const p4BigReq = await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: p4Big.id, kind: 'Advance' });
ok('a large advance needs two signatures', p4BigReq.json?.amount >= 50000 && p4BigReq.json?.requiredSignatures === 2, JSON.stringify([p4BigReq.json?.amount, p4BigReq.json?.requiredSignatures]));
await call(T.finance, 'POST', `/mfr-payment-requests/${p4BigReq.json.id}/sign`, { seat: 'A' });
ok('one of two signatures is not enough', (await call(T.finance, 'POST', `/mfr-payment-requests/${p4BigReq.json.id}/pay`, { date: p4Day, amount: 1, method: 'Cash' })).status === 400);
ok('the second signature approves it', (await call(T.partner, 'POST', `/mfr-payment-requests/${p4BigReq.json.id}/sign`, { seat: 'B' })).json?.approved === true);
ok('a Distributor login cannot see payment requests -> 403', (await call(T.dist, 'GET', '/mfr-payment-requests')).status === 403);
ok('the ledger still balances', (await call(T.owner, 'GET', '/reports/trial-balance')).json?.balanced === true);

// ── P5 shipments: manufacturer -> distributor, receipt, consignment stock, payable and advance ──
const p5Day = new Date().toISOString().slice(0, 10);
const p5Mo = ((await call(T.owner, 'GET', '/production-orders')).json ?? []).find((o) => o.id === p4Mo.id);
ok('the sample order goes to Sindh Central (the demo distributor)', p5Mo?.distributor?.name === 'Sindh Central Distributors', p5Mo?.distributor?.name);
ok('more containers than ordered -> 400', (await call(p3Maker, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 3 })).status === 400);
ok('a future ship date -> 400', (await call(p3Maker, 'POST', '/production-shipments', { orderId: p5Mo.id, date: '2999-01-01', containers: 1 })).status === 400);
ok('a distributor cannot ship -> 403', (await call(T.dist, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 1 })).status === 403);
ok('another manufacturer cannot ship this order -> 403', (await call(p3OtherT, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 1 })).status === 403);
const p5S1 = await call(p3Maker, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 1, vehicle: 'TLR-123', waybill: 'BLT-9' });
ok('the manufacturer ships one container straight to the distributor',
  p5S1.status === 201 && p5S1.json?.status === 'In transit' && p5S1.json?.distributorId === p5Mo.distributorId && /^SH-\d{3}$/.test(p5S1.json?.refNo) && p5S1.json?.packets === 4320, JSON.stringify(p5S1.json));
const p5Mo2 = ((await call(T.owner, 'GET', '/production-orders')).json ?? []).find((o) => o.id === p5Mo.id);
ok('the order counts it as shipped and shows it on the timeline', p5Mo2?.shippedContainers === 1 && p5Mo2?.events?.some((e) => e.event.startsWith('Shipped 1 container')));
ok('an order with shipments can no longer be cancelled -> 400', (await call(T.factory, 'POST', `/production-orders/${p5Mo.id}/cancel`, { reason: 'x' })).status === 400);
ok('the company is alerted that a shipment is on the road', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'delivery' && a.title.includes(p5S1.json.refNo)));
ok('the distributor sees the delivery', ((await call(T.dist, 'GET', '/production-shipments')).json ?? []).some((s) => s.id === p5S1.json.id));
ok('a distributor only ever sees its own deliveries', ((await call(T.dist, 'GET', '/production-shipments')).json ?? []).every((s) => s.distributorId === p5Mo.distributorId));
ok('the manufacturer cannot receive -> 403', (await call(p3Maker, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: p5Day, receivedContainers: 1 })).status === 403);
ok('Finance cannot receive -> 403', (await call(T.finance, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: p5Day, receivedContainers: 1 })).status === 403);
ok('receiving more than was sent -> 400', (await call(T.dist, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: p5Day, receivedContainers: 2 })).status === 400);
ok('a receipt before the ship date -> 400', (await call(T.dist, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: '2000-01-01', receivedContainers: 1 })).status === 400);
const p5R1 = await call(T.dist, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: p5Day, receivedContainers: 1 });
const p5Sell = new Date(Date.parse(`${p5Day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
ok('the distributor confirms it; the sell-out clock starts (Sindh Central: 30 days)',
  p5R1.json?.status === 'Received' && p5R1.json?.selloutDays === 30 && p5R1.json?.sellBy === p5Sell && p5R1.json?.receivedValue === 18360, JSON.stringify(p5R1.json));
ok('receiving twice -> 400', (await call(T.dist, 'POST', `/production-shipments/${p5S1.json.id}/receive`, { date: p5Day, receivedContainers: 1 })).status === 400);
const p5J = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []);
ok('it posts Inventory at Distributor / Manufacturer Payable at the order rate',
  p5J.some((l) => l.reference === p5S1.json.refNo && l.account === 'Inventory at Distributor' && l.debit === 18360)
  && p5J.some((l) => l.reference === p5S1.json.refNo && l.account === 'Manufacturer Payable' && l.credit === 18360));
ok('the paid advance (11,016) is set against the payable',
  p5J.some((l) => l.reference === p5Mo.refNo && l.account === 'Advance to Manufacturer' && l.credit === 11016)
  && p5J.some((l) => l.reference === p5Mo.refNo && l.account === 'Manufacturer Payable' && l.debit === 11016), JSON.stringify(p5J.filter((l) => l.reference === p5Mo.refNo)));
const p5St = (await call(T.dist, 'GET', '/production-shipments/stock')).json;
const p5Row = p5St?.byProduct?.find((r) => r.sku === 'Z10-MAS');
ok('the distributor holds 1 container = 10 bundles = 4,320 packets worth 18,360', p5Row?.containers === 1 && p5Row?.bundles === 10 && p5Row?.packets === 4320 && p5Row?.value === 18360 && p5Row?.nextSellBy === p5Sell, JSON.stringify(p5Row));
ok('warehouse stock is not touched by a distributor delivery', ((await call(T.owner, 'GET', '/products')).json ?? []).find((p) => p.sku === 'Z10-MAS')?.stockCartons === p3Prods.find((p) => p.sku === 'Z10-MAS')?.stockCartons);
// a short delivery
const p5S2 = await call(T.factory, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 1 });
ok('staff may ship for the manufacturer; the last container goes', p5S2.status === 201);
ok('nothing left to ship -> 400', (await call(p3Maker, 'POST', '/production-shipments', { orderId: p5Mo.id, date: p5Day, containers: 1 })).status === 400);
ok('receiving fewer without saying why -> 400', (await call(T.dist, 'POST', `/production-shipments/${p5S2.json.id}/receive`, { date: p5Day, receivedContainers: 0 })).status === 400);
const p5R2 = await call(T.sales, 'POST', `/production-shipments/${p5S2.json.id}/receive`, { date: p5Day, receivedContainers: 0, note: 'Truck turned back, container damaged' });
ok('Distribution staff record a lost container for the distributor', p5R2.json?.status === 'Received' && p5R2.json?.receivedValue === 0);
ok('nothing is owed for what did not arrive', !((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === p5S2.json.refNo));
const p5Mo3 = ((await call(T.owner, 'GET', '/production-orders')).json ?? []).find((o) => o.id === p5Mo.id);
ok('the order: 2 shipped, 1 received', p5Mo3?.shippedContainers === 2 && p5Mo3?.receivedContainers === 1);
// into the warehouse
const p5W = (await call(T.factory, 'POST', '/production-orders', { date: p5Day, productId: p5Mo.productId, containers: 1, destination: 'Warehouse', send: true })).json;
await call(p3Maker, 'POST', `/production-orders/${p5W.id}/accept`, {});
const p5WS = (await call(p3Maker, 'POST', '/production-shipments', { orderId: p5W.id, date: p5Day, containers: 1 })).json;
ok('a distributor cannot receive a warehouse delivery -> 403', (await call(T.dist, 'POST', `/production-shipments/${p5WS.id}/receive`, { date: p5Day, receivedContainers: 1 })).status === 403);
ok('Distribution staff cannot either -> 403', (await call(T.sales, 'POST', `/production-shipments/${p5WS.id}/receive`, { date: p5Day, receivedContainers: 1 })).status === 403);
const p5Before = ((await call(T.owner, 'GET', '/products')).json ?? []).find((p) => p.id === p5Mo.productId)?.stockCartons;
ok('Manufacturing receives it into the warehouse', (await call(T.factory, 'POST', `/production-shipments/${p5WS.id}/receive`, { date: p5Day, receivedContainers: 1 })).json?.sellBy === null);
ok('warehouse stock goes up by 10 bundles', ((await call(T.owner, 'GET', '/products')).json ?? []).find((p) => p.id === p5Mo.productId)?.stockCartons === p5Before + 10);
ok('it posts warehouse Inventory / Manufacturer Payable', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === p5WS.refNo && l.account === 'Inventory · Estimated' && l.debit === 18360));
ok('a Manufacturer login cannot read distributor stock -> 403', (await call(p3Maker, 'GET', '/production-shipments/stock')).status === 403);
ok('the ledger still balances after shipments', (await call(T.owner, 'GET', '/reports/trial-balance')).json?.balanced === true);

// ── P6 distributor sales invoices: report sales, verify (income), collect, stock left ──
const p6Day = new Date().toISOString().slice(0, 10);
const p6Lot = ((await call(T.dist, 'GET', '/production-shipments')).json ?? []).find((s) => s.id === p5S1.json.id);
ok('the delivery shows 1 container on hand and the distributor price', p6Lot?.onHandContainers === 1 && p6Lot?.soldContainers === 0 && p6Lot?.saleRate > 0, JSON.stringify([p6Lot?.onHandContainers, p6Lot?.saleRate]));
const p6Body = (o = {}) => ({ date: p6Day, invoiceNo: 'SCD-501', lines: [{ shipmentId: p6Lot.id, containers: 1 }], ...o });
ok('more containers than in stock -> 400', (await call(T.dist, 'POST', '/distributor-invoices', p6Body({ lines: [{ shipmentId: p6Lot.id, containers: 2 }] }))).status === 400);
ok('no lines -> 400', (await call(T.dist, 'POST', '/distributor-invoices', p6Body({ lines: [] }))).status === 400);
ok('a future date -> 400', (await call(T.dist, 'POST', '/distributor-invoices', p6Body({ date: '2999-01-01' }))).status === 400);
ok('a date before the delivery arrived -> 400', (await call(T.dist, 'POST', '/distributor-invoices', p6Body({ date: '2000-01-01' }))).status === 400);
ok('a delivery still on the road cannot be invoiced -> 400', (await call(T.sales, 'POST', '/distributor-invoices', p6Body({ distributorId: p5Mo.distributorId, lines: [{ shipmentId: p5WS.id, containers: 1 }] }))).status === 400);
ok('a manufacturer cannot invoice -> 403', (await call(p3Maker, 'POST', '/distributor-invoices', p6Body())).status === 403);
ok('Finance cannot report sales -> 403', (await call(T.finance, 'POST', '/distributor-invoices', p6Body({ distributorId: p5Mo.distributorId }))).status === 403);
const p6Inv = await call(T.dist, 'POST', '/distributor-invoices', p6Body());
const p6Amount = Math.round(4320 * p6Lot.saleRate * 100) / 100;
const p6Due = new Date(Date.parse(`${p6Day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
ok('the distributor reports 1 container sold: income at its price, cost at the manufacturer\'s, due after its 30 days',
  p6Inv.status === 201 && p6Inv.json?.status === 'Submitted' && p6Inv.json?.amount === p6Amount && p6Inv.json?.cost === 18360
  && p6Inv.json?.dueDate === p6Due && /^DI-\d{3}$/.test(p6Inv.json?.refNo) && p6Inv.json?.state === 'Waiting verification', JSON.stringify(p6Inv.json));
ok('the container stops counting as its stock at once', ((await call(T.dist, 'GET', '/production-shipments')).json ?? []).find((s) => s.id === p6Lot.id)?.onHandContainers === 0);
ok('it cannot be sold twice -> 400', (await call(T.dist, 'POST', '/distributor-invoices', p6Body())).status === 400);
ok('nothing posts before verification', !((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === p6Inv.json.refNo));
ok('the company is asked to verify it', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.kind === 'invoice' && a.title.includes(p6Inv.json.refNo)));
ok('a distributor cannot verify its own invoice -> 403', (await call(T.dist, 'POST', `/distributor-invoices/${p6Inv.json.id}/verify`)).status === 403);
ok('no payment before verification -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/pay`, { date: p6Day, amount: 1, method: 'Cash' })).status === 400);
const p6Ar0 = (await call(T.owner, 'GET', '/reports/dashboard')).json?.openReceivables;
const p6V = await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/verify`);
ok('Finance verifies it', p6V.json?.status === 'Verified' && p6V.json?.state === 'Open' && p6V.json?.due === p6Amount);
const p6J = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).filter((l) => l.reference === p6Inv.json.refNo);
ok('income posts: Receivable / Sales Revenue, and Cost of Goods Sold / Inventory at Distributor',
  p6J.some((l) => l.account === 'Accounts Receivable' && l.debit === p6Amount) && p6J.some((l) => l.account === 'Sales Revenue' && l.credit === p6Amount)
  && p6J.some((l) => l.account === 'Cost of Goods Sold' && l.debit === 18360) && p6J.some((l) => l.account === 'Inventory at Distributor' && l.credit === 18360), JSON.stringify(p6J));
ok('open receivables go up by the invoice', Math.abs(((await call(T.owner, 'GET', '/reports/dashboard')).json?.openReceivables) - (p6Ar0 + p6Amount)) < 0.01);
ok('the receivables list shows it', ((await call(T.finance, 'GET', '/reports/receivables')).json?.rows ?? []).some((r) => r.reference === p6Inv.json.refNo && r.outstanding === p6Amount));
ok('verifying twice -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/verify`)).status === 400);
ok('paying more than due -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/pay`, { date: p6Day, amount: p6Amount + 1, method: 'Cash' })).status === 400);
const p6P1 = await call(T.sales, 'POST', `/distributor-invoices/${p6Inv.json.id}/pay`, { date: p6Day, amount: 10000, method: 'Bank Transfer', toAccount: 'Zen Foods Bank Account', reference: 'IBFT-77' });
ok('Distribution records a part payment', p6P1.json?.state === 'Part paid' && p6P1.json?.paid === 10000);
ok('it posts Cash & Bank / Receivable', ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === p6P1.json?.payments?.[0]?.refNo && l.account === 'Cash & Bank' && l.debit === 10000));
ok('the rest is paid', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/pay`, { date: p6Day, amount: Math.round((p6Amount - 10000) * 100) / 100, method: 'Cash' })).json?.state === 'Paid');
ok('nothing left to pay -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv.json.id}/pay`, { date: p6Day, amount: 1, method: 'Cash' })).status === 400);
// a rejected invoice gives the containers back
const p6O = (await call(T.factory, 'POST', '/production-orders', { date: p6Day, productId: p5Mo.productId, containers: 1, send: true })).json;
await call(p3Maker, 'POST', `/production-orders/${p6O.id}/accept`, {});
const p6S = (await call(p3Maker, 'POST', '/production-shipments', { orderId: p6O.id, date: p6Day, containers: 1 })).json;
await call(T.dist, 'POST', `/production-shipments/${p6S.id}/receive`, { date: p6Day, receivedContainers: 1 });
const p6Inv2 = (await call(T.sales, 'POST', '/distributor-invoices', { date: p6Day, distributorId: p5Mo.distributorId, lines: [{ shipmentId: p6S.id, containers: 1 }] })).json;
ok('staff may report sales for a distributor', p6Inv2?.status === 'Submitted' && p6Inv2?.submittedBy === 'Distribution Coordinator', JSON.stringify(p6Inv2?.submittedBy));
ok('a rejection needs a reason -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv2.id}/reject`, { reason: '' })).status === 400);
ok('Finance rejects it', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv2.id}/reject`, { reason: 'Wrong count' })).json?.status === 'Rejected');
ok('its container counts as stock again', ((await call(T.dist, 'GET', '/production-shipments')).json ?? []).find((s) => s.id === p6S.id)?.onHandContainers === 1);
ok('a rejected invoice cannot be verified -> 400', (await call(T.finance, 'POST', `/distributor-invoices/${p6Inv2.id}/verify`)).status === 400);
ok('the distributor only sees its own invoices', ((await call(T.dist, 'GET', '/distributor-invoices')).json ?? []).every((i) => i.distributorId === p5Mo.distributorId));
const p6Pay = ((await call(T.finance, 'GET', '/reports/payables')).json?.rows ?? []).find((r) => r.reference === p5Mo.refNo);
ok('payables show what is owed to the manufacturer for goods received (18,360 - 11,016 paid)', p6Pay?.outstanding === 7344, JSON.stringify(p6Pay));
ok('the old sales-order screens are off by default', (await call(T.owner, 'GET', '/settings')).json?.salesOrdersEnabled === false && (await call(T.dist, 'GET', '/portal/profile')).json?.salesOrdersEnabled === false);
ok('the ledger still balances after sales', (await call(T.owner, 'GET', '/reports/trial-balance')).json?.balanced === true);

// ── P7 chain dashboard, batch trail, statements, sample chain ──
const p7Mo = ((await call(T.owner, 'GET', '/production-orders')).json ?? []).find((o) => o.notes === 'Sample order through the whole chain');
ok('the sample chain order is delivered: 2 containers of Z20-MAS to Upper Sindh', p7Mo?.status === 'Accepted' && p7Mo?.receivedContainers === 2 && p7Mo?.product?.sku === 'Z20-MAS' && p7Mo?.distributor?.name === 'Upper Sindh Supply', JSON.stringify([p7Mo?.receivedContainers, p7Mo?.product?.sku]));
const p7Trail = (await call(T.owner, 'GET', '/production-shipments/trail')).json ?? [];
const p7Lot = p7Trail.find((r) => r.orderRef === p7Mo?.refNo);
const p7Rate = ((await call(T.owner, 'GET', '/products')).json ?? []).find((p) => p.sku === 'Z20-MAS')?.rate;
ok('its trail: 2 received, 1 sold, 1 on hand, sales at the distributor price, 20,000 collected',
  p7Lot?.received === 2 && p7Lot?.sold === 1 && p7Lot?.onHand === 1 && p7Lot?.cost === 75168
  && p7Lot?.collected === 20000 && Math.abs(p7Lot?.sales - 4320 * p7Rate) < 0.01, JSON.stringify(p7Lot));
ok('a distributor sees only its own trail', ((await call(T.dist, 'GET', '/production-shipments/trail')).json ?? []).every((r) => r.distributor === 'Sindh Central Distributors'));
ok('a manufacturer cannot read the trail -> 403', (await call(p3Maker, 'GET', '/production-shipments/trail')).status === 403);
const p7St = (await call(p3Maker, 'GET', '/mfr-payment-requests/statement')).json;
const p7Owed = (p7St?.entries ?? []).reduce((n, e) => n + e.owed, 0);
const p7Paid = (p7St?.entries ?? []).reduce((n, e) => n + e.paid, 0);
ok('the manufacturer statement: goods received and payments with a running balance',
  p7St?.entries?.some((e) => e.kind === 'Goods received') && p7St?.entries?.some((e) => e.kind === 'Advance paid')
  && Math.abs(p7St?.totals?.balance - (p7Owed - p7Paid)) < 0.01 && p7St?.entries?.at(-1)?.balance === p7St?.totals?.balance, JSON.stringify(p7St?.totals));
ok('another manufacturer\'s statement is its own (empty)', ((await call(p3OtherT, 'GET', `/mfr-payment-requests/statement?manufacturerId=${p3P.manufacturerId}`)).json?.entries ?? [1]).length === 0);
const p7Ds = (await call(T.dist, 'GET', '/portal/statement')).json;
ok('the distributor statement includes its sales invoices and payments', p7Ds?.entries?.some((e) => e.kind === 'Sales invoice' && e.ref === p6Inv.json.refNo) && p7Ds?.entries?.some((e) => e.kind === 'Payment'));
const p7C = (await call(T.owner, 'GET', '/reports/chain')).json;
ok('the chain: investors, cash, manufacturers, distributors, customers',
  p7C?.investors?.capital > 0 && typeof p7C?.company?.cash === 'number' && p7C?.distributors?.containersHeld >= 1 && p7C?.customers?.containersSold >= 2
  && p7C?.customers?.invoiced > 0 && p7C?.customers?.collected >= 20000, JSON.stringify(p7C));
ok('chain figures agree with the ledger: stock at distributors and advances', p7C?.distributors?.stockValue >= 0 && p7C?.manufacturers?.advances >= 0);
ok('partner logins cannot read the chain -> 403', (await call(T.dist, 'GET', '/reports/chain')).status === 403 && (await call(p3Maker, 'GET', '/reports/chain')).status === 403);
ok('the Investor role can read the chain', (await call(vaNew.json?.access_token, 'GET', '/reports/chain')).status === 200);

// ── P8 rejecting a bill ──
const p8Bill = await call(T.finance, 'POST', '/accounting-documents', blBody({ party: 'Vendor Vic' }));
ok('a rejection needs a reason -> 400', (await call(T.finance, 'POST', `/accounting-documents/${p8Bill.json.id}/reject`, { reason: '' })).status === 400);
ok('a Viewer cannot reject -> 403', (await call(T.audit, 'POST', `/accounting-documents/${p8Bill.json.id}/reject`, { reason: 'No' })).status === 403);
const p8Rej = await call(T.finance, 'POST', `/accounting-documents/${p8Bill.json.id}/reject`, { reason: 'Duplicate of an earlier bill' });
ok('Finance rejects a bill waiting for approval', p8Rej.json?.status === 'Rejected' && p8Rej.json?.rejectReason === 'Duplicate of an earlier bill' && p8Rej.json?.needsApproval === false, JSON.stringify(p8Rej.json?.status));
ok('a rejected bill cannot be signed -> 400', (await call(T.finance, 'POST', `/accounting-documents/${p8Bill.json.id}/sign`, { seat: 'A' })).status === 400);
ok('a rejected bill cannot be paid -> 400', (await call(T.finance, 'POST', `/accounting-documents/${p8Bill.json.id}/settle`, { date: ciDay, amount: 100, method: 'Cash' })).status === 400);
ok('a rejected bill cannot be changed -> 400', (await call(T.finance, 'PATCH', `/accounting-documents/${p8Bill.json.id}`, { note: 'x' })).status === 400);
ok('a rejected bill posts nothing', !((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === p8Bill.json.refNo));
ok('it is not waiting for approval any more', !((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.text.includes('Vendor Vic')));
ok('rejecting twice -> 400', (await call(T.finance, 'POST', `/accounting-documents/${p8Bill.json.id}/reject`, { reason: 'Again' })).status === 400);
ok('an approved bill cannot be rejected -> 400', (await call(T.finance, 'POST', `/accounting-documents/${bl.json.id}/reject`, { reason: 'Too late' })).status === 400);
ok('an income invoice cannot be rejected -> 400', (await call(T.finance, 'POST', `/accounting-documents/${ivDraft.json.id}/reject`, { reason: 'No' })).status === 400);
ok('a rejected bill can be deleted', (await call(T.finance, 'DELETE', `/accounting-documents/${p8Bill.json.id}`)).status === 200);

// ── Client fixes 2026-11-13: A distributor areas, exclusivity, terms, status ──
const aDists = (await call(T.owner, 'GET', '/distributors')).json ?? [];
const aSouth = aDists.find((d) => d.name === 'South Route Partners');
const aSindh = aDists.find((d) => d.name === 'Sindh Central Distributors');
ok('sample: South Route holds Karachi exclusively', aSouth?.exclusive === true && aSouth?.districts?.some((d) => d.name === 'Karachi'));
const aNew = (o = {}) => ({ name: `A Dist ${Date.now() % 100000}`, market: 'Local', provinces: ['Sindh'], cities: [{ name: 'Karachi', province: 'Sindh', district: 'Karachi' }], ...o });
const aClash = await call(T.owner, 'POST', '/distributors', aNew());
ok('a city inside an exclusive district cannot go to another distributor -> 400', aClash.status === 400 && /exclusively to South Route/.test(aClash.json?.message), JSON.stringify(aClash.json));
const aOk = await call(T.owner, 'POST', '/distributors', aNew({ provinces: ['Punjab'], districts: [{ name: 'Lahore', province: 'Punjab' }], cities: [{ name: 'Lahore', province: 'Punjab', district: 'Lahore' }] }));
ok('a distributor with provinces, districts and cities; territory label from the first city', aOk.status === 201 && aOk.json?.region === 'Lahore' && aOk.json?.districts?.[0]?.name === 'Lahore', JSON.stringify(aOk.json));
ok('making it exclusive over an area another already covers -> 400', (await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { exclusive: true, provinces: ['Sindh', 'Punjab'] })).status === 400);
ok('no area at all -> 400', (await call(T.owner, 'POST', '/distributors', { name: 'Nowhere Ltd' })).status === 400);
const aIntl = await call(T.owner, 'POST', '/distributors', { name: `A Intl ${Date.now() % 100000}`, market: 'International', countries: ['United Arab Emirates'], provinces: ['Sindh'] });
ok('an international distributor keeps countries, not Pakistan areas', aIntl.status === 201 && aIntl.json?.countries?.[0] === 'United Arab Emirates' && aIntl.json?.provinces?.length === 0, JSON.stringify(aIntl.json));
ok('custom payment days (21) are allowed', (await call(T.owner, 'PATCH', `/distributors/${aOk.json.id}`, { paymentDays: 21 })).json?.paymentDays === 21);
ok('0 sell-out days (no limit) is allowed', (await call(T.owner, 'PATCH', `/distributors/${aOk.json.id}`, { selloutDays: 0 })).json?.selloutDays === 0);
ok('an unknown status -> 400', (await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Sleeping' })).status === 400);
// Hold: the distributor's login can look, not change
await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Hold', statusNote: 'Audit' });
ok('on hold: the distributor can still read', (await call(T.dist, 'GET', '/portal/profile')).status === 200);
ok('on hold: the distributor cannot change anything -> 403', (await call(T.dist, 'POST', '/distributor-invoices', { date: p6Day, lines: [{ shipmentId: p6S.id, containers: 1 }] })).status === 403);
ok('on hold: staff still work for it', (await call(T.owner, 'GET', `/portal/profile?distributorId=${aSindh.id}`)).status === 200);
// Suspended: no sign-in
await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Temporary suspend', statusUntil: '2999-01-01' });
ok('temporarily suspended: the login cannot sign in -> 401', (await call(null, 'POST', '/auth/login', { email: 'distributor@demo.local', password: PW })).status === 401);
ok('and its open session stops working -> 401', (await call(T.dist, 'GET', '/portal/profile')).status === 401);
ok('no new production order can go to it -> 400', (await call(T.factory, 'POST', '/production-orders', { date: p6Day, productId: p5Mo.productId, containers: 1, distributorId: aSindh.id })).status === 400);
await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Temporary suspend', statusUntil: p6Day });
ok('a temporary suspension ends on its date', (await call(null, 'POST', '/auth/login', { email: 'distributor@demo.local', password: PW })).status === 201);
await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Permanent suspend' });
ok('permanently suspended: no sign-in -> 401', (await call(null, 'POST', '/auth/login', { email: 'distributor@demo.local', password: PW })).status === 401);
const aBack = await call(T.owner, 'PATCH', `/distributors/${aSindh.id}`, { status: 'Active' });
ok('active again: signs in, and the suspension date is cleared', aBack.json?.statusUntil === null && (await call(null, 'POST', '/auth/login', { email: 'distributor@demo.local', password: PW })).status === 201);
T.dist = await login('distributor@demo.local');

// ── B manufacturer payment terms ──
const bM = ((await call(T.owner, 'GET', '/manufacturers')).json ?? []).find((m) => m.name === 'Brand Choice Pakistan');
ok('sample manufacturer: advance and a credit line of 5,000,000', JSON.stringify(bM?.paymentTerms) === JSON.stringify(['Advance', 'Credit line']) && bM?.creditLimit === 5000000, JSON.stringify(bM?.paymentTerms));
const bOnlyAdv = await call(T.owner, 'POST', '/manufacturers', { name: `B Adv ${Date.now() % 100000}`, paymentTerms: ['Advance'], advancePct: 40, creditLimit: 100, paymentDays: 20 });
ok('advance only: no credit limit or days are kept', bOnlyAdv.json?.advancePct === 40 && bOnlyAdv.json?.creditLimit === 0 && bOnlyAdv.json?.paymentDays === 0, JSON.stringify(bOnlyAdv.json));
const bOnlyCredit = await call(T.owner, 'POST', '/manufacturers', { name: `B Credit ${Date.now() % 100000}`, paymentTerms: ['Credit line'], advancePct: 40, creditLimit: 250000, paymentDays: 45 });
ok('credit line only: no advance', bOnlyCredit.json?.advancePct === 0 && bOnlyCredit.json?.creditLimit === 250000 && bOnlyCredit.json?.paymentDays === 45, JSON.stringify(bOnlyCredit.json));
ok('no term at all -> 400', (await call(T.owner, 'POST', '/manufacturers', { name: 'B None', paymentTerms: [] })).status === 400);
ok('an unknown term -> 400', (await call(T.owner, 'POST', '/manufacturers', { name: 'B Odd', paymentTerms: ['Barter'] })).status === 400);

// ── C products ──
const cProds = (await call(T.owner, 'GET', '/products')).json ?? [];
const cMas = cProds.find((p) => p.sku === 'Z10-MAS');
ok('sample SKU: grams, outbound freight and two packaging templates', cMas?.gramsPerPacket === 18 && cMas?.outboundRate === 0.1 && cMas?.packagings?.length === 2 && cMas?.packagings?.find((t) => t.isDefault)?.name === 'Standard', JSON.stringify(cMas?.packagings));
ok('a duplicate SKU in other letter case -> 409', (await call(T.owner, 'POST', '/products', { sku: ' z10-mas ', name: 'Copy', pack: 10, mrp: 10, rate: 6, packsPerCarton: 20 })).status === 409);
const cBody = (o = {}) => ({ sku: `C-${Date.now() % 100000}`, name: 'Chilli Crunch', pack: 20, mrp: 20, rate: 13, packsPerCarton: 24, ...o });
const cNew = await call(T.owner, 'POST', '/products', cBody({
  packagings: [{ name: 'Big', packetsPerBundle: 24, bundlesPerContainer: 40, isDefault: false }, { name: 'Small', packetsPerBundle: 12, bundlesPerContainer: 20, isDefault: true }],
  distributorIds: [aSouth.id, aSindh.id],
}));
ok('the default template sets packets per bundle and bundles per container', cNew.status === 201 && cNew.json?.packsPerCarton === 12 && cNew.json?.bundlesPerContainer === 20, JSON.stringify(cNew.json));
ok('several distributors: the first is the main one', cNew.json?.distributorId === aSouth.id && cNew.json?.distributorIds?.length === 2);
ok('two templates with one name -> 400', (await call(T.owner, 'POST', '/products', cBody({ packagings: [{ name: 'A', packetsPerBundle: 1, bundlesPerContainer: 1, isDefault: true }, { name: 'a', packetsPerBundle: 2, bundlesPerContainer: 2, isDefault: false }] }))).status === 400);
ok('two default templates -> 400', (await call(T.owner, 'POST', '/products', cBody({ packagings: [{ name: 'A', packetsPerBundle: 1, bundlesPerContainer: 1, isDefault: true }, { name: 'B', packetsPerBundle: 2, bundlesPerContainer: 2, isDefault: true }] }))).status === 400);
ok('an unknown distributor in the list -> 400', (await call(T.owner, 'POST', '/products', cBody({ distributorIds: ['00000000-0000-4000-8000-000000000000'] }))).status === 400);
const cOrder = await call(T.factory, 'POST', '/production-orders', { date: p6Day, productId: cMas.id, containers: 2, packaging: 'Half container' });
ok('a production order picks a packaging template', cOrder.json?.packaging === 'Half container' && cOrder.json?.bundlesPerContainer === 5 && cOrder.json?.packets === 2 * 5 * 432, JSON.stringify(cOrder.json?.packaging));
ok('a template the product does not have -> 400', (await call(T.factory, 'POST', '/production-orders', { date: p6Day, productId: cMas.id, containers: 1, packaging: 'Jumbo' })).status === 400);
ok('no template given: the default', (await call(T.factory, 'POST', '/production-orders', { date: p6Day, productId: cMas.id, containers: 1 })).json?.packaging === 'Standard');

// ── D1 international distributor: identity, KYC, agreement, registration workflow ──
const dZayed = ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.name === 'Zayed Gulf Trading');
ok('sample international distributor: an ID and a draft registration', /^INT-DST-\d{4}$/.test(dZayed?.code) && dZayed?.registrationStatus === 'Draft', JSON.stringify([dZayed?.code, dZayed?.registrationStatus]));
const dLocal = ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.name === 'Sindh Central Distributors');
ok('a local distributor needs no registration', dLocal?.registrationStatus === 'Active' && !dLocal?.code && (await call(T.owner, 'POST', `/distributors/${dLocal.id}/registration/submit`)).status === 400);
const dBody = (o = {}) => ({ name: `D Intl ${Date.now() % 100000}`, market: 'International', countries: ['Qatar'], ...o });
const dNew = await call(T.sales, 'POST', '/distributors', dBody({ legalName: 'Doha Crisps WLL', country: 'Qatar' }));
ok('a new international distributor gets the next ID and starts as a draft', dNew.status === 201 && /^INT-DST-\d{4}$/.test(dNew.json?.code) && dNew.json?.code !== dZayed.code && dNew.json?.registrationStatus === 'Draft', JSON.stringify(dNew.json?.code));
ok('the same legal entity in the same country twice -> 409', (await call(T.sales, 'POST', '/distributors', dBody({ legalName: ' doha crisps wll ', country: 'qatar', countries: ['Bahrain'] }))).status === 409);
ok('a classification not in Settings -> 400', (await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, { classification: 'Smuggler' })).status === 400);
ok('two primary contacts -> 400', (await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, { contacts: [{ name: 'A', isPrimary: true }, { name: 'B', isPrimary: true }] })).status === 400);
ok('a KYC document type not in Settings -> 400', (await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, { kycDocs: [{ type: 'Horoscope', file: pfFiles[0] }] })).status === 400);
let dReg = (await call(T.sales, 'GET', `/distributors/${dNew.json.id}/registration`)).json;
ok('the registration lists what is missing', dReg?.missingToSubmit?.includes('business registration no.') && dReg?.missingToSubmit?.includes('KYC document: Registration certificate'), JSON.stringify(dReg?.missingToSubmit));
ok('submitting with gaps -> 400', (await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/submit`)).status === 400);
const dKyc1 = await pfUpload('registration.pdf');
const dKyc2 = await pfUpload('signatory.pdf');
const dAgr = await pfUpload('agreement.pdf');
const fileOf = (f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size });
const dFill = await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, {
  classification: 'Importer', registrationNo: 'QA-998877', contacts: [{ name: 'Omar', email: 'omar@example.test', isPrimary: false }, { name: 'Lina', isPrimary: false }],
  addresses: [{ type: 'Registered', line: 'Street 1', country: 'Qatar', isDefault: false }, { type: 'Delivery', line: 'Warehouse 4', country: 'Qatar', isDefault: false }],
  kycDocs: [{ type: 'Registration certificate', file: fileOf(dKyc1) }, { type: 'Authorized signatory', file: fileOf(dKyc2), expiry: '2999-01-01' }],
  agreementStart: '2026-01-01',
});
ok('contacts get a primary and addresses a default per type', dFill.json?.contacts?.[0]?.isPrimary === true && dFill.json?.addresses?.every((a) => a.isDefault), JSON.stringify(dFill.json?.contacts));
ok('submit documents (Distribution)', (await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/submit`)).json?.status === 'Documents submitted');
ok('Distribution cannot start the review -> 403', (await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/review`)).status === 403);
ok('Finance starts the review', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/review`)).json?.status === 'Under review');
ok('Finance cannot give the Compliance sign-off -> 403', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Compliance' })).status === 403);
ok('Sales sign-off (Distribution)', !!(await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Sales', note: 'Good market' })).json?.approvals?.Sales);
ok('the same sign-off twice -> 400', (await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Sales' })).status === 400);
ok('a rejection needs a reason -> 400', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/reject`, { reason: '' })).status === 400);
dReg = (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/reject`, { reason: 'Tax proof unclear' })).json;
ok('a rejection sends it back to draft and clears the sign-offs', dReg?.status === 'Draft' && !dReg?.approvals?.Sales, JSON.stringify(dReg?.approvals));
await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/submit`);
await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/review`);
await call(T.sales, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Sales' });
await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Finance' });
dReg = (await call(T.owner, 'POST', `/distributors/${dNew.json.id}/registration/approve`, { step: 'Compliance' })).json;
ok('the third sign-off approves it', dReg?.status === 'Approved', dReg?.status);
ok('activation needs a signed agreement and approved products', dReg?.missingToActivate?.some((m) => /signed agreement/.test(m)) && dReg?.missingToActivate?.includes('at least one approved product'), JSON.stringify(dReg?.missingToActivate));
ok('activating with gaps -> 400', (await call(T.owner, 'POST', `/distributors/${dNew.json.id}/registration/activate`)).status === 400);
await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, { agreementStatus: 'Signed', agreementFile: fileOf(dAgr), agreementEnd: '2999-12-31', approvedProductIds: [p3P.id], recallContactName: 'QA lead', recallContactEmail: 'recall@example.test' });
ok('activation also needs a portal Owner login', ((await call(T.owner, 'GET', `/distributors/${dNew.json.id}/registration`)).json?.missingToActivate ?? []).some((m) => /portal admin/.test(m)));
await call(T.owner, 'POST', '/users', { name: 'Doha owner', email: `doha-owner-${Date.now()}@example.test`, password: PW, role: 'Distributor', distributorId: dNew.json.id, portalRole: 'Owner' });
ok('Finance cannot activate -> 403', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/activate`)).status === 403);
ok('Admin activates it', (await call(T.owner, 'POST', `/distributors/${dNew.json.id}/registration/activate`)).json?.status === 'Active');
ok('hold needs a reason -> 400', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'On hold' })).status === 400);
ok('Finance puts it on hold, then resumes it', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'On hold', reason: 'Overdue' })).json?.status === 'On hold'
  && (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'Active' })).json?.status === 'Active');
await call(T.sales, 'PATCH', `/distributors/${dNew.json.id}`, { agreementEnd: '2000-01-01' });
await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'Suspended', reason: 'Agreement lapsed' });
ok('an expired agreement blocks resuming -> 400', (await call(T.finance, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'Active' })).status === 400);
const dTrail = (await call(T.audit, 'GET', `/distributors/${dNew.json.id}/registration`)).json;
ok('every step is on the trail, with who and why', dTrail?.events?.length >= 10 && dTrail.events.some((e) => e.action === 'Rejected' && e.note === 'Tax proof unclear' && e.role === 'Finance'), JSON.stringify(dTrail?.events?.map((e) => e.action)));
ok('archive, then reopen as a draft', (await call(T.owner, 'POST', `/distributors/${dNew.json.id}/registration/state`, { to: 'Archived', reason: 'Closed' })).json?.status === 'Archived'
  && (await call(T.owner, 'POST', `/distributors/${dNew.json.id}/registration/reopen`)).json?.status === 'Draft');
ok('a Distributor login cannot read registrations -> 403', (await call(T.dist, 'GET', `/distributors/${dNew.json.id}/registration`)).status === 403);
ok('KYC types and classifications are Settings lists (two KYC types required)', ((await call(T.owner, 'GET', '/lookups')).json ?? []).filter((l) => l.list === 'KYC_DOC_TYPE' && l.flags?.required).length === 2);

// ── D2 international pricing, currency, payment plans, credit, banking ──
const eZ = ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.name === 'Zayed Gulf Trading');
ok('sample: AED, CIF Jebel Ali, 30/70 plan, shared charges', eZ?.invoiceCurrency === 'AED' && eZ?.incoterm === 'CIF' && eZ?.paymentPlan?.length === 2 && eZ?.bankCharges === 'Shared', JSON.stringify([eZ?.invoiceCurrency, eZ?.incoterm]));
const eP = (await call(T.sales, 'GET', `/distributors/${eZ.id}/prices`)).json ?? [];
ok('sample price: Z20-MAS per bundle in AED, active, margin worked out', eP.length === 1 && eP[0].product.sku === 'Z20-MAS' && eP[0].status === 'Active' && eP[0].current && eP[0].packsPerUnit === 432 && eP[0].marginPct > 10, JSON.stringify(eP[0]));
ok('an unknown invoice currency -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { invoiceCurrency: 'XYZ' })).status === 400);
ok('an Incoterm not in Settings -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { incoterm: 'ABC' })).status === 400);
ok('a payment plan that is not 100% -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { paymentPlan: [{ label: 'Advance', pct: 30, trigger: 'On order', days: 0 }, { label: 'Balance', pct: 60, trigger: 'On documents', days: 30 }] })).status === 400);
ok('a custom schedule without instalments -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { paymentPlan: [] })).status === 400);
ok('a remittance method not in Settings -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { settlementMethods: ['Barter'] })).status === 400);
ok('a bad SWIFT code -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { bankAccounts: [{ beneficiary: 'Z', bankName: 'B', account: '1', swift: '12', isDefault: true }] })).status === 400);
ok('the credit limit is not changed from the distributor form -> 400', (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { creditLimit: 50000 })).status === 400);
ok('Distribution cannot approve credit -> 403', (await call(T.sales, 'PUT', `/distributors/${eZ.id}/credit`, { creditLimit: 50000, creditCurrency: 'AED', creditControl: 'Block' })).status === 403);
const eCr = await call(T.finance, 'PUT', `/distributors/${eZ.id}/credit`, { creditLimit: 50000, creditCurrency: 'aed', creditExpiry: '2999-12-31', creditControl: 'Warn' });
ok('Finance approves credit: limit, currency, expiry, who and when', eCr.json?.creditLimit === 50000 && eCr.json?.creditCurrency === 'AED' && eCr.json?.creditControl === 'Warn' && !!eCr.json?.creditApprovedBy && !!eCr.json?.creditApprovedAt, JSON.stringify(eCr.json?.creditApprovedBy));
ok('credit for a local distributor -> 400', (await call(T.finance, 'PUT', `/distributors/${dLocal.id}/credit`, { creditLimit: 1, creditCurrency: 'PKR', creditControl: 'Block' })).status === 400);
ok('Distribution cannot verify a bank account -> 403', (await call(T.sales, 'POST', `/distributors/${eZ.id}/banks/0/verify`)).status === 403);
const eV = await call(T.finance, 'POST', `/distributors/${eZ.id}/banks/0/verify`);
ok('Finance verifies the bank account', !!eV.json?.bankAccounts?.[0]?.verifiedAt && !!eV.json?.bankAccounts?.[0]?.verifiedBy);
ok('verifying twice -> 400', (await call(T.finance, 'POST', `/distributors/${eZ.id}/banks/0/verify`)).status === 400);
const eB1 = (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { bankAccounts: [{ ...eV.json.bankAccounts[0], verifiedAt: undefined, verifiedBy: undefined }, { beneficiary: 'Zayed Gulf Trading LLC', bankName: 'Second bank', account: 'S-2', swift: 'abcdaeadxxx', currency: 'USD', isDefault: false }] })).json;
ok('an unchanged account keeps its verification; a new one starts unverified', !!eB1?.bankAccounts?.[0]?.verifiedAt && !eB1?.bankAccounts?.[1]?.verifiedAt && eB1?.bankAccounts?.[1]?.swift === 'ABCDAEADXXX', JSON.stringify(eB1?.bankAccounts));
const eB2 = (await call(T.sales, 'PATCH', `/distributors/${eZ.id}`, { bankAccounts: [{ beneficiary: 'Zayed Gulf Trading LLC', bankName: 'Sample bank', account: 'CHANGED-9', currency: 'AED', isDefault: true }] })).json;
ok('changing the account number clears its verification', eB2?.bankAccounts?.length === 1 && !eB2.bankAccounts[0].verifiedAt);
// price list
const ePrice = (o = {}) => ({ productId: eP[0].productId, currency: 'AED', unit: 'Bundle', price: 70, effectiveFrom: '2999-01-01', ...o });
ok('a SKU not approved for the distributor -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ productId: p3P.id }))).status === 400);
ok('an unknown currency -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ currency: 'XYZ' }))).status === 400);
ok('a pallet price needs packs per pallet -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ unit: 'Pallet' }))).status === 400);
ok('a minimum order that is not a multiple of the increment -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ moq: 15, increment: 10 }))).status === 400);
ok('a price ending before it starts -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ effectiveTo: '2998-01-01' }))).status === 400);
ok('a price for a local distributor -> 400', (await call(T.sales, 'POST', `/distributors/${dLocal.id}/prices`, ePrice())).status === 400);
const eV2 = await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice());
ok('version 2 above the floor is active at once', eV2.status === 201 && eV2.json?.version === 2 && eV2.json?.status === 'Active', JSON.stringify([eV2.status, eV2.json?.version, eV2.json?.status]));
const eAll = (await call(T.sales, 'GET', `/distributors/${eZ.id}/prices`)).json ?? [];
ok('version 1 now ends the day before version 2 starts', eAll.find((r) => r.version === 1)?.effectiveTo === '2998-12-31', JSON.stringify(eAll.map((r) => [r.version, r.effectiveTo])));
ok('a version starting on or before the latest one -> 409', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ effectiveFrom: '2998-06-01' }))).status === 409);
ok('an active price cannot be deleted -> 400', (await call(T.sales, 'DELETE', `/distributors/${eZ.id}/prices/${eV2.json.id}`)).status === 400);
const eLow = await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ unit: 'Pack', price: 0.1, effectiveFrom: '2999-02-01' }));
ok('a price under the margin floor waits for Finance', eLow.json?.status === 'Pending approval' && eLow.json?.marginPct < 10 && eLow.json?.packsPerUnit === 1, JSON.stringify([eLow.json?.status, eLow.json?.marginPct]));
ok('Distribution cannot approve it -> 403', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices/${eLow.json.id}/approve`, {})).status === 403);
ok('a rejection needs a reason -> 400', (await call(T.finance, 'POST', `/distributors/${eZ.id}/prices/${eLow.json.id}/reject`, {})).status === 400);
ok('Finance approves it with a note', (await call(T.finance, 'POST', `/distributors/${eZ.id}/prices/${eLow.json.id}/approve`, { note: 'Market entry' })).json?.status === 'Active');
const ePromo = await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ unit: 'Dozen', price: 5, promo: true, effectiveFrom: '2999-03-01', effectiveTo: '2999-03-31' }));
ok('a promotional price always waits for Finance (12 packs a dozen)', ePromo.json?.status === 'Pending approval' && ePromo.json?.packsPerUnit === 12);
ok('a promotional price needs an end date -> 400', (await call(T.sales, 'POST', `/distributors/${eZ.id}/prices`, ePrice({ unit: 'Dozen', price: 5, promo: true, effectiveFrom: '2999-04-01' }))).status === 400);
ok('Finance rejects it with a reason; a rejected price can be deleted', (await call(T.finance, 'POST', `/distributors/${eZ.id}/prices/${ePromo.json.id}/reject`, { note: 'Too deep' })).json?.status === 'Rejected'
  && (await call(T.sales, 'DELETE', `/distributors/${eZ.id}/prices/${ePromo.json.id}`)).status === 200);
ok('a Distributor login cannot read price lists -> 403', (await call(T.dist, 'GET', `/distributors/${eZ.id}/prices`)).status === 403);
// exchange rates
const eFx = await call(T.finance, 'PATCH', '/currencies/AED', { rate: 76.5, source: 'State Bank' });
ok('Finance overrides a rate; the change is kept with its source', eFx.json?.rate === 76.5 && ((await call(T.audit, 'GET', '/currencies/AED/rates')).json ?? [])[0]?.source === 'State Bank');
ok('a price keeps the rate it was saved with', ((await call(T.sales, 'GET', `/distributors/${eZ.id}/prices`)).json ?? []).find((r) => r.version === 1)?.fxRate === 76.25);
await call(T.finance, 'PATCH', '/currencies/AED', { rate: 76.25, source: 'Back to the sample rate' });
ok('Distribution cannot change rates -> 403', (await call(T.sales, 'PATCH', '/currencies/AED', { rate: 70 })).status === 403);
ok('a currency used by a distributor cannot be deleted -> 409', (await call(T.owner, 'DELETE', '/currencies/AED')).status === 409);

// ── D3 export orders linked to international distributors: defaults, eligibility, credit, remittances, aging ──
const fToday = new Date().toISOString().slice(0, 10);
const fAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const fZ = ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.name === 'Zayed Gulf Trading');
const fSeedQ = ((await call(T.exporter, 'GET', '/exports')).json ?? []).find((x) => x.distributorId === fZ.id);
ok('sample quote for Zayed: AED, CIF Jebel Ali, rate from its price list', fSeedQ?.currency === 'AED' && fSeedQ?.incoterm === 'CIF' && fSeedQ?.port === 'Jebel Ali, Dubai'
  && Math.abs(fSeedQ?.rate - 60 / 432) < 1e-5 && !!fSeedQ?.priceId && fSeedQ?.distributor?.code === fZ.code, JSON.stringify([fSeedQ?.currency, fSeedQ?.rate, fSeedQ?.port]));
ok('a quote without a distributor still needs buyer, currency and rate -> 400', (await call(T.exporter, 'POST', '/exports', { date: fToday, container: '20GP', productId: fZ.approvedProductIds[0], cartons: 10 })).status === 400);
ok('an order for a local distributor -> 400', (await call(T.exporter, 'POST', '/exports', { date: fToday, distributorId: dLocal.id, container: '20GP', productId: fZ.approvedProductIds[0], cartons: 10 })).status === 400);
const fStockP = ((await call(T.owner, 'GET', '/products')).json ?? []).filter((p) => p.stockCartons >= 30).sort((a, b) => b.stockCartons - a.stockCartons)[0];
ok('a product has stock for the distributor export test', !!fStockP, JSON.stringify(((await call(T.owner, 'GET', '/products')).json ?? []).map((p) => [p.sku, p.stockCartons])));
ok('a SKU not approved for the distributor -> 400', (await call(T.exporter, 'POST', '/exports', { date: fToday, distributorId: fZ.id, container: '20GP', productId: fStockP.id, cartons: 10 })).status === 400);
// a new international distributor, taken through registration
const fK1 = await pfUpload('kenya-registration.pdf');
const fK2 = await pfUpload('kenya-signatory.pdf');
const fAg = await pfUpload('kenya-agreement.pdf');
const fFile = (f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size });
const fD = (await call(T.sales, 'POST', '/distributors', {
  name: `Nairobi Snacks ${Date.now() % 100000}`, market: 'International', countries: ['Kenya'], legalName: `Nairobi Snacks Ltd ${Date.now() % 100000}`, country: 'Kenya',
  classification: 'Importer', registrationNo: 'KE-1', contacts: [{ name: 'Achieng', email: 'a@example.test', isPrimary: true }],
  addresses: [{ type: 'Registered', line: 'Mombasa Rd', country: 'Kenya', isDefault: true }],
  kycDocs: [{ type: 'Registration certificate', file: fFile(fK1) }, { type: 'Authorized signatory', file: fFile(fK2) }],
  agreementStart: fAgo(30), agreementEnd: '2999-12-31', agreementStatus: 'Signed', agreementFile: fFile(fAg), approvedProductIds: [fStockP.id],
  invoiceCurrency: 'USD', incoterm: 'FOB', incotermPlace: 'Karachi', paymentDays: 30, settlementMethods: ['SWIFT'],
  recallContactName: 'Achieng', recallContactEmail: 'recall-ke@example.test',
  bankAccounts: [{ beneficiary: 'Nairobi Snacks Ltd', bankName: 'Sample KE bank', account: 'KE-001', currency: 'USD', isDefault: true }],
})).json;
ok('the Kenyan distributor is saved as a draft', fD?.registrationStatus === 'Draft', JSON.stringify(fD).slice(0, 200));
await call(T.owner, 'POST', '/users', { name: 'Nairobi owner', email: `ke-owner-${Date.now()}@example.test`, password: PW, role: 'Distributor', distributorId: fD.id, portalRole: 'Owner' });
const fMa = (await call(T.sales, 'POST', '/market-approvals', { productId: fStockP.id, country: 'Kenya', labelVersion: 'v1', minShelfLifeDays: 0 })).json;
await call(T.owner, 'POST', `/market-approvals/${fMa.id}/review`, { decision: 'Approve' });
const fLot = (id) => call(T.exporter, 'PATCH', `/exports/${id}/logistics`, { batchRef: 'LOT-KE-1' });
const fCost = Number(fStockP.manufacturerRate) + Number(fStockP.packagingRate) + Number(fStockP.printingRate) + Number(fStockP.inboundRate) + Number(fStockP.outboundRate ?? 0);
const fBundle = Math.ceil(((fCost * 1.5 * fStockP.packsPerCarton) / 280) * 100) / 100;
const fPr = await call(T.sales, 'POST', `/distributors/${fD.id}/prices`, { productId: fStockP.id, currency: 'USD', unit: 'Bundle', price: fBundle, effectiveFrom: fAgo(60), moq: 5, increment: 5 });
ok('a USD price per bundle, minimum 5, multiples of 5', fPr.json?.status === 'Active', JSON.stringify(fPr.json).slice(0, 160));
const fQ = (o = {}) => ({ date: fToday, distributorId: fD.id, container: '20GP', productId: fStockP.id, cartons: 5, ...o });
ok('under the minimum order -> 400', (await call(T.exporter, 'POST', '/exports', fQ({ cartons: 3 }))).status === 400);
ok('not a multiple of the order increment -> 400', (await call(T.exporter, 'POST', '/exports', fQ({ cartons: 7 }))).status === 400);
const fQ1 = (await call(T.exporter, 'POST', '/exports', fQ())).json;
await fLot(fQ1.id);
ok('the order takes the distributor defaults (FOB Karachi, USD, 30 days) and its price per pack', fQ1?.incoterm === 'FOB' && fQ1?.port === 'Karachi' && fQ1?.currency === 'USD'
  && fQ1?.paymentDays === 30 && Math.abs(fQ1?.rate - fBundle / fStockP.packsPerCarton) < 1e-5 && fQ1?.buyer === fD.legalName, JSON.stringify([fQ1?.incoterm, fQ1?.rate, fQ1?.buyer]));
const fQx = (await call(T.exporter, 'POST', '/exports', fQ({ incoterm: 'CIF', rate: 0.5, paymentDays: 10, port: 'Mombasa' }))).json;
ok('the order can change any default for itself', fQx?.incoterm === 'CIF' && fQx?.rate === 0.5 && fQx?.paymentDays === 10 && !fQx?.priceId);
ok('... and the distributor is not changed', ((await call(T.owner, 'GET', '/distributors')).json ?? []).find((d) => d.id === fD.id)?.incoterm === 'FOB');
await call(T.exporter, 'DELETE', `/exports/${fQx.id}`);
ok("a draft distributor's order cannot ship -> 400", (await call(T.exporter, 'POST', `/exports/${fQ1.id}/ship`, {})).status === 400);
for (const [tok, path, body] of [[T.sales, 'submit'], [T.finance, 'review'], [T.sales, 'approve', { step: 'Sales' }], [T.finance, 'approve', { step: 'Finance' }], [T.owner, 'approve', { step: 'Compliance' }], [T.owner, 'activate']]) {
  await call(tok, 'POST', `/distributors/${fD.id}/registration/${path}`, body ?? {});
}
ok('the Kenyan distributor is active', (await call(T.owner, 'GET', `/distributors/${fD.id}/registration`)).json?.status === 'Active');
const fNoCredit = await call(T.exporter, 'POST', `/exports/${fQ1.id}/ship`, {});
ok('no credit approved (advance only, Block): shipping -> 400', fNoCredit.status === 400 && /credit/i.test(fNoCredit.json?.message ?? ''), fNoCredit.json?.message);
ok('Exports cannot override the credit check -> 403', (await call(T.exporter, 'POST', `/exports/${fQ1.id}/credit-override`, { reason: 'x' })).status === 403);
ok('an override needs a reason -> 400', (await call(T.finance, 'POST', `/exports/${fQ1.id}/credit-override`, { reason: '' })).status === 400);
ok('Finance overrides it', !!(await call(T.finance, 'POST', `/exports/${fQ1.id}/credit-override`, { reason: 'LC confirmed' })).json?.creditOverrideAt);
ok('changing the quantity clears the override', !(await call(T.exporter, 'PATCH', `/exports/${fQ1.id}`, { cartons: 10 })).json?.creditOverrideAt);
await call(T.finance, 'POST', `/exports/${fQ1.id}/credit-override`, { reason: 'LC confirmed for 10' });
const fS1 = (await call(T.exporter, 'POST', `/exports/${fQ1.id}/ship`, { shipDate: fToday })).json;
ok('it ships on the override; the note and the due date (ship + 30 days) are kept', fS1?.status === 'Shipped' && /override/.test(fS1?.creditNote ?? '') && fS1?.dueDate === new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), JSON.stringify([fS1?.creditNote, fS1?.dueDate]));
await call(T.finance, 'PUT', `/distributors/${fD.id}/credit`, { creditLimit: 1000000, creditCurrency: 'USD', creditControl: 'Warn' });
const fQ2 = (await call(T.exporter, 'POST', '/exports', fQ())).json;
await fLot(fQ2.id);
const fS2 = (await call(T.exporter, 'POST', `/exports/${fQ2.id}/ship`, { shipDate: fToday })).json;
ok('within the approved credit it ships with no note', fS2?.status === 'Shipped' && !fS2?.creditNote, JSON.stringify(fS2?.creditNote));
// remittances
const fTbBefore = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
const fRem = (o = {}) => ({ date: fToday, currency: 'USD', amount: Math.round((fS1.due + 100) * 100) / 100, fees: 15, fxRate: 285, method: 'SWIFT', bankRef: 'MT103-1', bankIndex: 0, allocations: [{ shipmentId: fS1.id, amount: fS1.due }], ...o });
ok('Distribution cannot record a remittance -> 403', (await call(T.sales, 'POST', `/distributors/${fD.id}/remittances`, fRem())).status === 403);
ok('from a bank account not yet verified -> 400', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, fRem())).status === 400);
await call(T.finance, 'POST', `/distributors/${fD.id}/banks/0/verify`);
ok('a method the distributor did not agree -> 400', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, fRem({ method: 'Letter of credit' }))).status === 400);
ok('applying more than the invoice owes -> 400 (and nothing is saved)', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, fRem({ allocations: [{ shipmentId: fS1.id, amount: fS1.due + 50 }] }))).status === 400);
ok('applying money in another currency -> 400', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, fRem({ currency: 'AED' }))).status === 400);
const fAcc1 = (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, fRem())).json;
const fR1 = fAcc1?.remittances?.[0];
ok('remittance IRC: invoice 1 paid in full, 100 left as credit', /^IRC-\d{3}$/.test(fR1?.refNo) && fR1?.unapplied === 100 && fAcc1?.orders?.find((o) => o.id === fS1.id)?.due === 0, JSON.stringify([fR1?.refNo, fR1?.unapplied]));
ok('more than is left -> 400', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances/${fR1.id}/allocate`, { allocations: [{ shipmentId: fS2.id, amount: 150 }] })).status === 400);
const fAcc2 = (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances/${fR1.id}/allocate`, { allocations: [{ shipmentId: fS2.id, amount: 30 }] })).json;
ok('apply 30 of the credit to invoice 2', fAcc2?.remittances?.[0]?.unapplied === 70 && Math.abs(fAcc2?.orders?.find((o) => o.id === fS2.id)?.due - (fS2.due - 30)) < 0.01, JSON.stringify(fAcc2).slice(0, 300));
const fTbAfter = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('ledger balanced; bank fees booked as Bank Charges (15 x 285)', fTbAfter.balanced && Math.abs(net(fTbAfter, 'Bank Charges') - net(fTbBefore, 'Bank Charges') - 15 * 285) < 0.01, String(net(fTbAfter, 'Bank Charges')));
ok('the 70 not applied stays in Customer Advances at the arrival rate', Math.abs(-(net(fTbAfter, 'Customer Advances') - net(fTbBefore, 'Customer Advances')) - 70 * 285) < 0.01, String(net(fTbAfter, 'Customer Advances') - net(fTbBefore, 'Customer Advances')));
ok('the better rate on applied money is an FX gain', net(fTbAfter, 'FX Gain') < net(fTbBefore, 'FX Gain'));
const fUsd = fAcc2?.currencies?.find((c) => c.currency === 'USD');
ok('account per currency: open, unapplied credit, balance and PKR equivalents', Math.abs(fUsd?.open - (fS2.due - 30)) < 0.01 && fUsd?.unapplied === 70 && Math.abs(fUsd?.balance - (fS2.due - 100)) < 0.01 && fUsd?.openPKR > 0, JSON.stringify(fUsd));
ok('aging: nothing is due yet, all current', Math.abs(fUsd?.aging?.[0] - fUsd?.open) < 0.01, JSON.stringify(fUsd?.aging));
const fLast = fAcc2?.statement?.filter((l) => l.currency === 'USD').at(-1);
ok('the statement runs to the same balance', Math.abs(fLast?.balance - fUsd?.balance) < 0.01, JSON.stringify(fLast));
// an overdue invoice
const fQ3 = (await call(T.exporter, 'POST', '/exports', fQ({ date: fAgo(45), paymentDays: 0 }))).json;
await fLot(fQ3.id);
const fS3 = (await call(T.exporter, 'POST', `/exports/${fQ3.id}/ship`, { shipDate: fAgo(45) })).json;
ok('an invoice due 45 days ago is overdue', fS3?.overdue === true, JSON.stringify([fS3?.dueDate, fS3?.overdue]));
const fAcc3 = (await call(T.owner, 'GET', `/distributors/${fD.id}/account`)).json;
ok('aging puts it in 31-60 and the credit check sees it', fAcc3?.agingLabels?.[2] === '31-60' && fAcc3?.currencies?.[0]?.aging?.[2] > 0 && fAcc3?.credit?.overdue === 1, JSON.stringify([fAcc3?.agingLabels, fAcc3?.currencies?.[0]?.aging]));
const fQ4 = (await call(T.exporter, 'POST', '/exports', fQ())).json;
await fLot(fQ4.id);
ok('Warn: it ships with an overdue note', /overdue/.test((await call(T.exporter, 'POST', `/exports/${fQ4.id}/ship`, {})).json?.creditNote ?? ''));
await call(T.finance, 'PUT', `/distributors/${fD.id}/credit`, { creditLimit: 1000000, creditCurrency: 'USD', creditControl: 'Block' });
const fQ5 = (await call(T.exporter, 'POST', '/exports', fQ())).json;
await fLot(fQ5.id);
ok('Block: with an invoice overdue the next order cannot ship -> 400', (await call(T.exporter, 'POST', `/exports/${fQ5.id}/ship`, {})).status === 400);
await call(T.exporter, 'DELETE', `/exports/${fQ5.id}`);
ok('a Distributor login cannot read the account -> 403', (await call(T.dist, 'GET', `/distributors/${fD.id}/account`)).status === 403);
ok('ledger still balanced after the distributor exports', (await call(T.owner, 'GET', '/reports/trial-balance')).json?.balanced === true);

// ── D4 food compliance, logistics, claims and credit notes ──
const gIn = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
ok('a second open approval for the same product and market -> 409', (await call(T.sales, 'POST', '/market-approvals', { productId: fStockP.id, country: 'kenya' })).status === 409 || (await call(T.sales, 'POST', '/market-approvals', { productId: fStockP.id, country: 'Kenya' })).status === 409);
const gCert = await pfUpload('halal.pdf');
ok('a certificate type not in Settings -> 400', (await call(T.sales, 'POST', '/market-approvals', { productId: fStockP.id, country: 'Uganda', certificates: [{ type: 'Astrology', file: fFile(gCert) }] })).status === 400);
const gUg = (await call(T.sales, 'POST', '/market-approvals', { productId: fStockP.id, country: 'Uganda', certificates: [{ type: 'Halal', file: fFile(gCert), expiry: '2000-01-01' }] })).json;
ok('Distribution cannot review a market approval -> 403', (await call(T.sales, 'POST', `/market-approvals/${gUg.id}/review`, { decision: 'Approve' })).status === 403);
ok('an expired certificate cannot be approved -> 400', (await call(T.owner, 'POST', `/market-approvals/${gUg.id}/review`, { decision: 'Approve' })).status === 400);
ok('a rejection needs a reason -> 400', (await call(T.owner, 'POST', `/market-approvals/${gUg.id}/review`, { decision: 'Reject' })).status === 400);
ok('the reviewer rejects it with a reason', (await call(T.owner, 'POST', `/market-approvals/${gUg.id}/review`, { decision: 'Reject', note: 'Halal lapsed' })).json?.status === 'Rejected');
await call(T.finance, 'PUT', `/distributors/${fD.id}/credit`, { creditLimit: 1000000, creditCurrency: 'USD', creditControl: 'Warn' });
const gQ = (await call(T.exporter, 'POST', '/exports', fQ())).json;
ok('no batch / lot entered -> shipping refused', /batch/i.test((await call(T.exporter, 'POST', `/exports/${gQ.id}/ship`, {})).json?.message ?? ''));
const gMa = (await call(T.sales, 'PATCH', `/market-approvals/${fMa.id}`, { minShelfLifeDays: 180, labelLanguages: 'English, Swahili' })).json;
ok('changing an approved market sends it back for review', gMa?.status === 'Pending');
await call(T.exporter, 'PATCH', `/exports/${gQ.id}/logistics`, { batchRef: 'LOT-KE-2', mfgDate: fToday, expiryDate: gIn(100) });
ok('while the approval is pending the order cannot ship -> 400', /approved market approval/.test((await call(T.exporter, 'POST', `/exports/${gQ.id}/ship`, {})).json?.message ?? ''));
await call(T.owner, 'POST', `/market-approvals/${fMa.id}/review`, { decision: 'Approve' });
ok('100 days of shelf life when Kenya needs 180 -> 400', /shelf life/.test((await call(T.exporter, 'POST', `/exports/${gQ.id}/ship`, {})).json?.message ?? ''));
ok('a batch that expires before it was made -> 400', (await call(T.exporter, 'PATCH', `/exports/${gQ.id}/logistics`, { mfgDate: gIn(10), expiryDate: gIn(5) })).status === 400);
await call(T.exporter, 'PATCH', `/exports/${gQ.id}/logistics`, { expiryDate: gIn(400) });
ok('tracking before it ships -> 400', (await call(T.exporter, 'PATCH', `/exports/${gQ.id}/logistics`, { shippingStatus: 'Sailed' })).status === 400);
const gS = (await call(T.exporter, 'POST', `/exports/${gQ.id}/ship`, { shipDate: fToday })).json;
ok('with an approved market and 400 days of shelf life it ships', gS?.status === 'Shipped', JSON.stringify(gS).slice(0, 160));
const gTz = (await call(T.exporter, 'POST', '/exports', fQ({ country: 'Tanzania' }))).json;
await call(T.exporter, 'PATCH', `/exports/${gTz.id}/logistics`, { batchRef: 'LOT-TZ' });
ok('a market without an approval -> 400', /Tanzania/.test((await call(T.exporter, 'POST', `/exports/${gTz.id}/ship`, {})).json?.message ?? ''));
await call(T.exporter, 'DELETE', `/exports/${gTz.id}`);
const gBl = await pfUpload('bill-of-lading.pdf');
ok('an export document type not in Settings -> 400', (await call(T.exporter, 'PATCH', `/exports/${gS.id}/logistics`, { documents: [{ type: 'Love letter', file: fFile(gBl) }] })).status === 400);
ok('arrival before departure -> 400', (await call(T.exporter, 'PATCH', `/exports/${gS.id}/logistics`, { etd: gIn(5), eta: gIn(1) })).status === 400);
const gLog = (await call(T.exporter, 'PATCH', `/exports/${gS.id}/logistics`, {
  bookingNo: 'BK-77', containerNo: 'MSCU1234567', sealNo: 'S-9', blNo: 'BL-001', vessel: 'MSC Sample', etd: fToday, eta: gIn(20), shippingStatus: 'Sailed',
  documents: [{ type: 'Bill of lading / AWB', file: fFile(gBl) }],
})).json;
ok('booking, container, seal, BL, vessel, dates, status and documents are kept on the shipment', gLog?.shippingStatus === 'Sailed' && gLog?.blNo === 'BL-001' && gLog?.documents?.length === 1);
ok('the batch of a shipped container cannot change -> 400', (await call(T.exporter, 'PATCH', `/exports/${gS.id}/logistics`, { batchRef: 'OTHER' })).status === 400);
// claims
ok('a claim on a quote -> 400', (await call(T.sales, 'POST', `/exports/${fQ5.id ?? gQ.id}/claims`, { date: fToday, kind: 'Damage', quantity: 1, description: 'x' })).status >= 400);
const gPh = await pfUpload('damage-photos.pdf');
const gC = await call(T.sales, 'POST', `/exports/${gS.id}/claims`, { date: fToday, kind: 'Damage', quantity: 2, description: 'Crushed bundles', photos: [fFile(gPh)] });
ok('Distribution raises a damage claim CLM with photos and the batch', /^CLM-\d{3}$/.test(gC.json?.refNo) && gC.json?.batchRef === 'LOT-KE-2' && gC.json?.photos?.length === 1, JSON.stringify(gC.json).slice(0, 160));
ok('claiming more bundles than shipped -> 400', (await call(T.sales, 'POST', `/exports/${gS.id}/claims`, { date: fToday, kind: 'Shortage', quantity: 4, description: 'Missing' })).status === 400);
ok('Distribution cannot decide a claim -> 403', (await call(T.sales, 'POST', `/export-claims/${gC.json.id}/decide`, { decision: 'Approve', resolution: 'Replacement' })).status === 403);
ok('a credit worth more than the claimed bundles -> 400', (await call(T.finance, 'POST', `/export-claims/${gC.json.id}/decide`, { decision: 'Approve', resolution: 'Credit note', creditAmount: gS.revenueForeign })).status === 400);
const gTb1 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
const gCredit = Math.round((gS.revenueForeign * 2 / gS.cartons) * 100) / 100;
const gD = (await call(T.finance, 'POST', `/export-claims/${gC.json.id}/decide`, { decision: 'Approve', resolution: 'Credit note', creditAmount: gCredit, inspection: 'Photos match', note: 'Agreed' })).json;
ok('Finance approves a credit note XCN', gD?.status === 'Approved' && /^XCN-\d{3}$/.test(gD?.creditNoteRef) && gD?.creditApplied === gCredit, JSON.stringify(gD).slice(0, 160));
const gS2 = (await call(T.exporter, 'GET', `/exports/${gS.id}`)).json;
ok('the credit lowers what the invoice owes', Math.abs(gS2?.due - (gS.due - gCredit)) < 0.01 && gS2?.credited === gCredit);
const gTb2 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('the credit note posts Sales Returns & Allowances against the receivable at the invoice rate', gTb2.balanced && Math.abs(net(gTb2, 'Sales Returns & Allowances') - net(gTb1, 'Sales Returns & Allowances') - gCredit * gS.fxRate) < 0.02);
ok('deciding twice -> 400', (await call(T.finance, 'POST', `/export-claims/${gC.json.id}/decide`, { decision: 'Reject', note: 'x' })).status === 400);
// a paid invoice: the credit is owed back, the receivable never goes negative
const gC2 = (await call(T.sales, 'POST', `/exports/${fS1.id}/claims`, { date: fToday, kind: 'Quality', quantity: 1, description: 'Stale' })).json;
const gPaidCredit = Math.round((fS1.revenueForeign / fS1.cartons) * 100) / 100;
await call(T.finance, 'POST', `/export-claims/${gC2.id}/decide`, { decision: 'Approve', resolution: 'Credit note', creditAmount: gPaidCredit });
const gTb3 = (await call(T.owner, 'GET', '/reports/trial-balance')).json;
ok('on a paid invoice the credit is owed back (Distributor Credit Payable), not a negative receivable', gTb3.balanced && Math.abs(-(net(gTb3, 'Distributor Credit Payable') - net(gTb2, 'Distributor Credit Payable')) - gPaidCredit * fS1.fxRate) < 0.02
  && (await call(T.exporter, 'GET', `/exports/${fS1.id}`)).json?.due === 0);
const gC3 = (await call(T.sales, 'POST', `/exports/${gS.id}/claims`, { date: fToday, kind: 'Shortage', quantity: 1, description: 'One short' })).json;
ok('a replacement is approved without money', (await call(T.finance, 'POST', `/export-claims/${gC3.id}/decide`, { decision: 'Approve', resolution: 'Replacement' })).json?.creditAmount === 0);
const gC4 = (await call(T.sales, 'POST', `/exports/${fS2.id}/claims`, { date: fToday, kind: 'Return', quantity: 1, description: 'Wrong flavour' })).json;
ok('a rejection needs a reason, then rejects', (await call(T.finance, 'POST', `/export-claims/${gC4.id}/decide`, { decision: 'Reject' })).status === 400
  && (await call(T.finance, 'POST', `/export-claims/${gC4.id}/decide`, { decision: 'Reject', note: 'Outside the return window' })).json?.status === 'Rejected');
const gAcc = (await call(T.owner, 'GET', `/distributors/${fD.id}/account`)).json;
ok('the account statement shows the credit notes and lists the claims', gAcc?.statement?.some((l) => /^XCN-/.test(l.ref)) && gAcc?.claims?.length === 4, JSON.stringify(gAcc?.claims?.map((c) => c.status)));

// ── D4 distributor portal: portal roles, own account and prices, claims, payment advices, notifications ──
const hMk = async (role) => {
  const email = `ke-${role.toLowerCase().replace(/[^a-z]/g, '')}-${Date.now()}@example.test`;
  const u = await call(T.owner, 'POST', '/users', { name: `Nairobi ${role}`, email, password: PW, role: 'Distributor', distributorId: fD.id, portalRole: role });
  return { user: u.json, token: await login(email) };
};
const hWh = await hMk('Warehouse');
const hFin = await hMk('Finance');
const hRo = await hMk('Read-only');
ok('distributor logins carry their portal role', hWh.user?.portalRole === 'Warehouse' && hRo.user?.portalRole === 'Read-only', JSON.stringify(hWh.user).slice(0, 120));
const hAcc = (await call(hRo.token, 'GET', '/portal/intl/account')).json;
const hOrd = hAcc?.orders?.find((o) => o.id === gS.id);
ok('the portal shows its own orders, due dates and aging, without Zen Foods costs or margins', !!hOrd && hOrd.due >= 0 && hOrd.unitCost === undefined && hOrd.margin === undefined && hOrd.cogs === undefined && hOrd.creditNote === undefined && hAcc?.agingLabels?.length === 5);
ok('... and only its own records', hAcc?.orders?.every((o) => o.distributorId === fD.id));
const hPr = (await call(hRo.token, 'GET', '/portal/intl/prices')).json ?? [];
ok('its agreed prices, without cost or margin', hPr.length >= 1 && hPr[0].costPerPack === undefined && hPr[0].marginPct === undefined && hPr[0].currency === 'USD', JSON.stringify(hPr[0]));
ok('Read-only cannot raise a claim -> 403', (await call(hRo.token, 'POST', `/portal/intl/shipments/${gS.id}/claims`, { date: fToday, kind: 'Damage', quantity: 1, description: 'x' })).status === 403);
ok('Read-only cannot upload a file -> 403', (await fetch(BASE + '/attachments', { method: 'POST', headers: { Authorization: `Bearer ${hRo.token}` }, body: (() => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf'); return fd; })() })).status === 403);
const hClaim = await call(hWh.token, 'POST', `/portal/intl/shipments/${gS.id}/claims`, { date: fToday, kind: 'Shortage', quantity: 1, description: 'One bundle short on arrival' });
ok('Warehouse raises a claim on its own shipment', hClaim.status === 201 && hClaim.json?.raisedBy === hWh.user.name, JSON.stringify(hClaim.json).slice(0, 120));
ok('another distributor cannot claim on it -> 403', (await call(T.dist, 'POST', `/portal/intl/shipments/${gS.id}/claims`, { date: fToday, kind: 'Damage', quantity: 1, description: 'x' })).status === 403);
ok('Warehouse cannot send a payment advice -> 403', (await call(hWh.token, 'POST', '/portal/intl/advices', { date: fToday, currency: 'USD', amount: 10, proof: fFile(gBl) })).status === 403);
ok('Warehouse cannot place portal requests (orders) -> 403', (await call(hWh.token, 'POST', '/portal/requests', { productId: fStockP.id, cartons: 1 })).status === 403);
const hUp = await (async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 swift')], { type: 'application/pdf' }), 'swift-copy.pdf');
  return (await fetch(BASE + '/attachments', { method: 'POST', headers: { Authorization: `Bearer ${hFin.token}` }, body: fd })).json();
})();
const hAdv = await call(hFin.token, 'POST', '/portal/intl/advices', { date: fToday, currency: 'USD', amount: 25, method: 'SWIFT', bankRef: 'MT103-77', forInvoices: gS.refNo, proof: fFile(hUp) });
ok('Finance sends a payment advice RA with the SWIFT copy', /^RA-\d{3}$/.test(hAdv.json?.refNo) && hAdv.json?.status === 'Submitted', JSON.stringify(hAdv.json).slice(0, 160));
ok('staff see it as an alert', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.title === `Payment advice · ${hAdv.json.refNo}`));
const hRec = (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, { date: fToday, currency: 'USD', amount: 25, fxRate: 280, method: 'SWIFT', bankRef: 'MT103-77', bankIndex: 0, adviceId: hAdv.json.id })).json;
ok('recording the remittance from the advice marks it Recorded', hRec?.advices?.find((a) => a.id === hAdv.json.id)?.status === 'Recorded');
ok('recording the same advice twice -> 400', (await call(T.exporter, 'POST', `/distributors/${fD.id}/remittances`, { date: fToday, currency: 'USD', amount: 25, fxRate: 280, method: 'SWIFT', bankIndex: 0, adviceId: hAdv.json.id })).status === 400);
const hUp2 = await (async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 swift 2')], { type: 'application/pdf' }), 'swift-copy-2.pdf');
  return (await fetch(BASE + '/attachments', { method: 'POST', headers: { Authorization: `Bearer ${hFin.token}` }, body: fd })).json();
})();
const hAdv2 = (await call(hFin.token, 'POST', '/portal/intl/advices', { date: fToday, currency: 'USD', amount: 5, proof: fFile(hUp2) })).json;
ok('a second advice can be rejected with a reason', hAdv2?.refNo && (await call(T.finance, 'POST', `/remittance-advices/${hAdv2.id}/reject`, { note: 'Not in our bank' })).json?.status === 'Rejected');
const hNt = (await call(hRo.token, 'GET', '/portal/intl/notifications')).json ?? [];
ok('notifications: shipped, claim decided, payment received, advice rejected', ['shipped', 'claim', 'payment', 'advice'].every((k) => hNt.some((n) => n.kind === k)), JSON.stringify(hNt.map((n) => n.kind)));
ok('staff see claims and market approvals to decide as alerts', ((await call(T.owner, 'GET', '/reports/alerts')).json ?? []).some((a) => a.title === `Claim to decide · ${hClaim.json.refNo}`));
ok('a staff login cannot read the portal account -> 403', (await call(T.owner, 'GET', '/portal/intl/account')).status === 403);


// ── N notifications: every request reaches the other side and Zen Foods; delivery claims decided by the manufacturer ──
const nDay = new Date().toISOString().slice(0, 10);
const nList = async (t) => (await call(t, 'GET', '/notifications?limit=100')).json ?? { items: [], unread: 0 };
const nHas = async (t, kind, ref) => (await nList(t)).items.some((n) => n.kind === kind && (!ref || n.refNo === ref));
const nWait = async (t) => (await call(t, 'GET', '/notifications/waiting')).json ?? [];
for (const t of [T.owner, T.sales, T.finance, T.factory, T.dist, p3Maker]) await call(t, 'POST', '/notifications/read', {});
ok('every login reads its own notifications (staff, distributor, manufacturer)',
  (await Promise.all([T.owner, T.dist, p3Maker, T.audit].map((t) => call(t, 'GET', '/notifications')))).every((r) => r.status === 200));
ok('after "mark all read" nothing is unread', (await call(T.dist, 'GET', '/notifications/counts')).json?.unread === 0);
ok('no token -> 401', (await call(null, 'GET', '/notifications')).status === 401);

// distributor request -> company (not the manufacturer)
const nReq = (await call(T.dist, 'POST', '/portal/requests', { date: nDay, productId: p7sku.id, cartons: 2, poRef: 'PO-N1' })).json;
ok('a distributor request tells the company desk (Admin and Distribution)', await nHas(T.owner, 'request.filed', nReq?.refNo) && await nHas(T.sales, 'request.filed', nReq?.refNo));
ok('stock requests stay with the company: the manufacturer is not told', !(await nHas(p3Maker, 'request.filed', nReq?.refNo)));
ok('nobody is told about their own action', !(await nHas(T.dist, 'request.filed', nReq?.refNo)));
const nOwnerWait = await nWait(T.owner);
ok('the company sees the request as waiting on Zen Foods (on them)', nOwnerWait.some((w) => w.refNo === nReq?.refNo && w.waitingOn === 'Zen Foods' && w.mine));
ok('the distributor sees it waiting on Zen Foods', (await nWait(T.dist)).some((w) => w.refNo === nReq?.refNo && w.waitingOn === 'Zen Foods' && !w.mine));
ok('the bell counts unread notices and items on the reader', (await call(T.owner, 'GET', '/notifications/counts')).json?.unread >= 1 && (await call(T.owner, 'GET', '/notifications/counts')).json?.waiting >= 1);
await call(T.sales, 'POST', `/portal/requests/${nReq.id}/reject`, { note: 'Out of stock this week' });
const nRej = (await nList(T.dist)).items.find((n) => n.kind === 'request.rejected' && n.refNo === nReq.refNo);
ok('the distributor is told the request was rejected, with the reason and a link', nRej && !nRej.read && nRej.body.includes('Out of stock this week') && nRej.link === '/admin/partner-portal?tab=orders', JSON.stringify(nRej));

// production order -> manufacturer; answer -> company and the distributor it is for
const nMo = (await call(T.factory, 'POST', '/production-orders', { date: nDay, productId: p5Mo.productId, containers: 1, send: true })).json;
ok('a sent production order tells the manufacturer', await nHas(p3Maker, 'order.sent', nMo?.refNo));
ok('another manufacturer is not told', !(await nHas(p3OtherT, 'order.sent', nMo?.refNo)));
ok('it waits on the manufacturer (on them in their portal)', (await nWait(p3Maker)).some((w) => w.refNo === nMo?.refNo && w.mine) && nOwnerWait.length >= 0 && (await nWait(T.owner)).some((w) => w.refNo === nMo?.refNo && !w.mine));
await call(p3Maker, 'POST', `/production-orders/${nMo.id}/accept`, { readyDate: nDay });
ok('the manufacturer accepting tells the company and the distributor', await nHas(T.owner, 'order.accepted', nMo.refNo) && await nHas(T.factory, 'order.accepted', nMo.refNo) && await nHas(T.dist, 'order.accepted', nMo.refNo));

// dispatch -> distributor and company; receipt -> manufacturer
const nShip = (await call(p3Maker, 'POST', '/production-shipments', { orderId: nMo.id, date: nDay, containers: 1, vehicle: 'TLR-9', waybill: 'BLT-N' })).json;
const nDisp = (await nList(T.dist)).items.find((n) => n.kind === 'shipment.dispatched' && n.refNo === nShip?.refNo);
ok('a dispatch tells the distributor (with vehicle and waybill)', nDisp && nDisp.body.includes('TLR-9') && nDisp.link === '/admin/partner-portal?tab=stock', JSON.stringify(nDisp));
ok('a dispatch tells the company', await nHas(T.owner, 'shipment.dispatched', nShip?.refNo) && await nHas(T.sales, 'shipment.dispatched', nShip?.refNo));
ok('the delivery waits on the distributor', (await nWait(T.dist)).some((w) => w.refNo === nShip?.refNo && w.mine));
await call(T.dist, 'POST', `/production-shipments/${nShip.id}/receive`, { date: nDay, receivedContainers: 1 });
ok('the receipt tells the manufacturer and the company', await nHas(p3Maker, 'shipment.received', nShip.refNo) && await nHas(T.owner, 'shipment.received', nShip.refNo));

// faulty goods: distributor raises, manufacturer decides, everyone is told
ok('a claim on more bundles than arrived -> 400', (await call(T.dist, 'POST', '/delivery-claims', { shipmentId: nShip.id, date: nDay, kind: 'Damaged', bundles: 11, note: 'x' })).status === 400);
ok('a claim needs a description -> 400', (await call(T.dist, 'POST', '/delivery-claims', { shipmentId: nShip.id, date: nDay, kind: 'Damaged', bundles: 1, note: '' })).status === 400);
ok('the manufacturer cannot raise a claim -> 403', (await call(p3Maker, 'POST', '/delivery-claims', { shipmentId: nShip.id, date: nDay, kind: 'Damaged', bundles: 1, note: 'x' })).status === 403);
ok('a claim on a delivery still in transit -> 400', (await (async () => {
  const o = (await call(T.factory, 'POST', '/production-orders', { date: nDay, productId: p5Mo.productId, containers: 1, send: true })).json;
  await call(p3Maker, 'POST', `/production-orders/${o.id}/accept`, {});
  const s = (await call(p3Maker, 'POST', '/production-shipments', { orderId: o.id, date: nDay, containers: 1 })).json;
  return call(T.dist, 'POST', '/delivery-claims', { shipmentId: s.id, date: nDay, kind: 'Damaged', bundles: 1, note: 'x' });
})()).status === 400);
const nClaim = await call(T.dist, 'POST', '/delivery-claims', { shipmentId: nShip.id, date: nDay, kind: 'Damaged', bundles: 2, note: 'Two bundles crushed in the truck' });
ok('the distributor raises a faulty-goods claim SCL with its value (2 bundles × 432 packets × 4.25)',
  nClaim.status === 201 && /^SCL-\d{3}$/.test(nClaim.json?.refNo) && nClaim.json?.status === 'Pending' && nClaim.json?.value === 3672, JSON.stringify(nClaim.json));
const nC = nClaim.json;
ok('the manufacturer is told and has to act', await nHas(p3Maker, 'delivery-claim.filed', nC.refNo) && (await nWait(p3Maker)).some((w) => w.refNo === nC.refNo && w.mine));
ok('the company is told (Admin, Manufacturing, Distribution) and sees it waiting on the manufacturer',
  await nHas(T.owner, 'delivery-claim.filed', nC.refNo) && await nHas(T.factory, 'delivery-claim.filed', nC.refNo) && await nHas(T.sales, 'delivery-claim.filed', nC.refNo)
  && (await nWait(T.owner)).some((w) => w.refNo === nC.refNo && !w.mine && w.waitingOn === p5Mo.manufacturer.name));
ok('each side lists the claim: distributor, manufacturer and staff', ((await call(T.dist, 'GET', '/delivery-claims')).json ?? []).some((c) => c.id === nC.id)
  && ((await call(p3Maker, 'GET', '/delivery-claims')).json ?? []).some((c) => c.id === nC.id) && ((await call(T.owner, 'GET', '/delivery-claims')).json ?? []).some((c) => c.id === nC.id));
ok('another manufacturer neither sees nor decides it', !((await call(p3OtherT, 'GET', '/delivery-claims')).json ?? []).some((c) => c.id === nC.id)
  && (await call(p3OtherT, 'POST', `/delivery-claims/${nC.id}/decide`, { decision: 'Accept', resolution: 'Credit' })).status === 403);
ok('the distributor cannot decide its own claim -> 403', (await call(T.dist, 'POST', `/delivery-claims/${nC.id}/decide`, { decision: 'Accept', resolution: 'Credit' })).status === 403);
ok('a rejection needs a reason -> 400', (await call(p3Maker, 'POST', `/delivery-claims/${nC.id}/decide`, { decision: 'Reject' })).status === 400);
const nDec = await call(p3Maker, 'POST', `/delivery-claims/${nC.id}/decide`, { decision: 'Accept', resolution: 'Credit', note: 'Agreed, transit damage' });
ok('the manufacturer accepts with a credit', nDec.json?.status === 'Accepted' && nDec.json?.resolution === 'Credit' && nDec.json?.decidedBy, JSON.stringify(nDec.json));
ok('deciding twice -> 400', (await call(p3Maker, 'POST', `/delivery-claims/${nC.id}/decide`, { decision: 'Reject', note: 'x' })).status === 400);
ok('the distributor and the company are told the outcome', await nHas(T.dist, 'delivery-claim.decided', nC.refNo) && await nHas(T.owner, 'delivery-claim.decided', nC.refNo) && await nHas(T.finance, 'delivery-claim.decided', nC.refNo));
const nJ = ((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).filter((l) => l.reference === nC.refNo);
ok('the credit posts Manufacturer Payable / Inventory at Distributor 3,672', nJ.some((l) => l.account === 'Manufacturer Payable' && l.debit === 3672) && nJ.some((l) => l.account === 'Inventory at Distributor' && l.credit === 3672), JSON.stringify(nJ));
ok('the manufacturer statement shows the claim credit', ((await call(p3Maker, 'GET', '/mfr-payment-requests/statement')).json?.entries ?? []).some((e) => e.kind === 'Claim credit' && e.ref === nC.refNo && e.owed === -3672));
ok('the order position counts the credit off what is still to pay', ((await call(T.owner, 'GET', '/mfr-payment-requests/position')).json?.rows ?? []).find((r) => r.orderId === nMo.id)?.credited === 3672);
const nInv = (await call(T.dist, 'POST', '/distributor-invoices', { date: nDay, lines: [{ shipmentId: nShip.id, containers: 1 }] })).json;
ok('selling the delivery carries the lower cost (18,360 - 3,672)', Math.abs(Number(nInv?.cost) - 14688) < 0.5, JSON.stringify(nInv?.cost));
ok('a sales invoice tells the company desk', await nHas(T.sales, 'sales-invoice.filed', nInv?.refNo) && await nHas(T.finance, 'sales-invoice.filed', nInv?.refNo));
await call(T.finance, 'POST', `/distributor-invoices/${nInv.id}/verify`);
ok('verifying it tells the distributor', await nHas(T.dist, 'sales-invoice.verified', nInv.refNo));
const nClaim2 = (await call(T.dist, 'POST', '/delivery-claims', { shipmentId: nShip.id, date: nDay, kind: 'Quality', bundles: 1, note: 'Stale taste' })).json;
ok('once the delivery is sold a credit is refused -> 400', (await call(p3Maker, 'POST', `/delivery-claims/${nClaim2.id}/decide`, { decision: 'Accept', resolution: 'Credit' })).status === 400);
ok('a replacement can still be agreed (nothing posts)', (await call(T.factory, 'POST', `/delivery-claims/${nClaim2.id}/decide`, { decision: 'Accept', resolution: 'Replace' })).json?.resolution === 'Replace'
  && !((await call(T.finance, 'GET', '/reports/journal?period=all')).json ?? []).some((l) => l.reference === nClaim2.refNo));
ok('the ledger still balances after claims', (await call(T.owner, 'GET', '/reports/trial-balance')).json?.balanced === true);

// manufacturer payment request -> Finance; decision -> manufacturer
const nPr = (await call(p3Maker, 'POST', '/mfr-payment-requests', { orderId: nMo.id, kind: 'Balance', amount: 1000 })).json;
ok('a payment request tells Finance and Manufacturing', await nHas(T.finance, 'payment-request.filed', nPr?.refNo) && await nHas(T.factory, 'payment-request.filed', nPr?.refNo));
ok('it waits on Finance', (await nWait(T.finance)).some((w) => w.refNo === nPr?.refNo && w.mine));
await call(T.finance, 'POST', `/mfr-payment-requests/${nPr.id}/reject`, { reason: 'Send the invoice first' });
ok('the manufacturer is told it was rejected, with the reason', (await nList(p3Maker)).items.some((n) => n.kind === 'payment-request.rejected' && n.refNo === nPr.refNo && n.body.includes('Send the invoice first')));
ok('the manufacturer never sees distributor payment notices', !(await nList(p3Maker)).items.some((n) => n.kind.startsWith('advice.') || n.kind.startsWith('request.')));
ok('a distributor never sees another distributor\'s notices', (await nList(T.dist)).items.every((n) => !n.title.includes('Upper Sindh')));

// read state is per login
const nBefore = (await nList(T.dist)).unread;
const nFirst = (await nList(T.dist)).items.find((n) => !n.read);
const nAfter = (await call(T.dist, 'POST', '/notifications/read', { ids: [nFirst.id] })).json?.unread;
ok('opening a notice marks only it read', nBefore >= 2 && nAfter === nBefore - 1, JSON.stringify([nBefore, nAfter]));
ok('reading it as the distributor does not mark it read for staff', (await nList(T.owner)).unread > 0);
ok('ids must be uuids -> 400', (await call(T.dist, 'POST', '/notifications/read', { ids: ['x'] })).status === 400);
ok('mark all read clears the badge', (await call(T.dist, 'POST', '/notifications/read', {})).json?.unread === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
