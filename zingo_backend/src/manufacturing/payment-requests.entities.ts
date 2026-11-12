import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';
import { Manufacturer } from '../catalog/catalog.entities';
import { ProductionOrder } from './production-orders.entities';

/** An advance asked for when the order is accepted, or the balance of the order value. */
export const REQUEST_KINDS = ['Advance', 'Balance'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * Submitted: waiting for the company's signatures (approval and payment state are worked out from the signatures
 * and the payments). Rejected by the company, or Withdrawn by the manufacturer before anyone signed.
 */
export const REQUEST_STATUS = ['Submitted', 'Rejected', 'Withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

/** the bank account the manufacturer asked to be paid at, copied when the request is made */
export interface RequestBank {
  bank: string;
  title: string;
  account: string;
  branch?: string;
}

/**
 * A manufacturer's payment invoice against one production order: the advance (the order's advance %) or the
 * balance. The company approves it with the same one or two signatures as other spending, then pays it.
 */
@Entity('mfr_payment_requests')
export class MfrPaymentRequest extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ProductionOrder, { nullable: false })
  @JoinColumn({ name: 'orderId' })
  order: ProductionOrder;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Manufacturer, { nullable: false })
  @JoinColumn({ name: 'manufacturerId' })
  manufacturer: Manufacturer;

  @Column({ type: 'uuid' })
  manufacturerId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: RequestKind;

  /** PKR asked for */
  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;

  /** the manufacturer's own invoice number */
  @Column({ type: 'varchar', length: 60, nullable: true })
  invoiceNo: string | null;

  @Column({ type: 'jsonb' })
  bank: RequestBank;

  @Column({ type: 'varchar', length: 12, default: 'Submitted' })
  status: RequestStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  /** why the company rejected it */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  /** who raised it: the manufacturer itself, or staff for it */
  @Column({ type: 'varchar', length: 120 })
  raisedBy: string;
}

/** One payment the company made against an approved request (part payments allowed). */
@Entity('mfr_request_payments')
export class MfrRequestPayment extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => MfrPaymentRequest, { nullable: false })
  @JoinColumn({ name: 'requestId' })
  request: MfrPaymentRequest;

  @Column({ type: 'uuid' })
  requestId: string;

  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  amount: number;

  /** payment method (Settings list PAY_METHOD) */
  @Column({ type: 'varchar', length: 40 })
  method: string;

  /** the company account it was paid from (Settings list BANK_ACCOUNT) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  fromAccount: string | null;

  /** bank transfer or cheque reference */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}
