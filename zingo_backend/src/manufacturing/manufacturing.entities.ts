import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Manufacturer, Product } from '../catalog/catalog.entities';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';

/** A production run at the manufacturer. Releasing it (after QC) puts cartons into stock. */
@Entity('production_batches')
export class ProductionBatch extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Manufacturer, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'manufacturerId' })
  manufacturer: Manufacturer;

  @Column({ type: 'uuid' })
  manufacturerId: string;

  @Column({ type: 'int' })
  targetCartons: number;

  @Column({ type: 'int', default: 0 })
  producedCartons: number;

  /** total cost of the batch, accrued as a payable to the manufacturer when released */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  cost: number;

  @Column({ type: 'varchar', length: 10, default: 'Pending' })
  qc: 'Pending' | 'Passed' | 'Failed';

  @Column({ type: 'varchar', length: 10, default: 'Planned' })
  status: 'Planned' | 'Released';

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}

/** Money paid to the manufacturer against a released batch. */
@Entity('manufacturer_payments')
export class ManufacturerPayment extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ProductionBatch, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'batchId' })
  batch: ProductionBatch;

  @Column({ type: 'uuid' })
  batchId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
