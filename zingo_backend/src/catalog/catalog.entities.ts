import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';

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

  /** the distributor that sells this SKU */
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

/** The production partner(s) that make the goods. */
@Entity('manufacturers')
export class Manufacturer extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** days allowed to pay the balance after delivery */
  @Column({ type: 'int', default: 30 })
  paymentDays: number;

  /** advance paid when an order is placed, % of the order value */
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

@Entity('distributors')
export class Distributor extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** main city (the column keeps its first name) */
  @Column({ type: 'varchar', length: 80 })
  region: string;

  /** province or territory of the main city */
  @Column({ type: 'varchar', length: 60, nullable: true })
  province: string | null;

  /** the other cities or areas the distributor covers */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  areas: string[];

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  taxNo: string | null;

  /** payment terms in days */
  @Column({ type: 'int', default: 30 })
  paymentDays: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  creditLimit: number;

  /** days a distributor has to sell a container out, unless the product says otherwise */
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
