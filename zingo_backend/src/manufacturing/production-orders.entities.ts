import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';

/** Where the finished containers go: straight to the assigned distributor, or into the Zen Foods warehouse (exports). */
export const ORDER_DESTINATIONS = ['Distributor', 'Warehouse'] as const;
export type OrderDestination = (typeof ORDER_DESTINATIONS)[number];

/**
 * Life of a production order.
 * Draft (company is still writing it) -> Sent (waiting for the manufacturer) -> Accepted or Rejected.
 * The company can cancel it until it is shipped. Shipping and delivery come in a later phase.
 */
export const PRODUCTION_ORDER_STATUS = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Cancelled'] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUS)[number];

/**
 * An order the company places with a manufacturer: so many containers of one SKU, at an agreed rate per packet,
 * delivered to a distributor (or the warehouse) by a date. The packaging and the advance % are copied from the
 * product and the manufacturer when the order is made, so later changes there do not change the order.
 */
@Entity('production_orders')
export class ProductionOrder extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Manufacturer, { nullable: false })
  @JoinColumn({ name: 'manufacturerId' })
  manufacturer: Manufacturer;

  @Column({ type: 'uuid' })
  manufacturerId: string;

  @Column({ type: 'varchar', length: 20, default: 'Distributor' })
  destination: OrderDestination;

  /** the distributor that receives the containers (empty when they go to the warehouse) */
  @ManyToOne(() => Distributor, { nullable: true })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor | null;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;

  /** containers ordered (a container is one batch for a distributor) */
  @Column({ type: 'int' })
  containers: number;

  /** packaging at the time of the order */
  @Column({ type: 'int' })
  bundlesPerContainer: number;

  @Column({ type: 'int' })
  packetsPerBundle: number;

  /** agreed price per packet, PKR */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;

  /** advance % agreed with the manufacturer at the time of the order */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  advancePct: number;

  /** the date the company needs the containers delivered */
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  /** the date the manufacturer expects them ready (given when it accepts) */
  @Column({ type: 'date', nullable: true })
  readyDate: string | null;

  @Column({ type: 'varchar', length: 20, default: 'Draft' })
  status: ProductionOrderStatus;

  /** the latest production step the manufacturer reported (Settings list ORDER_STAGE) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  stage: string | null;

  /** why it was rejected or cancelled */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => ProductionOrderEvent, (e) => e.order)
  events: ProductionOrderEvent[];
}

/** One line of an order's timeline: sent, accepted, a stage reported, cancelled ... with who did it. */
@Entity('production_order_events')
export class ProductionOrderEvent extends AppEntity {
  @ManyToOne(() => ProductionOrder, (o) => o.events, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: ProductionOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 80 })
  event: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  /** name of the person, and whether they are company staff or the manufacturer */
  @Column({ type: 'varchar', length: 120 })
  by: string;

  @Column({ type: 'varchar', length: 20 })
  side: 'Company' | 'Manufacturer';
}
