import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';
import { Distributor, Product } from '../catalog/catalog.entities';
import { ProductionShipment } from './shipments.entities';

/** Submitted by the distributor -> Verified by the company (income posts) or Rejected (the stock is free again). */
export const DIST_INVOICE_STATUS = ['Submitted', 'Verified', 'Rejected'] as const;
export type DistInvoiceStatus = (typeof DIST_INVOICE_STATUS)[number];

/**
 * The distributor's sales invoice for containers it distributed: Zen Foods stock it held on consignment is sold,
 * so the company earns income at the distributor's rate per packet and the distributor owes it, due after its
 * payment days. Each line takes containers from one received delivery (lot).
 */
@Entity('distributor_invoices')
export class DistributorInvoice extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Distributor, { nullable: false })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  /** the distributor's own invoice number */
  @Column({ type: 'varchar', length: 60, nullable: true })
  invoiceNo: string | null;

  /** income: packets x the distributor's rate, PKR */
  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;

  /** cost of the goods sold: packets x the manufacturer's rate, PKR */
  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  cost: number;

  /** empty when the distributor's payment terms are 0 (no limit) */
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', length: 12, default: 'Submitted' })
  status: DistInvoiceStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 120 })
  submittedBy: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  verifiedBy: string | null;

  @OneToMany(() => DistributorInvoiceLine, (l) => l.invoice, { cascade: true })
  lines: DistributorInvoiceLine[];
}

/** containers of one delivery sold on an invoice */
@Entity('distributor_invoice_lines')
export class DistributorInvoiceLine extends AppEntity {
  @ManyToOne(() => DistributorInvoice, (i) => i.lines, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: DistributorInvoice;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => ProductionShipment, { nullable: false })
  @JoinColumn({ name: 'shipmentId' })
  shipment: ProductionShipment;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  containers: number;

  @Column({ type: 'int' })
  packets: number;

  /** distributor price per packet (agreed rate, else the product's) */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;

  /** manufacturer price per packet (the delivery's) */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  costRate: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;
}

/** money the distributor paid against a verified invoice */
@Entity('distributor_invoice_payments')
export class DistributorInvoicePayment extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => DistributorInvoice, { nullable: false })
  @JoinColumn({ name: 'invoiceId' })
  invoice: DistributorInvoice;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 40 })
  method: string;

  /** the company account it went into (Settings list BANK_ACCOUNT) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  toAccount: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}

/**
 * Money a distributor paid on one of its orders (an advance with the order, or Pay later). It counts at once:
 * Cash & Bank / Customer Advances, then it pays off the order's sales invoices as they are verified.
 */
@Entity('dist_order_payments')
export class DistOrderPayment extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Distributor, { nullable: false })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  /** the order paid on: its DO- number, or the production order number of a single order */
  @Column({ type: 'varchar', length: 30 })
  orderRef: string;

  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 40 })
  method: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  /** the uploaded proof (bank slip, transfer screenshot) */
  @Column({ type: 'uuid', nullable: true })
  proofId: string | null;

  @Column({ type: 'varchar', length: 250, default: '' })
  proofName: string;

  /** Advance = paid with the order; Payment = paid later from the order list */
  @Column({ type: 'varchar', length: 12, default: 'Payment' })
  kind: 'Advance' | 'Payment';

  /** Active, or Reversed by staff when the money did not arrive */
  @Column({ type: 'varchar', length: 12, default: 'Active' })
  status: 'Active' | 'Reversed';

  @Column({ type: 'varchar', length: 120 })
  recordedBy: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reversedBy: string | null;
}
