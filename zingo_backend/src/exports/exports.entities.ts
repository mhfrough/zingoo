import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Product } from '../catalog/catalog.entities';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';

const money = { type: 'decimal' as const, precision: 14, scale: 2, default: 0, transformer: numeric };

/** An export container: quote first, "Shipped" posts the invoice and the costs. */
@Entity('export_shipments')
export class ExportShipment extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  shipDate: string | null;

  @Column({ type: 'varchar', length: 150 })
  buyer: string;

  @Column({ type: 'varchar', length: 80 })
  country: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  port: string | null;

  @Column({ type: 'varchar', length: 10 })
  container: string;

  @Column({ type: 'varchar', length: 5 })
  incoterm: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  cartons: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  /** PKR per 1 unit of the invoice currency */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numeric })
  fxRate: number;

  /** selling price per pack, in the invoice currency */
  @Column({ type: 'decimal', precision: 14, scale: 6, transformer: numeric })
  rate: number;

  // seller-side costs, all in the invoice currency
  @Column(money) inland: number;
  @Column(money) origin: number;
  @Column(money) documentation: number;
  @Column(money) ocean: number;
  @Column(money) insurance: number;
  @Column(money) destination: number;
  @Column(money) duty: number;
  @Column(money) bankFees: number;
  @Column(money) otherCosts: number;

  @Column({ type: 'varchar', length: 10, default: 'Quote' })
  status: 'Quote' | 'Shipped';

  @Column({ type: 'int', nullable: true })
  packsPerCarton: number | null;

  /** snapshot at shipping: average factory cost per carton */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true, transformer: numeric })
  unitCost: number | null;
}

/** Foreign-currency money received for a shipment. */
@Entity('export_receipts')
export class ExportReceipt extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ExportShipment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shipmentId' })
  shipment: ExportShipment;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  foreignAmount: number;

  /** PKR per 1 unit on the day the money arrived (the difference to the quote is FX gain/loss) */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numeric })
  fxRate: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}

/** PKR paid for the seller-side logistics costs of a shipment. */
@Entity('export_cost_payments')
export class ExportCostPayment extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ExportShipment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shipmentId' })
  shipment: ExportShipment;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
