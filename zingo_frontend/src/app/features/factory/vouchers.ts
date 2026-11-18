import { Voucher } from '../../shared/print';
import { fmtAmount, fmtAmount2, fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { DistInvoice, OrderLoad, PaymentRequest, ProductionOrder } from './factory.api';
import { richToPlain } from '../../ui/rich-text';

/** The printed vouchers of the new chain: production order, manufacturer payment request, distributor sales invoice. */

/** "H3 Goods · vehicle KHI-1234 · driver Ali (0300-...) · CNIC ..." */
function transportLine(t: NonNullable<ProductionOrder['transport']>): string {
  return [t.transporter, t.vehicleNo && `vehicle ${t.vehicleNo}`, t.driverName && `driver ${t.driverName}${t.driverPhone ? ` (${t.driverPhone})` : ''}`,
    !t.driverName && t.driverPhone && `driver phone ${t.driverPhone}`, t.driverCnic && `CNIC ${t.driverCnic}`].filter(Boolean).join(' · ');
}

/** a production order as sent to the manufacturer */
export function orderVoucher(o: ProductionOrder, company?: string): Voucher {
  return {
    title: 'Production order', ref: o.refNo, company,
    facts: [
      ['Order date', fmtDate(o.date)], ['Manufacturer', o.manufacturer.name], ['Status', o.status + (o.stage ? ` · ${o.stage}` : '')],
      ['Deliver to', o.destination === 'Warehouse' ? 'Zen Foods warehouse' : o.distributor?.name ?? ''],
      ['Deliver by', o.dueDate ? fmtDate(o.dueDate) : '-'], ['Advance on order', `${o.advancePct}% · ${fmtMoney(o.advanceAmount)}`],
      ...(o.groupRef ? [['Distributor order', o.groupRef] as [string, string]] : []),
      ...(o.transport ? [['Planned transport', transportLine(o.transport)] as [string, string]] : []),
      ...(o.notes ? [['Notes', richToPlain(o.notes)] as [string, string]] : []),
    ],
    table: {
      head: ['Product', (o.containerUnit ?? o.product.containerUnit) ? `Containers (${o.containerUnit ?? o.product.containerUnit})` : 'Containers', 'Bundles', 'Packets', 'Rate / packet', 'Value (PKR)'],
      rows: [[`${o.product.sku} · ${o.product.name}`, fmtNumber(o.containers), fmtNumber(o.bundles), fmtNumber(o.packets), fmtAmount2(o.rate), fmtAmount(o.value)]],
      foot: ['Total', '', '', '', '', fmtAmount(o.value)],
    },
    note: `${o.packaging ? `Packaging "${o.packaging}": ` : ''}${o.bundlesPerContainer} bundles per container, ${o.packetsPerBundle} packets per bundle. Prices in PKR.`,
  };
}

/**
 * The dispatch voucher (delivery challan / gate pass) that travels with the goods: what leaves the factory, for whom,
 * on which vehicle, with boxes for the factory, the driver and the receiver to sign. No prices, so the manufacturer,
 * the driver and the distributor can all hold a copy. For one load when `load` is given, else the whole order.
 */
export function dispatchVoucher(o: ProductionOrder, load?: OrderLoad | null, company?: string): Voucher {
  const unit = o.containerUnit ?? o.product.containerUnit ?? null;
  const containers = load ? load.containers : o.containers;
  const bundles = containers * (load?.bundlesPerContainer ?? o.bundlesPerContainer);
  const packets = bundles * (load?.packetsPerBundle ?? o.packetsPerBundle);
  const t = o.transport ?? {};
  const vehicle = load?.vehicle || t.vehicleNo || '';
  return {
    title: 'Dispatch voucher', ref: load ? load.refNo : `DC-${o.refNo}`, company,
    facts: [
      ['Date', fmtDate(load?.shipDate ?? new Date().toISOString().slice(0, 10))],
      ['Production order', `${o.refNo}${o.groupRef ? ` · distributor order ${o.groupRef}` : ''}`],
      ['From (manufacturer)', o.manufacturer.name],
      ['Deliver to', o.destination === 'Warehouse' ? 'Zen Foods warehouse' : [o.distributor?.name, (o.distributor as { address?: string | null } | null)?.address].filter(Boolean).join(', ')],
      ...(load ? [['Method', load.method === 'Pickup' ? 'Collected by the distributor' : 'Delivered by the manufacturer'] as [string, string]] : []),
      ['Transporter', t.transporter || '-'],
      ['Vehicle no.', vehicle || '-'],
      ['Driver', [t.driverName, t.driverPhone, t.driverCnic && `CNIC ${t.driverCnic}`].filter(Boolean).join(' · ') || '-'],
      ...(load?.waybill ? [['Waybill', load.waybill] as [string, string]] : []),
    ],
    table: {
      head: ['Product', unit ? `Containers (${unit})` : 'Containers', 'Bundles', 'Packets', 'Packing'],
      rows: [[`${o.product.sku} · ${o.product.name}`, fmtNumber(containers), fmtNumber(bundles), fmtNumber(packets),
        `${load?.packetsPerBundle ?? o.packetsPerBundle} / bundle · ${load?.bundlesPerContainer ?? o.bundlesPerContainer} / container`]],
    },
    note: 'Count the goods and check for damage before signing. Write any shortage or damage on this voucher; a signed copy is uploaded to the order.',
    signatures: ['Dispatched by (factory)', 'Driver / transporter', 'Received by'],
  };
}

/**
 * The dispatch voucher of a whole order (several products on one vehicle), from what the factory types on the Ready
 * to Dispatch form: ready containers per product, the vehicle, the driver; boxes to sign. No prices.
 */
export function dispatchVoucherFor(orders: ProductionOrder[], d: {
  ref: string; date: string; ready: Record<string, number>; damaged?: Record<string, number | null>;
  vehicleNo?: string; driverName?: string; driverPhone?: string; transporter?: string; biltyNo?: string;
}, company?: string): Voucher {
  const lead = orders[0];
  const rows = orders.map((o) => {
    const c = d.ready[o.id] ?? o.containers;
    const unit = o.containerUnit ?? o.product.containerUnit ?? null;
    return [`${o.product.sku} · ${o.product.name}`, fmtNumber(o.containers), `${fmtNumber(c)}${unit ? ` ${unit}` : ''}`, fmtNumber(c * o.bundlesPerContainer),
      fmtNumber(c * o.bundlesPerContainer * o.packetsPerBundle), d.damaged?.[o.id] ? fmtNumber(d.damaged[o.id]!) : '-'];
  });
  const total = (i: number) => fmtNumber(orders.reduce((n, o) => n + (i === 1 ? o.containers : (d.ready[o.id] ?? o.containers) * (i === 3 ? o.bundlesPerContainer : i === 4 ? o.bundlesPerContainer * o.packetsPerBundle : 1)), 0));
  return {
    title: 'Dispatch voucher', ref: `DC-${d.ref}`, company,
    facts: [
      ['Date', fmtDate(d.date)],
      ['Order', `${d.ref}${orders.length > 1 ? ` (${orders.map((o) => o.refNo).join(', ')})` : ''}`],
      ['From (manufacturer)', lead?.manufacturer.name ?? ''],
      ['Deliver to', lead?.destination === 'Warehouse' ? 'Zen Foods warehouse'
        : [lead?.distributor?.name, (lead?.distributor as { address?: string | null } | null)?.address].filter(Boolean).join(', ')],
      ['Vehicle registration no.', d.vehicleNo || '-'],
      ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(' · ') || '-'],
      ['Transporter', [d.transporter, d.biltyNo && `bilty ${d.biltyNo}`].filter(Boolean).join(' · ') || '-'],
    ],
    table: {
      head: ['Product', 'Ordered', 'Loaded (containers)', 'Bundles', 'Packets', 'Damaged in production'],
      rows,
      foot: ['Total', total(1), total(2), total(3), total(4), ''],
    },
    note: 'The driver counts the containers when loading and signs below. Photograph or scan this signed voucher and attach it as the proof of handover.',
    signatures: ['Loaded by (factory)', 'Driver', 'Received by (distributor)'],
  };
}

/** a manufacturer's payment invoice (advance or balance) */
export function requestVoucher(r: PaymentRequest, company?: string): Voucher {
  return {
    title: `${r.kind} payment request`, ref: r.refNo, company,
    facts: [
      ['Date', fmtDate(r.date)], ...(r.dueDate ? [['Due', fmtDate(r.dueDate)] as [string, string]] : []),
      ['From', r.manufacturer.name], ['Their invoice no.', r.invoiceNo ?? '-'],
      ['Against order', `${r.order.refNo} · ${r.order.product.sku}`], ['Amount', fmtMoney(r.amount)],
      ...((r.banks?.length ? r.banks : [r.bank]).map((b, i): [string, string] =>
        [i === 0 ? 'Pay into' : 'Or into', `${b.bank} · ${b.account} · ${b.title}${b.branch ? ` · ${b.branch}` : ''}`])),
      ['Status', r.state], ['Approved by seats', r.signatures.length ? r.signatures.join(' + ') : '-'],
      ...(r.reason ? [['Reason', richToPlain(r.reason)] as [string, string]] : []),
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
      ...(i.reason ? [['Reason', richToPlain(i.reason)] as [string, string]] : []),
    ],
    table: {
      head: ['Product', 'Containers', 'Packets', 'Price / packet', 'Amount (PKR)'],
      rows: i.lines.map((l) => [`${l.product.sku} · ${l.product.name}`, fmtNumber(l.containers), fmtNumber(l.packets), fmtAmount2(l.rate), fmtAmount(l.amount)]),
      foot: ['Total', fmtNumber(i.containers), fmtNumber(i.packets), '', fmtAmount(i.amount)],
    },
    note: 'Goods held on consignment and sold by the distributor. Prices in PKR.',
  };
}
