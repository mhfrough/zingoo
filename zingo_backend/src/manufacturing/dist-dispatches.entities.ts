import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { DocEntity } from '../common/doc.entity';
import { ProductionShipment } from './shipments.entities';

/** Dispatched = on the road to the customer; Delivered = the customer has it; Returned = it came back */
export const DIST_DISPATCH_STATUS = ['Dispatched', 'Delivered', 'Returned'] as const;
export type DistDispatchStatus = (typeof DIST_DISPATCH_STATUS)[number];

/**
 * Bundles a distributor sends out of a received delivery (its batch) to one of its own customers: a shop, a
 * wholesaler, a sub-distributor. Zen Foods sees each dispatch and its delivery. Nothing posts: the sale itself is
 * the distributor's sales invoice; a dispatch only tracks where the goods went.
 */
@Entity('distributor_dispatches')
export class DistributorDispatch extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Distributor, { nullable: false })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  /** the delivery (batch) the goods are taken from */
  @ManyToOne(() => ProductionShipment, { nullable: false, onDelete: 'RESTRICT' })
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
  bundles: number;

  /** who it goes to: shop, wholesaler, sub-distributor */
  @Column({ type: 'varchar', length: 120 })
  customer: string;

  /** town, market or route */
  @Column({ type: 'varchar', length: 120, nullable: true })
  area: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  vehicle: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 120 })
  dispatchedBy: string;

  @Column({ type: 'varchar', length: 12, default: 'Dispatched' })
  status: DistDispatchStatus;

  /** when the customer got it, or when it came back */
  @Column({ type: 'date', nullable: true })
  closedDate: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  closedNote: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  closedBy: string | null;
}
