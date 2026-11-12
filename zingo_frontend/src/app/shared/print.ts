/**
 * Printable vouchers (production order, payment request, sales invoice, income invoice, bill).
 * The voucher is written into a hidden frame and the browser's print dialog opens on it, so nothing pops up
 * and the user can print it or save it as a PDF. Plain HTML with its own small style sheet, light colours only.
 */

/** one printed document */
export interface Voucher {
  /** "Sales invoice", "Production order" ... */
  title: string;
  /** the reference, e.g. DI-001 */
  ref: string;
  /** the issuing company (Settings company name) */
  company?: string;
  /** label / value pairs printed as a two-column table */
  facts: [string, string][];
  /** optional item table */
  table?: { head: string[]; rows: string[][]; foot?: string[] };
  /** a closing line in small type */
  note?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** the voucher as a complete HTML page */
export function voucherHtml(v: Voucher): string {
  const table = v.table
    ? `<table class="items"><thead><tr>${v.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${v.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
${v.table.foot ? `<tfoot><tr>${v.table.foot.map((c) => `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.title)} ${esc(v.ref)}</title>
<style>
  @page { margin: 16mm; }
  body { font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0c1727; max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #0c1727; padding-bottom: 8px; margin-bottom: 16px; }
  header strong { font-size: 15px; }
  h1 { font-size: 20px; margin: 0; }
  .facts { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  .facts td { padding: 5px 0; border-bottom: 1px solid #dde3ec; vertical-align: top; }
  .facts td:first-child { color: #556070; width: 38%; }
  .items { width: 100%; border-collapse: collapse; }
  .items th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #556070; border-bottom: 1px solid #0c1727; padding: 6px 4px; }
  .items td { padding: 6px 4px; border-bottom: 1px solid #dde3ec; font-variant-numeric: tabular-nums; }
  .items td:not(:first-child), .items th:not(:first-child) { text-align: right; }
  .items tfoot td { font-weight: 600; border-top: 1px solid #0c1727; border-bottom: 0; }
  .note { color: #556070; font-size: 11px; margin-top: 24px; }
</style></head><body>
<header><strong>${esc(v.company ?? 'Zen Foods')}</strong><h1>${esc(v.title)} · ${esc(v.ref)}</h1></header>
<table class="facts">${v.facts.map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('')}</table>
${table}
${v.note ? `<p class="note">${esc(v.note)}</p>` : ''}
</body></html>`;
}

/** opens the print dialog on the voucher (from a hidden frame that is removed afterwards) */
export function printVoucher(v: Voucher) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;inset-inline-end:0;inset-block-end:0;inline-size:0;block-size:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(voucherHtml(v));
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow!.addEventListener('afterprint', done, { once: true });
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    done();
  }, 50);
}
