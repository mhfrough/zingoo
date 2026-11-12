import { Voucher } from '../../shared/print';
import { fmtAmount, fmtAmount2, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { DistInvoice, PaymentRequest, ProductionOrder } from './factory.api';

/** The printed vouchers of the new chain: production order, manufacturer payment request, distributor sales invoice. */

/** a production order as sent to the manufacturer */
export function orderVoucher(o: ProductionOrder, company?: string): Voucher {
  return {
    title: 'Production order', ref: o.refNo, company,
    facts: [
      ['Order date', fmtDate(o.date)], ['Manufacturer', o.manufacturer.name], ['Status', o.status + (o.stage ? ` · ${o.stage}` : '')],
      ['Deliver to', o.destination === 'Warehouse' ? 'Zen Foods warehouse' : o.distributor?.name ?? ''],
      ['Deliver by', o.dueDate ? fmtDate(o.dueDate) : '-'], ['Advance on order', `${o.advancePct}% · ${fmtMoney(o.advanceAmount)}`],
      ...(o.notes ? [['Notes', o.notes] as [string, string]] : []),
    ],
    table: {
      head: ['Product', 'Containers', 'Bundles', 'Packets', 'Rate / packet', 'Value (PKR)'],
      rows: [[`${o.product.sku} · ${o.product.name}`, fmtNumber(o.containers), fmtNumber(o.bundles), fmtNumber(o.packets), fmtAmount2(o.rate), fmtAmount(o.value)]],
      foot: ['Total', '', '', '', '', fmtAmount(o.value)],
    },
    note: `${o.bundlesPerContainer} bundles per container, ${o.packetsPerBundle} packets per bundle. Prices in PKR.`,
  };
}

/** a manufacturer's payment invoice (advance or balance) */
export function requestVoucher(r: PaymentRequest, company?: string): Voucher {
  return {
    title: `${r.kind} payment request`, ref: r.refNo, company,
    facts: [
      ['Date', fmtDate(r.date)], ['From', r.manufacturer.name], ['Their invoice no.', r.invoiceNo ?? '-'],
      ['Against order', `${r.order.refNo} · ${r.order.product.sku}`], ['Amount', fmtMoney(r.amount)],
      ['Pay into', `${r.bank.bank} · ${r.bank.account}`], ['Account title', r.bank.title + (r.bank.branch ? ` · ${r.bank.branch}` : '')],
      ['Status', r.state], ['Approved by seats', r.signatures.length ? r.signatures.join(' + ') : '-'],
      ...(r.reason ? [['Reason', r.reason] as [string, string]] : []),
    ],
    table: r.payments.length ? {
      head: ['Payment', 'Date', 'Method', 'Amount (PKR)'],
      rows: r.payments.map((p) => [p.refNo, fmtDate(p.date), p.method, fmtAmount(p.amount)]),
      foot: ['Paid', '', '', fmtAmount(r.paid)],
    } : undefined,
    note: r.approved && r.due > 0 ? `Still due: ${fmtMoney(r.due)}.` : undefined,
  };
}

/** a distributor's sales invoice for containers distributed */
export function salesInvoiceVoucher(i: DistInvoice, company?: string): Voucher {
  return {
    title: 'Sales invoice', ref: i.refNo, company,
    facts: [
      ['Date', fmtDate(i.date)], ['Distributor', i.distributor.name], ['Their invoice no.', i.invoiceNo ?? '-'],
      ['Due', fmtDate(i.dueDate)], ['Status', i.state], ['Paid', fmtMoney(i.paid)], ['Still due', fmtMoney(i.due)],
      ...(i.reason ? [['Reason', i.reason] as [string, string]] : []),
    ],
    table: {
      head: ['Product', 'Containers', 'Packets', 'Price / packet', 'Amount (PKR)'],
      rows: i.lines.map((l) => [`${l.product.sku} · ${l.product.name}`, fmtNumber(l.containers), fmtNumber(l.packets), fmtAmount2(l.rate), fmtAmount(l.amount)]),
      foot: ['Total', fmtNumber(i.containers), fmtNumber(i.packets), '', fmtAmount(i.amount)],
    },
    note: 'Goods held on consignment and sold by the distributor. Prices in PKR.',
  };
}
