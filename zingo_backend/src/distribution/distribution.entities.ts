import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';

/** An order from a distributor. Draft until dispatched; dispatching reduces stock and creates the invoice. */
@Entity('sales_orders')
export class SalesOrder extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  dispatchDate: string | null;

  @ManyToOne(() => Distributor, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  cartons: number;

  /** price per pack */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;

  /** snapshot at dispatch (the invoice no longer changes if the SKU changes) */
  @Column({ type: 'int', nullable: true })
  packsPerCarton: number | null;

  /** snapshot at dispatch: average factory cost per carton, used for cost of goods sold */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true, transformer: numeric })
  unitCost: number | null;

  @Column({ type: 'varchar', length: 10, default: 'Draft' })
  status: 'Draft' | 'Dispatched';

  @Column({ type: 'int', nullable: true })
  paymentTermsDays: number | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: numeric })
  advancePct: number | null;

  /** Finance allowed this order to go out although the distributor is over the credit limit */
  @Column({ default: false })
  creditOverride: boolean;

  @Column({ type: 'text', nullable: true })
  creditOverrideNote: string | null;

  /** the distributor's own purchase-order number */
  @Column({ type: 'varchar', length: 60, nullable: true })
  poRef: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}

/** Money received from a distributor against an order. */
@Entity('collections')
export class Collection extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order: SalesOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** paid before dispatch (held as a customer advance) */
  @Column({ default: false })
  isAdvance: boolean;
}
