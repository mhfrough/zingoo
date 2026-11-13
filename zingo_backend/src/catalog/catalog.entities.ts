import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';

/** one saved way of packing a product */
export interface PackagingTemplate {
  name: string;
  packetsPerBundle: number;
  bundlesPerContainer: number;
  isDefault: boolean;
}

/** an uploaded file kept on a manufacturer or a distributor */
export interface PartnerFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * A SKU: one flavour in one packet size and price tier.
 * Packaging: snack packet -> bundle (packsPerCarton packets) -> container (bundlesPerContainer bundles).
 * A container is the batch the business hands to a distributor. Each SKU is assigned one manufacturer and one distributor.
 */
@Entity('products')
export class Product extends AppEntity {
  @Column({ type: 'varchar', length: 40, unique: true })
  sku: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** retail price tier in PKR (10 or 20) */
  @Column({ type: 'int' })
  pack: number;

  /** printed retail price per pack */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  mrp: number;

  /** default price per pack charged to distributors */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;

  /** what the manufacturer charges per pack */
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  manufacturerRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  packagingRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  printingRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  inboundRate: number;

  /** freight from the manufacturer or warehouse to the distributor, per packet */
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  outboundRate: number;

  /** weight of one packet in grams (what the price tier buys; used to bargain with the manufacturer) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: numeric })
  gramsPerPacket: number | null;

  /**
   * Saved packaging templates (packets per bundle, bundles per container); one is the default, and
   * packsPerCarton / bundlesPerContainer always hold the default's figures. An order picks a template.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  packagings: PackagingTemplate[];

  /** packets in one bundle (the column keeps its first name: a bundle was called a carton) */
  @Column({ type: 'int' })
  packsPerCarton: number;

  /** bundles in one container (a container is the batch given to a distributor) */
  @Column({ type: 'int', default: 10 })
  bundlesPerContainer: number;

  /** flavour, from the Settings list FLAVOUR */
  @Column({ type: 'varchar', length: 80, nullable: true })
  flavour: string | null;

  /** packet size (weight), from the Settings list PACKET_SIZE */
  @Column({ type: 'varchar', length: 40, nullable: true })
  packetSize: string | null;

  /** what the product is, in words */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** the manufacturer that makes this SKU */
  @ManyToOne(() => Manufacturer, { nullable: true })
  @JoinColumn({ name: 'manufacturerId' })
  manufacturer: Manufacturer | null;

  @Column({ type: 'uuid', nullable: true })
  manufacturerId: string | null;

  /** every distributor that sells this SKU; the first one is also `distributorId` (the default for orders) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  distributorIds: string[];

  /** the main distributor that sells this SKU */
  @ManyToOne(() => Distributor, { nullable: true })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor | null;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;

  /** days the distributor has to sell a container out; empty = the distributor's own default */
  @Column({ type: 'int', nullable: true })
  selloutDays: number | null;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ default: true })
  active: boolean;
}

/** one bank account of a manufacturer: where its payment invoices ask to be paid */
export interface PartnerBankAccount {
  /** bank name, from the Settings list BANK */
  bank: string;
  /** account title (holder name) */
  title: string;
  /** account number or IBAN */
  account: string;
  branch?: string;
  /** the account used when the manufacturer does not pick one */
  isDefault: boolean;
}

/** the ways a manufacturer can be paid */
export const MANUFACTURER_TERMS = ['Advance', 'Credit line'] as const;
export type ManufacturerTerm = (typeof MANUFACTURER_TERMS)[number];

/** The production partner(s) that make the goods. */
@Entity('manufacturers')
export class Manufacturer extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** how the manufacturer is paid: an advance on each order, a credit line, or both */
  @Column({ type: 'jsonb', default: () => `'["Advance"]'` })
  paymentTerms: ManufacturerTerm[];

  /** credit line: days allowed to clear what is owed after delivery (0 = no limit) */
  @Column({ type: 'int', default: 30 })
  paymentDays: number;

  /** credit line: the most Zen Foods may owe the manufacturer, in its currency (0 = no limit) */
  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  creditLimit: number;

  /** advance paid when an order is placed, % of the order value (0 when there is no advance term) */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  advancePct: number;

  /** the manufacturer's bank accounts; one is the default */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  bankAccounts: PartnerBankAccount[];

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact: string | null;

  /** point of contact: the person to speak to */
  @Column({ type: 'varchar', length: 150, nullable: true })
  poc: string | null;

  /** the contract: its number or title */
  @Column({ type: 'varchar', length: 150, nullable: true })
  contract: string | null;

  /** the agreed terms, in words */
  @Column({ type: 'text', nullable: true })
  terms: string | null;

  /** uploaded files: the signed contract, licences, pictures (details only, the content is an attachment) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  files: PartnerFile[];
}

/** where a distributor sells: Pakistan, abroad, or both */
export const DISTRIBUTOR_MARKETS = ['Local', 'International', 'Both'] as const;
export type DistributorMarket = (typeof DISTRIBUTOR_MARKETS)[number];

/**
 * Active: works normally. Hold: its logins can sign in and look, but change nothing.
 * Temporary suspend / Permanent suspend: its logins cannot sign in, and no new orders go to it.
 */
export const DISTRIBUTOR_STATUS = ['Active', 'Hold', 'Temporary suspend', 'Permanent suspend'] as const;
export type DistributorStatus = (typeof DISTRIBUTOR_STATUS)[number];

/**
 * Registration of an international distributor (the client's spec, section 1 and 8):
 * Draft -> Documents submitted -> Under review -> Approved -> Active; and On hold, Suspended, Archived.
 * A local distributor is Active from the start.
 */
export const REGISTRATION_STATUS = ['Draft', 'Documents submitted', 'Under review', 'Approved', 'Active', 'On hold', 'Suspended', 'Archived'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];

/** where the agreement stands; Expired is worked out from the end date */
export const AGREEMENT_STATUS = ['Draft', 'Under review', 'Signed', 'Expired', 'Terminated'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUS)[number];

/** kinds of address a distributor keeps */
export const ADDRESS_TYPES = ['Registered', 'Billing', 'Warehouse', 'Consignee', 'Delivery'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

/** one person to deal with at the distributor */
export interface DistributorContact {
  name: string;
  role?: string;
  email?: string;
  /** country calling code, e.g. +971 */
  phoneCode?: string;
  mobile?: string;
  whatsapp?: string;
  isPrimary: boolean;
}

/** one address of the distributor; one default per type */
export interface DistributorAddress {
  type: AddressType;
  line: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country: string;
  isDefault: boolean;
}

/** one KYC document: its kind (Settings list KYC_DOC_TYPE), the file, and an expiry when it has one */
export interface KycDocument {
  type: string;
  file: PartnerFile;
  expiry?: string | null;
}

/** a district with the province it is in */
/** international commercial terms (spec sections 3 and 4) */
export const PAYMENT_TERM_TYPES = ['Advance', 'Credit days', 'On shipment', 'On documents', 'Custom schedule'] as const;
export type PaymentTermType = (typeof PAYMENT_TERM_TYPES)[number];
export const PAYMENT_TRIGGERS = ['On order', 'Before shipment', 'On shipment', 'On documents', 'On arrival', 'After invoice'] as const;
export type PaymentTrigger = (typeof PAYMENT_TRIGGERS)[number];
export const BANK_CHARGES = ['Sender', 'Receiver', 'Shared'] as const;
export type BankCharges = (typeof BANK_CHARGES)[number];
export const CREDIT_CONTROL = ['Block', 'Warn'] as const;
export type CreditControl = (typeof CREDIT_CONTROL)[number];
/** the unit a price is quoted in; packs per unit is the explicit conversion factor */
export const PRICE_UNITS = ['Pack', 'Dozen', 'Bundle', 'Container', 'Pallet', 'Metric tonne'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];
export const PRICE_STATUS = ['Active', 'Pending approval', 'Rejected'] as const;
export type PriceStatus = (typeof PRICE_STATUS)[number];

/** one instalment of an advance / milestone plan; the plan adds up to 100% */
export interface PaymentMilestone {
  label: string;
  pct: number;
  trigger: PaymentTrigger;
  /** days after the trigger */
  days: number;
}

/** a bank account the distributor pays from; verified by Finance before remittances are matched to it */
export interface DistributorBank {
  beneficiary: string;
  bankName: string;
  account: string;
  iban?: string | null;
  swift?: string | null;
  currency?: string | null;
  isDefault: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
}

export interface AreaDistrict {
  name: string;
  province: string;
}

/** a city with its province and district (district empty when unknown) */
export interface AreaCity {
  name: string;
  province: string;
  district?: string | null;
}

@Entity('distributors')
export class Distributor extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** a short territory label for lists, worked out from the areas (first city, else district, else province, else country) */
  @Column({ type: 'varchar', length: 80 })
  region: string;

  @Column({ type: 'varchar', length: 14, default: 'Local' })
  market: DistributorMarket;

  /** provinces covered (Pakistan) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  provinces: string[];

  /** districts covered, each with its province */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  districts: AreaDistrict[];

  /** cities covered, each with its province and district */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  cities: AreaCity[];

  /** countries covered (an international distributor) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  countries: string[];

  /** exclusive: no other distributor may be given any of these areas */
  @Column({ default: false })
  exclusive: boolean;

  @Column({ type: 'varchar', length: 20, default: 'Active' })
  status: DistributorStatus;

  /** why it is on hold or suspended */
  @Column({ type: 'varchar', length: 500, nullable: true })
  statusNote: string | null;

  /** a temporary suspension ends on this date (it is lifted on that day) */
  @Column({ type: 'date', nullable: true })
  statusUntil: string | null;

  // ───── international distributor (the client's spec, sections 1, 2 and 8) ─────

  /** distributor ID, e.g. INT-DST-0001 (international or both; given when first saved) */
  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  code: string | null;

  /** exact registered legal name, used on invoices and export documents */
  @Column({ type: 'varchar', length: 200, nullable: true })
  legalName: string | null;

  /** display / trading name (the record's `name`) is separate; the website goes here */
  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  /** importer, master distributor, wholesaler, retail chain ... (Settings list DIST_CLASSIFICATION) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  classification: string | null;

  /** country of registration and head office */
  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  registrationNo: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  registrationAuthority: string | null;

  @Column({ type: 'date', nullable: true })
  registrationExpiry: string | null;

  /** how the destination taxes the distributor (VAT registered, exempt ...), kept apart from the tax number */
  @Column({ type: 'varchar', length: 150, nullable: true })
  taxTreatment: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  licenceNo: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  licenceAuthority: string | null;

  @Column({ type: 'date', nullable: true })
  licenceIssued: string | null;

  @Column({ type: 'date', nullable: true })
  licenceExpiry: string | null;

  /** the Zen Foods relationship manager and sales team */
  @Column({ type: 'varchar', length: 120, nullable: true })
  accountManager: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  salesTeam: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  contacts: DistributorContact[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  addresses: DistributorAddress[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  kycDocs: KycDocument[];

  /** agreement: dates, notice, version, its status and the signed copy */
  @Column({ type: 'date', nullable: true })
  agreementStart: string | null;

  @Column({ type: 'date', nullable: true })
  agreementEnd: string | null;

  /** days before the end date to start the renewal talk */
  @Column({ type: 'int', nullable: true })
  renewalNoticeDays: number | null;

  /** days of notice to end the agreement */
  @Column({ type: 'int', nullable: true })
  noticePeriodDays: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  agreementVersion: string | null;

  @Column({ type: 'varchar', length: 14, default: 'Draft' })
  agreementStatus: AgreementStatus;

  @Column({ type: 'jsonb', nullable: true })
  agreementFile: PartnerFile | null;

  /** minimum order and targets, in words and figures */
  @Column({ type: 'varchar', length: 300, nullable: true })
  moq: string | null;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  quarterlyTarget: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  annualTarget: number;

  /** SKUs the distributor may sell (empty = none approved yet) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  approvedProductIds: string[];

  /** modern trade, general trade, online ... */
  @Column({ type: 'varchar', length: 120, nullable: true })
  salesChannel: string | null;

  @Column({ type: 'varchar', length: 22, default: 'Active' })
  registrationStatus: RegistrationStatus;

  // pricing, currency and payment terms (spec sections 3 and 4)
  /** ISO code from Settings currencies; PKR stays the reporting currency */
  @Column({ type: 'varchar', length: 3, nullable: true })
  invoiceCurrency: string | null;

  /** EXW, FOB, CFR, CIF, DAP, DDP ... from the Settings list INCOTERM */
  @Column({ type: 'varchar', length: 10, nullable: true })
  incoterm: string | null;

  /** the named port or place */
  @Column({ type: 'varchar', length: 120, nullable: true })
  incotermPlace: string | null;

  @Column({ type: 'varchar', length: 20, default: 'Incoterms 2020' })
  incotermVersion: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  paymentTermType: PaymentTermType | null;

  /** advance / milestone plan, adds up to 100% */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  paymentPlan: PaymentMilestone[];

  /** the credit limit's currency (creditLimit is in it); approved by Finance */
  @Column({ type: 'varchar', length: 3, nullable: true })
  creditCurrency: string | null;

  @Column({ type: 'date', nullable: true })
  creditExpiry: string | null;

  /** Block or Warn when the limit is passed or an invoice is overdue */
  @Column({ type: 'varchar', length: 5, default: 'Block' })
  creditControl: CreditControl;

  @Column({ type: 'varchar', length: 120, nullable: true })
  creditApprovedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  creditApprovedAt: Date | null;

  /** bank transfer, SWIFT, documentary collection, LC ... from the Settings list SETTLEMENT_METHOD */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  settlementMethods: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  bankAccounts: DistributorBank[];

  /** who bears the bank charges */
  @Column({ type: 'varchar', length: 10, nullable: true })
  bankCharges: BankCharges | null;

  /** margin guardrail: a price below this margin needs Finance approval; 0 = no guardrail */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 10, transformer: numeric })
  minMarginPct: number;

  /** earlier single province, kept so older records can be moved to `provinces` */
  @Column({ type: 'varchar', length: 60, nullable: true })
  province: string | null;

  /** earlier extra cities, kept so older records can be moved to `cities` */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  areas: string[];

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  taxNo: string | null;

  /** payment terms in days; 0 = no limit (invoices have no due date) */
  @Column({ type: 'int', default: 30 })
  paymentDays: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  creditLimit: number;

  /** days a distributor has to sell a container out, unless the product says otherwise; 0 = no limit */
  @Column({ type: 'int', default: 30 })
  selloutDays: number;

  /** advance the distributor is asked to pay, % of the order */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  advancePct: number;

  /** point of contact: the person to speak to */
  @Column({ type: 'varchar', length: 150, nullable: true })
  poc: string | null;

  /** the contract: its number or title */
  @Column({ type: 'varchar', length: 150, nullable: true })
  contract: string | null;

  /** the agreed terms, in words */
  @Column({ type: 'text', nullable: true })
  terms: string | null;

  /** uploaded files: the signed contract, licences, pictures (details only, the content is an attachment) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  files: PartnerFile[];
}


/** One step of an international distributor's registration: submitted, approved by Finance, put on hold ... */
@Entity('distributor_registration_events')
export class DistributorRegistrationEvent extends AppEntity {
  @ManyToOne(() => Distributor, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  /** Submitted, Review started, Approved, Rejected, Activated, On hold, Suspended, Archived, Resumed */
  @Column({ type: 'varchar', length: 30 })
  action: string;

  /** for an approval: which sign-off (Sales, Finance, Compliance) */
  @Column({ type: 'varchar', length: 20, nullable: true })
  step: string | null;

  @Column({ type: 'varchar', length: 22 })
  fromStatus: string;

  @Column({ type: 'varchar', length: 22 })
  toStatus: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 120 })
  by: string;

  @Column({ type: 'varchar', length: 20 })
  role: string;
}

/** Price per pack agreed with one distributor for one SKU (overrides Product.rate). */
@Entity('distributor_rates')
@Unique(['distributorId', 'productId'])
export class DistributorRate extends AppEntity {
  @ManyToOne(() => Distributor, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;
}

/**
 * One version of a distributor's price for one SKU, in a currency and a unit (spec section 3). Prices are never
 * overwritten: a new version closes the one before it. A price under the distributor's minimum margin waits for
 * Finance approval.
 */
@Entity('distributor_prices')
export class DistributorPrice extends AppEntity {
  @ManyToOne(() => Distributor, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  /** 1, 2, 3 ... per distributor, SKU and unit */
  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 14 })
  unit: PriceUnit;

  /** packs in one unit */
  @Column({ type: 'decimal', precision: 14, scale: 4, transformer: numeric })
  packsPerUnit: number;

  /** list price per unit, in the currency */
  @Column({ type: 'decimal', precision: 14, scale: 4, transformer: numeric })
  price: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  discountPct: number;

  @Column({ type: 'date' })
  effectiveFrom: string;

  /** null = open ended */
  @Column({ type: 'date', nullable: true })
  effectiveTo: string | null;

  /** minimum order and order multiple, in units */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  moq: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  increment: number;

  /** a sample or introductory / promotional price */
  @Column({ default: false })
  promo: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  /** PKR per 1 unit of the currency when the price was saved */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numeric })
  fxRate: number;

  /** cost per pack in PKR when saved (manufacturer, packaging, printing, inbound, outbound) */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  costPerPack: number;

  /** margin on the net price, % */
  @Column({ type: 'decimal', precision: 8, scale: 2, transformer: numeric })
  marginPct: number;

  @Column({ type: 'varchar', length: 18, default: 'Active' })
  status: PriceStatus;

  @Column({ type: 'varchar', length: 120 })
  createdBy: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** why a price under the floor was approved or rejected */
  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;
}
