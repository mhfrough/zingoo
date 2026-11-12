import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';
import { OrderDestination, ProductionOrder } from './production-orders.entities';

/** In transit until the distributor (or the warehouse) confirms what arrived. */
export const SHIPMENT_STATUS = ['In transit', 'Received'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS)[number];

/**
 * Containers the manufacturer sends against an accepted order, straight to the order's distributor (or into the
 * Zen Foods warehouse). An order can arrive in several shipments. A container is one batch for a distributor.
 * Packaging and rate are copied from the order, so the value of what arrived is fixed.
 * Once received at a distributor the containers stay Zen Foods stock (consignment) until the distributor sells
 * them; they must be sold by `sellBy` (receipt date + the sell-out days that applied).
 */
@Entity('production_shipments')
export class ProductionShipment extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @ManyToOne(() => ProductionOrder, { nullable: false })
  @JoinColumn({ name: 'orderId' })
  order: ProductionOrder;

  @Column({ type: 'uuid' })
  orderId: string;

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

  @Column({ type: 'varchar', length: 20 })
  destination: OrderDestination;

  @ManyToOne(() => Distributor, { nullable: true })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor | null;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;

  @Column({ type: 'date' })
  shipDate: string;

  /** containers sent */
  @Column({ type: 'int' })
  containers: number;

  @Column({ type: 'int' })
  bundlesPerContainer: number;

  @Column({ type: 'int' })
  packetsPerBundle: number;

  /** order price per packet, PKR */
  @Column({ type: 'decimal', precision: 12, scale: 4, transformer: numeric })
  rate: number;

  /** truck or container number */
  @Column({ type: 'varchar', length: 60, nullable: true })
  vehicle: string | null;

  /** waybill / bilty number */
  @Column({ type: 'varchar', length: 60, nullable: true })
  waybill: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 120 })
  shippedBy: string;

  @Column({ type: 'varchar', length: 12, default: 'In transit' })
  status: ShipmentStatus;

  @Column({ type: 'date', nullable: true })
  receivedDate: string | null;

  /** containers that arrived in good order (only these are owed to the manufacturer and become stock) */
  @Column({ type: 'int', nullable: true })
  receivedContainers: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  receivedBy: string | null;

  /** what was short or damaged */
  @Column({ type: 'varchar', length: 500, nullable: true })
  receiptNote: string | null;

  /** sell-out days that applied when it arrived (product's own, else the distributor's) */
  @Column({ type: 'int', nullable: true })
  selloutDays: number | null;

  /** the date the distributor must have sold it by */
  @Column({ type: 'date', nullable: true })
  sellBy: string | null;
}
