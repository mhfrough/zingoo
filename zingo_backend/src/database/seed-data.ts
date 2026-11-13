/**
 * The client's own sample data, copied from the prototype (Zingoo_v4_Distributor_Portal.html).
 * Rows point at each other by key (m1, p1, d1, SO-201 ...); seed.ts turns keys into ids.
 * All names, people and amounts are the client's illustrative sample values, not real figures.
 */

export const manufacturers = [
  {
    key: 'm1', name: 'Brand Choice Pakistan', paymentTerms: ['Advance', 'Credit line'] as ('Advance' | 'Credit line')[], creditLimit: 5000000, paymentDays: 30, advancePct: 30, currency: 'PKR', contact: 'Production partner',
    // sample account details, not real ones
    bankAccounts: [
      { bank: 'Meezan Bank', title: 'Brand Choice Pakistan', account: 'PK00SAMPLE0000000001', branch: 'Sample branch', isDefault: true },
      { bank: 'HBL', title: 'Brand Choice Pakistan', account: 'PK00SAMPLE0000000002', isDefault: false },
    ],
  },
];

const productDefaults = { packsPerCarton: 432, bundlesPerContainer: 10, manufacturer: 'm1', packagingRate: 0.35, printingRate: 0.15, inboundRate: 0.1, currency: 'PKR', active: true };

export const products = [
  { key: 'p1', gramsPerPacket: 18, outboundRate: 0.1, packagings: [{ name: 'Standard', packetsPerBundle: 432, bundlesPerContainer: 10, isDefault: true }, { name: 'Half container', packetsPerBundle: 432, bundlesPerContainer: 5, isDefault: false }], flavour: 'Masala Masti', packetSize: 'Rs 10 pack', distributor: 'd1', sku: 'Z10-MAS', name: 'Masala Masti', pack: 10, mrp: 10, rate: 6.25, manufacturerRate: 4.25, ...productDefaults },
  { key: 'p2', flavour: 'Ketchup Tango', packetSize: 'Rs 10 pack', distributor: 'd2', sku: 'Z10-KET', name: 'Ketchup Tango', pack: 10, mrp: 10, rate: 6.25, manufacturerRate: 4.25, ...productDefaults },
  { key: 'p3', flavour: 'Masala Masti', packetSize: 'Rs 20 pack', distributor: 'd3', sku: 'Z20-MAS', name: 'Masala Masti', pack: 20, mrp: 20, rate: 12.5, manufacturerRate: 8.7, ...productDefaults },
  { key: 'p4', flavour: 'Ketchup Tango', packetSize: 'Rs 20 pack', distributor: 'd1', sku: 'Z20-KET', name: 'Ketchup Tango', pack: 20, mrp: 20, rate: 12.5, manufacturerRate: 8.7, ...productDefaults },
];

export const distributors = [
  { key: 'd1', name: 'Sindh Central Distributors', region: 'Hyderabad', market: 'Local' as const, provinces: ['Sindh'], districts: [{ name: 'Hyderabad', province: 'Sindh' }, { name: 'Tando Allahyar', province: 'Sindh' }, { name: 'Matiari', province: 'Sindh' }], cities: [{ name: 'Hyderabad', province: 'Sindh', district: 'Hyderabad' }, { name: 'Tando Allahyar', province: 'Sindh', district: 'Tando Allahyar' }, { name: 'Matiari', province: 'Sindh', district: 'Matiari' }], contact: 'Demo contact', address: 'Hyderabad, Sindh, Pakistan', taxNo: '', paymentDays: 30, creditLimit: 300000, advancePct: 10, selloutDays: 30 },
  { key: 'd2', name: 'South Route Partners', region: 'Karachi', market: 'Local' as const, provinces: ['Sindh'], districts: [{ name: 'Karachi', province: 'Sindh' }], cities: [{ name: 'Karachi', province: 'Sindh', district: 'Karachi' }], exclusive: true, contact: 'Demo contact', address: 'Karachi, Sindh, Pakistan', taxNo: '', paymentDays: 45, creditLimit: 250000, advancePct: 15, selloutDays: 40 },
  { key: 'd3', name: 'Upper Sindh Supply', region: 'Sukkur', market: 'Local' as const, provinces: ['Sindh'], districts: [{ name: 'Sukkur', province: 'Sindh' }, { name: 'Shikarpur', province: 'Sindh' }], cities: [{ name: 'Sukkur', province: 'Sindh', district: 'Sukkur' }, { name: 'Rohri', province: 'Sindh', district: 'Sukkur' }, { name: 'Shikarpur', province: 'Sindh', district: 'Shikarpur' }], contact: 'Demo contact', address: 'Sukkur, Sindh, Pakistan', taxNo: '', paymentDays: 60, creditLimit: 200000, advancePct: 10, selloutDays: 30 },
];

/**
 * Scope v2 phase D: one international distributor, registration still a draft (no documents uploaded yet).
 * Illustrative only: the name, registration number and contact are made up.
 */
export const intlDistributors = [
  {
    name: 'Zayed Gulf Trading', market: 'International' as const, countries: ['United Arab Emirates', 'Oman'],
    legalName: 'Zayed Gulf Trading LLC', classification: 'Importer', country: 'United Arab Emirates',
    registrationNo: 'SAMPLE-DXB-0001', registrationAuthority: 'Sample authority', accountManager: 'Export Executive',
    contacts: [{ name: 'Sample buyer', role: 'Purchasing', email: 'buyer@example.test', phoneCode: '+971', isPrimary: true }],
    addresses: [{ type: 'Registered' as const, line: 'Sample address', city: 'Dubai', country: 'United Arab Emirates', isDefault: true }],
    agreementStart: '2026-12-01', paymentDays: 60, creditLimit: 0, advancePct: 30, selloutDays: 0,
  },
];

/** users: the client's 7 roles plus one demo distributor login */
export const users = [
  { name: 'Admin', email: 'admin@zingo.pk', role: 'Admin', seat: 'Both' },
  { name: 'Zen Foods Owner', email: 'owner@example.test', role: 'Admin', seat: 'Both' },
  { name: 'Production Supervisor', email: 'factory@example.test', role: 'Manufacturing', seat: 'None' },
  { name: 'Finance Controller', email: 'finance@example.test', role: 'Finance', seat: 'A' },
  { name: 'Partner Approver', email: 'partner@example.test', role: 'Finance', seat: 'B' },
  { name: 'Distribution Coordinator', email: 'sales@example.test', role: 'Distribution', seat: 'None' },
  { name: 'Export Executive', email: 'export@example.test', role: 'Exports', seat: 'None' },
  { name: 'Read-only Reviewer', email: 'audit@example.test', role: 'Viewer', seat: 'None' },
  { name: 'Investor (Demo)', email: 'investor@example.test', role: 'Investor', seat: 'None' },
  { name: 'Hyderabad Distributor (Demo)', email: 'distributor@demo.local', role: 'Distributor', seat: 'None', distributor: 'd1' },
  { name: 'Brand Choice (Demo)', email: 'manufacturer@demo.local', role: 'Manufacturer', seat: 'None', manufacturer: 'm1' },
] as const;

export const batches = [
  { refNo: 'B-1001', date: '2026-11-01', product: 'p1', manufacturer: 'm1', targetCartons: 42, producedCartons: 40, cost: 94000, qc: 'Passed', release: true, notes: 'Illustrative production run' },
  { refNo: 'B-1002', date: '2026-11-03', product: 'p2', manufacturer: 'm1', targetCartons: 27, producedCartons: 26, cost: 62000, qc: 'Passed', release: true, notes: '' },
  { refNo: 'B-1003', date: '2026-11-04', product: 'p3', manufacturer: 'm1', targetCartons: 18, producedCartons: 17, cost: 75000, qc: 'Passed', release: true, notes: '' },
  { refNo: 'B-1004', date: '2026-11-08', product: 'p4', manufacturer: 'm1', targetCartons: 15, producedCartons: 0, cost: 0, qc: 'Pending', release: false, notes: 'Awaiting QC' },
] as const;

export const orders = [
  { refNo: 'SO-201', date: '2026-11-05', distributor: 'd1', product: 'p1', cartons: 11, rate: 6.25, dispatch: true },
  { refNo: 'SO-202', date: '2026-11-06', distributor: 'd2', product: 'p2', cartons: 7, rate: 6.25, dispatch: true },
  { refNo: 'SO-203', date: '2026-11-09', distributor: 'd3', product: 'p3', cartons: 4, rate: 12.5, dispatch: false },
] as const;

export const collections = [
  { refNo: 'RC-01', date: '2026-11-07', order: 'SO-201', amount: 18000, method: 'Bank Transfer', note: 'Demo partial payment' },
] as const;

export const finance = [
  { refNo: 'FIN-001', date: '2026-10-20', type: 'Capital Injection', category: 'Other', amount: 1500000, party: 'Investor Group A', note: 'Sample equity capital', funding: 'Equity', signed: ['A', 'B'] },
  { refNo: 'FIN-002', date: '2026-10-23', type: 'Capital Injection', category: 'Other', amount: 500000, party: 'Investor Group B', note: 'Sample working capital', funding: 'Equity', signed: ['A', 'B'] },
  { refNo: 'FIN-003', date: '2026-11-02', type: 'Operating Expense', category: 'Marketing', amount: 36000, party: 'Campaign vendor', note: 'Sample campaign', funding: '', signed: ['A'] },
  { refNo: 'FIN-004', date: '2026-11-04', type: 'Asset Purchase', category: 'Printing', amount: 85000, party: 'Machine parts supplier', note: 'Sample printing equipment', funding: '', signed: ['A', 'B'] },
  { refNo: 'FIN-005', date: '2026-11-08', type: 'Operating Expense', category: 'Packaging', amount: 72000, party: 'Flexible packaging vendor', note: 'Pending second approval', funding: '', signed: ['A'] },
  { refNo: 'FIN-006', date: '2026-11-09', type: 'Operating Expense', category: 'Exports', amount: 24000, party: 'Documentation', note: 'Sample request', funding: '', signed: [] },
] as const;

export const accounting = [
  { refNo: 'ACC-DEMO-01', date: '2026-11-08', kind: 'Income', category: 'Other Sales', foreignAmount: 25000, party: 'Illustrative wholesale customer', dueDate: '2026-11-28', note: 'Example unpaid non-distributor invoice', signed: [] },
  { refNo: 'ACC-DEMO-02', date: '2026-11-08', kind: 'Expense', category: 'Utilities', foreignAmount: 16000, party: 'Example electricity supplier', dueDate: '2026-11-19', note: 'Sample payable / not a production batch cost', signed: ['A'] },
] as const;

/**
 * Production orders (scope v2, illustrative): one accepted and in production, one still a draft.
 * No due date and nothing waiting for an answer, so the prototype's alert count stays the same.
 */
export const productionOrders = [
  { date: '2026-11-10', product: 'p1', containers: 2, notes: 'Illustrative order', send: true, accept: true, stages: ['Preparation', 'In production'] },
  { date: '2026-11-11', product: 'p4', containers: 1, notes: 'Draft for next month', send: false, accept: false, stages: [] as string[] },
];

/**
 * Scope v2: one order through the whole chain, loaded after the prototype check (illustrative figures).
 * Order -> advance asked, approved and paid -> shipped -> received by the distributor -> one container sold,
 * invoice verified -> part of it collected. Days count back from the day of seeding.
 */
export const chainSample = {
  product: 'p3', distributor: 'd3', containers: 2, containersSold: 1, notes: 'Sample order through the whole chain',
  stages: ['Preparation', 'In production', 'Quality check', 'Ready to ship'],
  orderDaysAgo: 20, advanceDaysAgo: 18, advanceInvoiceNo: 'BCP-INV-101', advancePaidDaysAgo: 17,
  shipDaysAgo: 8, vehicle: 'TLR-4521', waybill: 'BLT-7781', receiveDaysAgo: 7,
  invoiceDaysAgo: 3, distributorInvoiceNo: 'USS-0042', collectedDaysAgo: 1, collected: 20000,
};

export const portalRequests = [
  { refNo: 'REQ-DEMO-01', date: '2026-11-09', distributor: 'd1', product: 'p2', cartons: 5, requestedDate: '2026-11-14', notes: 'Demo request for next shipment', status: 'Requested' },
] as const;

/**
 * What the prototype shows on its first screen. The seed checks the new backend against these.
 * (net profit is -20,942.34 before rounding: the prototype displays -20,942)
 */
export const PARITY = {
  cash: 1897000,
  stockCartons: 65,
  stockPacks: 28080,
  netProfit: -20942.34,
  openReceivables: 55600,
  capitalRaised: 2000000,
  capitalTarget: 8000000,
  alerts: 5,
  pendingApprovals: 2,
  orderValues: { 'SO-201': 29700, 'SO-202': 18900, 'SO-203': 21600 },
};
