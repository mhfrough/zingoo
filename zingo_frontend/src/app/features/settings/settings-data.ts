import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { downloadCsv } from '../../shared/csv';
import { errorText } from '../../shared/errors';
import { Btn, ToastService } from '../../ui';

/** one export: its title, where to read it and which columns to write (null = every column the server sends) */
interface Source {
  title: string;
  path: string;
  /** turns a row into flat CSV cells */
  row: (r: any) => Record<string, string | number | null | undefined>;
}

const SOURCES: Source[] = [
  { title: 'PRODUCTS', path: 'products', row: (r) => ({ sku: r.sku, name: r.name, pack: r.pack, flavour: r.flavour, packet_size: r.packetSize, packets_per_bundle: r.packsPerCarton, bundles_per_container: r.bundlesPerContainer, manufacturer: r.manufacturer?.name, distributor: r.distributor?.name, sellout_days: r.selloutDays, mrp: r.mrp, distributor_rate: r.rate, factory_rate: r.manufacturerRate, packaging: r.packagingRate, printing: r.printingRate, inbound: r.inboundRate, active: r.active }) },
  { title: 'MANUFACTURERS', path: 'manufacturers', row: (r) => ({ name: r.name, advance_pct: r.advancePct, payment_days: r.paymentDays, currency: r.currency, contact: r.contact, default_bank: (r.bankAccounts ?? []).filter((b: any) => b.isDefault).map((b: any) => `${b.bank} ${b.account}`).join('') }) },
  { title: 'DISTRIBUTORS', path: 'distributors', row: (r) => ({ name: r.name, region: r.region, contact: r.contact, payment_days: r.paymentDays, credit_limit: r.creditLimit, advance_pct: r.advancePct, sellout_days: r.selloutDays, province: r.province, areas: (r.areas ?? []).join('; ') }) },
  { title: 'PRODUCTION BATCHES', path: 'batches', row: (r) => ({ reference: r.refNo, date: r.date, status: r.status, sku: r.product?.sku, manufacturer: r.manufacturer?.name, target_cartons: r.targetCartons, produced_cartons: r.producedCartons, qc: r.qc, cost: r.cost }) },
  { title: 'SALES ORDERS', path: 'orders', row: (r) => ({ reference: r.refNo, date: r.date, status: r.status, distributor: r.distributor?.name, sku: r.product?.sku, cartons: r.cartons, rate: r.rate, billed: r.billed, collected: r.collected, outstanding: r.outstanding }) },
  { title: 'COLLECTIONS', path: 'collections', row: (r) => ({ reference: r.refNo, date: r.date, order: r.order?.refNo, amount: r.amount, method: r.method }) },
  { title: 'FINANCE ENTRIES', path: 'finance', row: (r) => ({ reference: r.refNo, date: r.date, type: r.type, stream: r.category, party: r.party, amount: r.amount, signatures: (r.signatures ?? []).join('+'), approved: r.approved }) },
  { title: 'INCOME AND EXPENSE DOCUMENTS', path: 'accounting-documents', row: (r) => ({ reference: r.refNo, date: r.date, kind: r.kind, category: r.category, party: r.party, currency: r.currency, amount_pkr: r.amount, paid: r.paid, due: r.due, status: r.status }) },
  { title: 'EXPORT CONTAINERS', path: 'exports', row: (r) => ({ reference: r.refNo, status: r.status, buyer: r.buyer, country: r.country, incoterm: r.incoterm, currency: r.currency, invoice_value: r.revenueForeign, invoice_pkr: r.revenuePKR, profit_pkr: r.net, collected: r.collected, due: r.due }) },
  { title: 'JOURNAL VOUCHERS', path: 'journal-vouchers', row: (r) => ({ reference: r.refNo, date: r.date, memo: r.memo, currency: r.currency, status: r.status, lines: r.lines.length }) },
  { title: 'GENERAL JOURNAL', path: 'reports/journal?period=all', row: (r) => ({ date: r.date, reference: r.reference, source: r.source, account: r.account, description: r.description, debit: r.debit, credit: r.credit }) },
];

/** Take the data out: one CSV file with every register and the general journal. */
@Component({
  selector: 'app-settings-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn],
  template: `
    <div class="card">
      <div class="card__head"><div><h2>Export all data</h2><p>One CSV file with every register and the general journal, as of now</p></div></div>
      <div class="card__body stack">
        <p class="muted">
          Products, manufacturers, distributors, batches, orders, collections, finance entries, income and expense documents,
          export containers, journal vouchers and the full journal. Open it in a spreadsheet; each block starts with its title.
        </p>
        <div class="cluster">
          <button appBtn variant="primary" icon="download" [loading]="busy()" (click)="exportAll()">Export all data (CSV)</button>
        </div>
      </div>
    </div>
  `,
})
export class SettingsData {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  protected busy = signal(false);

  protected exportAll() {
    this.busy.set(true);
    forkJoin(SOURCES.map((s) => {
      const [path, qs] = s.path.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs ?? '')) as Record<string, string>;
      return this.api.get<any[]>(path, query);
    })).subscribe({
      next: (lists) => {
        downloadCsv('zingoo-all-data.csv', SOURCES.map((s, i) => ({ title: s.title, rows: (lists[i] ?? []).map(s.row) })));
        this.busy.set(false);
        this.toast.success('Exported.');
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
