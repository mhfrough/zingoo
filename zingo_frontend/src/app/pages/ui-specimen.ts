/**
 * ui-specimen.ts - the /admin/ui page: every block of the design system in every state, in one place.
 * Owned by the design-system session. Review here after changing anything in src/styles or src/app/ui.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Tone, fmtDate } from '../shared/format';
import {
  Btn, ConfirmService, ConnectionStatus, DataTable, EmptyState, Field, IconComponent, IconName, Kpi, Modal,
  MoneyInput, NumberInput, Offcanvas, PageHeader, PageSkeleton, PasswordField, RichText, RowAction, RowActionEvent, SearchBox,
  Select, SelectOption, Skeleton, SkeletonForm, SkeletonKpi, SkeletonText, TEXT_LIMITS, TabItem, TabPanel, Tabs, Tag,
  TableColumn, TableFilter, ToastService,
} from '../ui';

interface Order {
  id: string; date: string; distributor: string; region: string; sku: string; product: string;
  cartons: number; value: number; due: number; status: string;
}
interface Batch {
  id: string; date: string; sku: string; product: string; target: number; actual: number;
  cost: number; qc: string; status: string; manufacturer: string;
}

// The client's own sample records, used here only to prove the layout.
const ORDERS: Order[] = [
  { id: 'SO-203', date: '2026-11-09', distributor: 'Upper Sindh Supply', region: 'Sukkur', sku: 'Z20-MAS', product: 'Masala Masti · Rs 20', cartons: 4, value: 21600, due: 0, status: 'Draft' },
  { id: 'SO-202', date: '2026-11-06', distributor: 'South Route Partners', region: 'Karachi', sku: 'Z10-KET', product: 'Ketchup Tango · Rs 10', cartons: 7, value: 18900, due: 18900, status: 'Dispatched' },
  { id: 'SO-201', date: '2026-11-05', distributor: 'Sindh Central Distributors', region: 'Hyderabad', sku: 'Z10-MAS', product: 'Masala Masti · Rs 10', cartons: 11, value: 29700, due: 11700, status: 'Dispatched' },
];

const BATCHES: Batch[] = [
  { id: 'B-1004', date: '2026-11-08', sku: 'Z20-KET', product: 'Ketchup Tango · Rs 20', target: 15, actual: 0, cost: 0, qc: 'Pending', status: 'Planned', manufacturer: 'Brand Choice Pakistan' },
  { id: 'B-1003', date: '2026-11-04', sku: 'Z20-MAS', product: 'Masala Masti · Rs 20', target: 18, actual: 17, cost: 75000, qc: 'Passed', status: 'Released', manufacturer: 'Brand Choice Pakistan' },
  { id: 'B-1002', date: '2026-11-03', sku: 'Z10-KET', product: 'Ketchup Tango · Rs 10', target: 27, actual: 26, cost: 62000, qc: 'Passed', status: 'Released', manufacturer: 'Brand Choice Pakistan' },
  { id: 'B-1001', date: '2026-11-01', sku: 'Z10-MAS', product: 'Masala Masti · Rs 10', target: 40, actual: 40, cost: 94000, qc: 'Passed', status: 'Released', manufacturer: 'Brand Choice Pakistan' },
];

const TONE: Record<string, Tone> = {
  Released: 'success', Dispatched: 'success', Passed: 'success', Paid: 'success',
  Planned: 'warning', Draft: 'warning', Pending: 'warning',
};
const tone = (s: string): Tone => TONE[s] ?? 'neutral';

/** 120 generated sales orders for the table v2 demo */
const BIG: Order[] = Array.from({ length: 120 }, (_, i) => {
  const cartons = 2 + ((i * 7) % 19);
  const [sku, product] = [['Z10-MAS', 'Masala Masti · Rs 10'], ['Z20-MAS', 'Masala Masti · Rs 20'], ['Z10-KET', 'Ketchup Tango · Rs 10'], ['Z20-KET', 'Ketchup Tango · Rs 20']][i % 4];
  const [distributor, region] = [['Sindh Central Distributors', 'Hyderabad'], ['South Route Partners', 'Karachi'], ['Upper Sindh Supply', 'Sukkur'], ['Karachi Bazaar Traders', 'Karachi'], ['Punjab Link Foods', 'Lahore']][(i * 3) % 5];
  const status = ['Draft', 'Dispatched', 'Dispatched', 'Paid'][i % 4];
  const value = cartons * 2700;
  return {
    id: `SO-${420 - i}`, date: new Date(Date.UTC(2026, 10, 9 - i)).toISOString().slice(0, 10), distributor, region, sku, product,
    cartons, value, due: status === 'Dispatched' ? Math.round(value / 2) : 0, status,
  };
});

type BtnVariantName = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'danger-solid';

@Component({
  selector: 'app-ui-specimen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MoneyInput, ReactiveFormsModule, Btn, ConnectionStatus, DataTable, Offcanvas, TabPanel, Tabs, EmptyState, Field, IconComponent, Kpi, Modal, NumberInput, PageHeader,
    PageSkeleton, PasswordField, RichText, SearchBox, Select, Skeleton, SkeletonForm, SkeletonKpi,
    SkeletonText, Tag,
  ],
  templateUrl: './ui-specimen.html',
})
export class UiSpecimen {
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  private fb = inject(FormBuilder);

  protected modalOpen = signal(false);
  protected ocMd = signal(false);
  protected ocLg = signal(false);
  protected tab = signal('');
  protected density = signal<'compact' | 'comfortable'>('compact');
  /** 517 Pakistan places for the searchable select demo (loaded from /data/pk-places.json) */
  protected cities = signal<SelectOption[]>([]);

  protected tabs: TabItem[] = [
    { id: 'orders', label: 'Sales orders', icon: 'receipt', count: 120 },
    { id: 'batches', label: 'Production batches', icon: 'factory', count: 4 },
    { id: 'payments', label: 'Payments', icon: 'wallet', count: 0 },
    { id: 'reports', label: 'Reports', icon: 'sheet' },
  ];

  protected bigOrders = BIG;
  protected bigFilters: TableFilter[] = [
    { id: 'status', type: 'select' },
    { id: 'date', type: 'date-range', label: 'Order date' },
    { id: 'value', type: 'number-range', label: 'Invoice (PKR)' },
    { id: 'distributor', type: 'text' },
  ];
  protected bigColumns: TableColumn<Order>[] = [
    { id: 'id', label: 'Order', value: (o) => o.id, sub: (o) => o.region },
    { id: 'date', label: 'Date', kind: 'date', value: (o) => o.date, priority: 2 },
    { id: 'distributor', label: 'Distributor', value: (o) => o.distributor },
    { id: 'product', label: 'Product', value: (o) => o.product, sub: (o) => o.sku, priority: 3 },
    { id: 'cartons', label: 'Bundles', kind: 'number', value: (o) => o.cartons, priority: 3 },
    { id: 'value', label: 'Invoice (PKR)', kind: 'money', value: (o) => o.value },
    { id: 'status', label: 'Status', kind: 'tag', value: (o) => o.status, tone: (o) => tone(o.status), priority: 2 },
  ];

  // live demos
  protected saving = signal(false);
  protected saved = signal(false);
  protected tableLoading = signal(false);
  protected switchOn = signal(true);
  protected query = signal('');
  protected motionOn = signal(false);
  protected showSkeletonPage = signal(false);

  protected variants: BtnVariantName[] = ['primary', 'secondary', 'ghost', 'success', 'danger', 'danger-solid'];

  protected limits = TEXT_LIMITS;

  protected methods: SelectOption[] = [
    { value: 'bank', label: 'Bank transfer', hint: 'Settles in 1-2 days' },
    { value: 'cash', label: 'Cash', hint: 'Counted at the warehouse' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'other', label: 'Other (not available)', disabled: true },
  ];

  protected distributors: SelectOption[] = [
    { value: 'sc', label: 'Sindh Central Distributors', group: 'Hyderabad' },
    { value: 'sr', label: 'South Route Partners', group: 'Karachi' },
    { value: 'kb', label: 'Karachi Bazaar Traders', group: 'Karachi' },
    { value: 'us', label: 'Upper Sindh Supply', group: 'Sukkur' },
  ];

  protected demo = this.fb.nonNullable.group({
    email: ['owner@example.test', [Validators.required, Validators.email]],
    method: ['bank' as string | null],
    distributor: [null as string | null],
    cartons: [12 as number | null],
    amount: [11700 as number | null],
    reference: [''],
    password: ['correct horse battery'],
    notes: ['<p>Deliver <strong>before Friday</strong>. Call the warehouse first.</p><ul><li>Two pallets</li><li>Keep dry</li></ul>'],
    description: [''],
    nearLimit: ['<p>This note is close to its limit, so the counter is orange. Keep typing and it turns red near the end.</p>'],
    plainNote: ['Plain textarea with maxlength 120: this text is already at about ninety percent of the limit, so it is orange.'],
    agree: [true],
    hold: [false],
    city: [null as string | null],
  });

  /** the form inside the off-canvas demos: typing makes it dirty, so closing asks "Discard changes?" */
  protected ocForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    city: [null as string | null],
    cartons: [1 as number | null],
    notes: [''],
  });

  protected tones: Tone[] = ['neutral', 'success', 'warning', 'danger', 'info', 'accent'];
  protected icons: IconName[] = ['dashboard', 'factory', 'truck', 'landmark', 'receipt', 'scale', 'container', 'book', 'handshake', 'users', 'settings', 'wallet', 'piggy-bank', 'package', 'boxes', 'coins'];
  protected durations = [
    ['--dur-fast', '120ms · hover, press, exit'],
    ['--dur-base', '200ms · enter, focus, menus'],
    ['--dur-slow', '320ms · dialogs, drawer'],
    ['--dur-count', '600ms · KPI count-up'],
    ['--stagger', '40ms · rows, lists'],
  ];

  protected swatches = [
    ['surface-page', 'Page'], ['surface-card', 'Card'], ['surface-field', 'Field fill'], ['control-line', 'Control line'],
    ['text', 'Text'], ['text-2', 'Text 2'], ['text-3', 'Text 3'], ['accent', 'Accent'],
    ['accent-soft', 'Accent soft'], ['nav-bg', 'Navy'], ['tone-success-fg', 'Success'], ['tone-warning-fg', 'Warning'],
    ['tone-danger-fg', 'Danger'], ['tone-info-fg', 'Info'],
  ];

  protected sizes = [
    ['--text-3xl', 'Page title'], ['--text-2xl', 'Section'], ['--text-xl', 'Card title'],
    ['--text-lg', 'Lead'], ['--text-md', 'Body, tables'], ['--text-sm', 'Labels, buttons'], ['--text-xs', 'Captions, tags'],
  ];

  protected listItems = Array.from({ length: 24 }, (_, i) => ({
    id: `SO-${300 - i}`,
    who: ['Sindh Central', 'South Route', 'Upper Sindh', 'Karachi Bazaar'][i % 4],
    amount: 9000 + ((i * 3700) % 21000),
  }));

  protected orders = ORDERS;
  protected batches = BATCHES;

  protected orderColumns: TableColumn<Order>[] = [
    { id: 'id', label: 'Order', value: (o) => o.id, sub: (o) => fmtDate(o.date) },
    { id: 'distributor', label: 'Distributor', value: (o) => o.distributor, sub: (o) => o.region },
    { id: 'product', label: 'Product', value: (o) => o.product, sub: (o) => o.sku, priority: 2 },
    { id: 'cartons', label: 'Bundles', kind: 'number', value: (o) => o.cartons, priority: 3 },
    { id: 'value', label: 'Invoice (PKR)', kind: 'money', value: (o) => o.value, sub: (o) => (o.status === 'Dispatched' ? `Due ${o.due.toLocaleString('en-PK')}` : null) },
    { id: 'status', label: 'Status', kind: 'tag', value: (o) => o.status, tone: (o) => tone(o.status), priority: 2 },
  ];

  protected orderTotals = { id: 'Total', value: '70,200', cartons: '22' };

  protected orderActions = (o: Order): RowAction[] =>
    o.status === 'Draft'
      ? [{ id: 'dispatch', label: 'Dispatch', tone: 'success', icon: 'truck' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' }]
      : o.due > 0 ? [{ id: 'collect', label: 'Collect payment', tone: 'success' }] : [];

  protected batchColumns: TableColumn<Batch>[] = [
    { id: 'id', label: 'Batch', value: (b) => b.id, sub: (b) => fmtDate(b.date) },
    { id: 'product', label: 'Product', value: (b) => b.product, sub: (b) => b.sku },
    { id: 'actual', label: 'Cartons made', kind: 'number', value: (b) => b.actual, sub: (b) => `Target ${b.target}` },
    { id: 'qc', label: 'QC', kind: 'tag', value: (b) => b.qc, tone: (b) => tone(b.qc), priority: 3 },
    { id: 'status', label: 'Status', kind: 'tag', value: (b) => b.status, tone: (b) => tone(b.status), priority: 2 },
    { id: 'cost', label: 'Est. cost (PKR)', kind: 'money', value: (b) => b.cost, sub: (b) => b.manufacturer, priority: 2 },
  ];

  protected batchActions = (b: Batch): RowAction[] =>
    b.status === 'Planned'
      ? [{ id: 'release', label: 'Release batch', tone: 'success' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', tone: 'danger' }]
      : [];

  constructor() {
    fetch('data/pk-places.json')
      .then((r) => r.json())
      .then((j: { cities: { name: string; province: string }[] }) =>
        this.cities.set(j.cities.map((c) => ({ value: c.name, label: c.name, sub: c.province }))),
      )
      .catch(() => this.cities.set([]));
  }

  /** switch the whole app between the compact and comfortable density */
  protected setDensity(d: 'compact' | 'comfortable') {
    this.density.set(d);
    document.documentElement.setAttribute('data-density', d);
  }

  /** pretend to save: clear the form (no longer dirty) and close both panels */
  protected saveOc() {
    this.ocForm.reset();
    this.ocMd.set(false);
    this.ocLg.set(false);
    this.toast.success('Distributor saved (demo).');
  }

  /** show the standard discard dialog */
  protected async askDiscard() {
    const discard = await this.confirm.discard();
    this.toast.show(discard ? 'Discarded.' : 'Keep editing.');
  }

  protected onToast(kind: 'success' | 'danger' | 'neutral' | 'warning') {
    if (kind === 'success') this.toast.success('Batch B-1004 released to the warehouse.');
    else if (kind === 'danger') this.toast.error('Amount is more than the open balance of PKR 11,700.');
    else if (kind === 'warning') this.toast.warning('Two approvals are still waiting for a second signature.');
    else this.toast.show('Draft saved. Nothing was posted to the ledger.');
  }

  /** the pattern every delete follows: ask first, then act */
  protected async onAction(e: RowActionEvent<Order | Batch>) {
    if (e.id === 'delete') {
      const ok = await this.confirm.ask({
        title: `Delete ${e.row.id}?`,
        message: 'The record and its lines are removed. This cannot be undone.',
        confirmLabel: e.row.id.startsWith('B-') ? 'Delete batch' : 'Delete order',
        tone: 'danger',
      });
      this.toast.show(ok ? `${e.row.id} deleted (demo: nothing was removed).` : 'Delete cancelled.');
      return;
    }
    this.toast.show(`${e.id} on ${e.row.id}`);
  }

  protected async askDelete() {
    const ok = await this.confirm.ask({
      title: 'Delete batch B-1004?',
      message: 'The planned batch and its QC checklist are removed. This cannot be undone.',
      confirmLabel: 'Delete batch',
      tone: 'danger',
    });
    this.toast.show(ok ? 'Confirmed: batch deleted (demo).' : 'Cancelled: nothing changed.');
  }

  protected async askRelease() {
    const ok = await this.confirm.ask({
      title: 'Release batch B-1004?',
      message: 'Stock moves to the warehouse and the manufacturer payable is booked.',
      confirmLabel: 'Release batch',
    });
    this.toast.show(ok ? 'Confirmed: batch released (demo).' : 'Cancelled: nothing changed.');
  }

  /** loading, then the green flash */
  protected save() {
    if (this.saving()) return;
    this.saving.set(true);
    setTimeout(() => {
      this.saving.set(false);
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 1600);
    }, 1400);
  }

  protected reloadTable() {
    this.tableLoading.set(true);
    setTimeout(() => this.tableLoading.set(false), 1800);
  }

  protected setSwitch(event: Event) {
    this.switchOn.set((event.target as HTMLInputElement).checked);
  }
}
