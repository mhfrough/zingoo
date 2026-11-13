import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';
import { ProductionShipment } from './shipments.entities';

export const DELIVERY_CLAIM_KINDS = ['Damaged', 'Missing', 'Quality'] as const;
export type DeliveryClaimKind = (typeof DELIVERY_CLAIM_KINDS)[number];
export const DELIVERY_CLAIM_STATUS = ['Pending', 'Accepted', 'Rejected'] as const;
export type DeliveryClaimStatus = (typeof DELIVERY_CLAIM_STATUS)[number];
/** Credit = what Zen Foods owes the manufacturer drops by the claim's value; Replace = the manufacturer sends new goods */
export const DELIVERY_CLAIM_RESOLUTIONS = ['Credit', 'Replace'] as const;
export type DeliveryClaimResolution = (typeof DELIVERY_CLAIM_RESOLUTIONS)[number];

/**
 * Faulty goods in a delivery from a manufacturer (damaged, missing or poor quality bundles), raised by the
 * distributor it went to (or staff for it). The manufacturer the goods came from decides: accept with a credit or a
 * replacement, or reject with a reason. Zen Foods sees every claim and its outcome.
 */
@Entity('delivery_claims')
export class DeliveryClaim extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ProductionShipment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shipmentId' })
  shipment: ProductionShipment;

  @Column({ type: 'uuid' })
  shipmentId: string;

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

  @ManyToOne(() => Distributor, { nullable: false })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  @Column({ type: 'varchar', length: 12 })
  kind: DeliveryClaimKind;

  /** faulty bundles */
  @Column({ type: 'int' })
  bundles: number;

  /** bundles x packets per bundle x the order rate, PKR */
  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  value: number;

  @Column({ type: 'varchar', length: 500 })
  note: string;

  /** photo or PDF: file name, type and base64 data */
  @Column({ type: 'varchar', length: 250, nullable: true })
  evidence: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  evidenceMime: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  evidenceData: string | null;

  @Column({ type: 'varchar', length: 120 })
  raisedBy: string;

  @Column({ type: 'varchar', length: 10, default: 'Pending' })
  status: DeliveryClaimStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  resolution: DeliveryClaimResolution | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'date', nullable: true })
  decidedDate: string | null;
}
