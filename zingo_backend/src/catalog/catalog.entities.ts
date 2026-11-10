import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';

/** A SKU: one flavour in one pack tier (Rs 10 or Rs 20). */
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

  @Column({ type: 'int' })
  packsPerCarton: number;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ default: true })
  active: boolean;
}

/** The production partner(s) that make the cartons. */
@Entity('manufacturers')
export class Manufacturer extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'int', default: 30 })
  paymentDays: number;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact: string | null;
}

@Entity('distributors')
export class Distributor extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 80 })
  region: string;

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

  /** advance the distributor is asked to pay, % of the order */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  advancePct: number;
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
