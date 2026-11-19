import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Distributor, Product } from '../catalog/catalog.entities';
import { AppEntity } from '../common/app.entity';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';
import { SalesOrder } from '../distribution/distribution.entities';
import { OrderTransport, ProductionOrder } from '../manufacturing/production-orders.entities';

/** Distributor asks for stock; staff accept it into a production order (or, with sales orders on, a warehouse sales order). */
/** an advance paid with a distributor order: what, how, when, and the proof (an uploaded file) */
export interface OrderAdvance {
  amount: number;
  method: string;
  date: string;
  reference: string | null;
  proofId: string;
  proofName: string;
}

@Entity('portal_requests')
export class PortalRequest extends DocEntity {
  @Column({ type: 'date' })
  date: string;

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

  @Column({ type: 'date', nullable: true })
  requestedDate: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  poRef: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 12, default: 'Requested' })
  status: 'Requested' | 'Accepted' | 'Rejected';

  @ManyToOne(() => SalesOrder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'orderId' })
  order: SalesOrder | null;

  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  /** the production order the request became (the manufacturer makes it and sends it to the distributor) */
  @ManyToOne(() => ProductionOrder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'productionOrderId' })
  productionOrder: ProductionOrder | null;

  @Column({ type: 'uuid', nullable: true })
  productionOrderId: string | null;

  /** staff note when the request is rejected */
  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  /** the order this line belongs to (DO-001): an order of several products is one request per product */
  @Column({ type: 'varchar', length: 30, nullable: true })
  groupRef: string | null;

  /** containers asked for (empty on old requests: then `cartons` bundles, rounded up to containers) */
  @Column({ type: 'int', nullable: true })
  containers: number | null;

  /** packaging template picked, and the packing figures used on this order (may differ from the template) */
  @Column({ type: 'varchar', length: 60, nullable: true })
  packaging: string | null;

  @Column({ type: 'int', nullable: true })
  packetsPerBundle: number | null;

  @Column({ type: 'int', nullable: true })
  bundlesPerContainer: number | null;

  /** planned transport (transporter, vehicle, driver) */
  @Column({ type: 'jsonb', nullable: true })
  transport: OrderTransport | null;

  /** the advance the distributor says it paid with the order, with its proof (same on every line of the order) */
  @Column({ type: 'jsonb', nullable: true })
  advance: OrderAdvance | null;

  /** the manufacturer picked for this line (a SKU can have several); empty = the product's default */
  @Column({ type: 'uuid', nullable: true })
  manufacturerId: string | null;

  /** Carton, Bora: from the template picked, or changed on the order */
  @Column({ type: 'varchar', length: 40, nullable: true })
  containerUnit: string | null;
}

/** Proof of delivery filed by the distributor, with damaged / missing cartons. */
@Entity('cargo_receipts')
export class CargoReceipt extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order: SalesOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'int' })
  goodCartons: number;

  @Column({ type: 'int', default: 0 })
  damagedCartons: number;

  @Column({ type: 'int', default: 0 })
  missingCartons: number;

  @Column({ type: 'varchar', length: 20, default: 'Good' })
  condition: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  waybill: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  receivedBy: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** name of the uploaded evidence file */
  @Column({ type: 'varchar', length: 250, nullable: true })
  evidence: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  evidenceMime: string | null;

  /** the evidence file, base64 (kept small: 450 KB at most) */
  @Column({ type: 'text', nullable: true })
  evidenceData: string | null;

  @Column({ type: 'varchar', length: 12, default: 'Accepted' })
  status: 'Accepted' | 'Disputed' | 'Approved' | 'Rejected';

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;
}

/** Distributor tells us "I paid"; staff confirm it, which creates the collection. */
@Entity('payment_advices')
export class PaymentAdvice extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order: SalesOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  distributorId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  bankRef: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  proof: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  proofMime: string | null;

  /** the receipt or screenshot, base64 (450 KB at most) */
  @Column({ type: 'text', nullable: true })
  proofData: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** staff note when the advice is rejected */
  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  /** the collection created when staff confirmed this advice */
  @Column({ type: 'uuid', nullable: true })
  collectionId: string | null;

  @Column({ type: 'varchar', length: 12, default: 'Submitted' })
  status: 'Submitted' | 'Confirmed' | 'Rejected';

  @Column({ default: false })
  isAdvance: boolean;
}

/** Credit given to a distributor after an approved damage / shortage claim. */
@Entity('credit_notes')
export class CreditNote extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order: SalesOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  distributorId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  /** the part that exceeds the open invoice and is owed back to the distributor */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  refund: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}

/** Who did what in the partner portal. */
@Entity('audit_log')
export class AuditLog extends AppEntity {
  @Column({ type: 'varchar', length: 80 })
  event: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 120 })
  by: string;
}
