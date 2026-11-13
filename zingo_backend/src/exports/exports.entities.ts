import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Distributor, PartnerFile, PaymentMilestone, Product } from '../catalog/catalog.entities';
import { AppEntity } from '../common/app.entity';
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

  /** the international distributor this order is for (older quotes only have the buyer's name) */
  @ManyToOne(() => Distributor, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor | null;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;

  /** the price-list version the rate came from */
  @Column({ type: 'uuid', nullable: true })
  priceId: string | null;

  /** payment terms copied from the distributor when the order was made (editable on the order, not on the distributor) */
  @Column({ type: 'int', nullable: true })
  paymentDays: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  paymentPlan: PaymentMilestone[];

  /** set when it ships: ship date + payment days */
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  /** over the credit limit or with invoices overdue: Finance's override, kept with who, when and why */
  @Column({ type: 'varchar', length: 120, nullable: true })
  creditOverrideBy: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  creditOverrideRole: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  creditOverrideReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  creditOverrideAt: Date | null;

  /** what the credit check said when it shipped (a Warn distributor ships anyway) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  creditNote: string | null;

  // logistics (spec section 5): the actual details of this shipment
  @Column({ type: 'varchar', length: 120, nullable: true })
  dischargePort: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  shippingMode: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  bookingNo: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  containerNo: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  sealNo: string | null;

  /** bill of lading or air waybill */
  @Column({ type: 'varchar', length: 60, nullable: true })
  blNo: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  vessel: string | null;

  @Column({ type: 'date', nullable: true })
  etd: string | null;

  @Column({ type: 'date', nullable: true })
  eta: string | null;

  /** after it ships: Loaded, Sailed, Arrived, Delivered */
  @Column({ type: 'varchar', length: 12, nullable: true })
  shippingStatus: string | null;

  /** commercial invoice, packing list, certificate of origin, BL ... */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  documents: { type: string; file: PartnerFile }[];

  // batch traceability (spec section 6)
  @Column({ type: 'varchar', length: 60, nullable: true })
  batchRef: string | null;

  @Column({ type: 'date', nullable: true })
  mfgDate: string | null;

  @Column({ type: 'date', nullable: true })
  expiryDate: string | null;

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

  @Column({ type: 'varchar', length: 30, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** set when this is part of a distributor remittance applied to the invoice (paid from Customer Advances) */
  @ManyToOne(() => DistributorRemittance, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'remittanceId' })
  remittance: DistributorRemittance | null;

  @Column({ type: 'uuid', nullable: true })
  remittanceId: string | null;
}

/**
 * Money an international distributor sent (IRC-001): it lands in Customer Advances and is applied to its invoices,
 * now or later. What is not applied stays as the distributor's credit, so a receivable never goes negative.
 * Bank fees deducted on the way are a bank-charge expense.
 */
@Entity('distributor_remittances')
export class DistributorRemittance extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Distributor, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  distributorId: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  /** what the distributor paid, in the currency */
  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  /** bank fees deducted before the money reached us, in the currency */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  fees: number;

  /** PKR per 1 unit on the day the money arrived */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numeric })
  fxRate: number;

  /** bank transfer, SWIFT, documentary collection, LC (Settings list REMITTANCE_METHOD) */
  @Column({ type: 'varchar', length: 60 })
  method: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  bankRef: string | null;

  /** the distributor's bank account it came from (bank · account), which must be verified */
  @Column({ type: 'varchar', length: 200, nullable: true })
  fromBank: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 120 })
  by: string;
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

/**
 * A damage, shortage, quality or return claim on an export shipment (CLM-001). Approved with a credit note, the
 * credit lowers the invoice's balance; any part beyond the balance is owed back to the distributor (never a
 * negative receivable). A replacement is recorded without money.
 */
@Entity('export_claims')
export class ExportClaim extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => ExportShipment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shipmentId' })
  shipment: ExportShipment;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;

  /** Damage, Shortage, Quality, Return */
  @Column({ type: 'varchar', length: 10 })
  kind: string;

  /** bundles affected */
  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  batchRef: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: PartnerFile[];

  /** who raised it: staff or the distributor's portal login */
  @Column({ type: 'varchar', length: 120 })
  raisedBy: string;

  @Column({ type: 'varchar', length: 12, default: 'Submitted' })
  status: 'Submitted' | 'Approved' | 'Rejected';

  @Column({ type: 'text', nullable: true })
  inspection: string | null;

  /** Credit note or Replacement */
  @Column({ type: 'varchar', length: 12, nullable: true })
  resolution: 'Credit note' | 'Replacement' | null;

  /** the credit, in the invoice currency */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  creditAmount: number;

  /** the part of the credit that lowered the invoice balance; the rest is owed back */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  creditApplied: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  creditNoteRef: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;
}

/**
 * May a product be sold in a market (spec section 6)? The compliance reviewer checks the destination's importer and
 * product rules: label version and languages, allergens, product registration, certificates, minimum shelf life and
 * restricted ingredients. An order for a distributor ships only with an approved, unexpired one for its country.
 */
@Entity('product_market_approvals')
export class ProductMarketApproval extends AppEntity {
  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'varchar', length: 80 })
  country: string;

  @Column({ type: 'varchar', length: 10, default: 'Pending' })
  status: 'Pending' | 'Approved' | 'Rejected';

  @Column({ type: 'varchar', length: 40, nullable: true })
  labelVersion: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  labelLanguages: string | null;

  @Column({ type: 'jsonb', nullable: true })
  labelFile: PartnerFile | null;

  @Column({ type: 'text', nullable: true })
  allergens: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  registrationAuthority: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  registrationNo: string | null;

  @Column({ type: 'date', nullable: true })
  registrationExpiry: string | null;

  /** Halal, health, laboratory ... (Settings list CERT_TYPE) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  certificates: { type: string; file: PartnerFile; expiry?: string | null }[];

  /** days of shelf life the goods must still have when they ship */
  @Column({ type: 'int', default: 0 })
  minShelfLifeDays: number;

  @Column({ type: 'text', nullable: true })
  restrictions: string | null;

  @Column({ type: 'varchar', length: 120 })
  createdBy: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;
}

/**
 * An international distributor's "we have paid" with its proof (spec section 7). Finance checks the bank and records
 * the remittance from it, or rejects it with a reason.
 */
@Entity('remittance_advices')
export class RemittanceAdvice extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'uuid' })
  distributorId: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  bankRef: string | null;

  /** the invoices it is meant for, in words or references */
  @Column({ type: 'varchar', length: 300, nullable: true })
  forInvoices: string | null;

  @Column({ type: 'jsonb', nullable: true })
  proof: PartnerFile | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 120 })
  sentBy: string;

  @Column({ type: 'varchar', length: 10, default: 'Submitted' })
  status: 'Submitted' | 'Recorded' | 'Rejected';

  /** the remittance Finance recorded from it */
  @Column({ type: 'uuid', nullable: true })
  remittanceId: string | null;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;
}
