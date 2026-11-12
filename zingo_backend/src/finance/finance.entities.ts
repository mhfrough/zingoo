import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';
import { Seat } from '../common/enums';

/** Capital, spend and other receipts. Spend needs 1 or 2 signatures before it counts. */
@Entity('finance_entries')
export class FinanceEntry extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 20 })
  type: 'Capital Injection' | 'Operating Expense' | 'Asset Purchase' | 'Other Receipt';

  /** cost center / investment stream */
  @Column({ type: 'varchar', length: 80 })
  category: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 150, default: '' })
  party: string;

  /** capital only: which kind of account the investor is (Manufacturer, Distributor or Person); empty on older entries */
  @Column({ type: 'varchar', length: 12, default: '' })
  partyType: InvestorType | '';

  /** capital only: the investor's account (a manufacturer, a distributor or a person of the People list) */
  @Column({ type: 'uuid', nullable: true })
  partyId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** only for capital: a capital source from Settings (Equity, Shareholder Loan, Partner Advance ...) */
  @Column({ type: 'varchar', length: 40, default: '' })
  funding: string;

  // ── capital injection details (empty for other types) ──

  /** set when several investors put money in together: every investor line shares it */
  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  /** how the money was paid: a payment method from Settings (Bank Transfer, Cash, Cheque ...) */
  @Column({ type: 'varchar', length: 30, default: '' })
  paymentSource: string;

  /** transfer id, receipt number, slip number */
  @Column({ type: 'varchar', length: 100, default: '' })
  paymentReference: string;

  /** what the payment is for: an agreement or invoice number */
  @Column({ type: 'varchar', length: 150, default: '' })
  paymentAgainst: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  paidBy: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  receivedBy: string;

  /** the day the payment was issued */
  @Column({ type: 'date', nullable: true })
  issueDate: string | null;

  /** when the investor expects the money back (a reminder only, nothing posts) */
  @Column({ type: 'date', nullable: true })
  expectedReturnDate: string | null;

  @Column({ type: 'varchar', length: 40, default: '' })
  chequeNo: string;

  /** the day the cheque clears; once cleared, the day it really cleared */
  @Column({ type: 'date', nullable: true })
  clearanceDate: string | null;

  /** '' for non-cheque payments. A cheque is not cash until it is Cleared. */
  @Column({ type: 'varchar', length: 10, default: '' })
  chequeStatus: ChequeStatus;

  /** uploaded payment proof and agreement (attachments) */
  @Column({ type: 'uuid', nullable: true })
  proofId: string | null;

  @Column({ type: 'uuid', nullable: true })
  agreementId: string | null;

  // ── loan and advance terms (empty for equity), copied onto every investor of one injection ──

  /** 'in': the company receives the money. 'out': the company pays an advance to a partner (money it will get back). */
  @Column({ type: 'varchar', length: 3, default: 'in' })
  direction: 'in' | 'out';

  /** from Settings: Short-term, Long-term, On demand */
  @Column({ type: 'varchar', length: 50, default: '' })
  tenure: string;

  /** from Settings: Lump sum, Installments, On demand */
  @Column({ type: 'varchar', length: 50, default: '' })
  repaymentPlan: string;

  /** from Settings: Monthly, Quarterly ... (for installments) */
  @Column({ type: 'varchar', length: 50, default: '' })
  repaymentFrequency: string;

  /** yearly markup (interest) in percent; 0 = interest-free. Informational: markup is booked when it is paid. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  markupPct: number;

  /** advance only, from Settings */
  @Column({ type: 'varchar', length: 60, default: '' })
  purpose: string;

  /** advance only, from Settings: how it is expected to be settled */
  @Column({ type: 'varchar', length: 60, default: '' })
  settlementMethod: string;

  /** advance only: invoice, PO or activity the advance is linked to */
  @Column({ type: 'varchar', length: 100, default: '' })
  linkedReference: string;

  /** which of the company's bank or cash accounts took (or paid) the money: from Settings, a label only */
  @Column({ type: 'varchar', length: 60, default: '' })
  bankAccount: string;

  /** spend only: the capital entry (a loan, an advance or equity) whose stream allocation this spend uses up */
  @Column({ type: 'uuid', nullable: true })
  fundedById: string | null;
}

/** A repayment of a loan or advance (or the markup paid on it): cash out against the investor's liability account. */
@Entity('funding_repayments')
@Index(['entryId'])
export class FundingRepayment extends DocEntity {
  @ManyToOne(() => FinanceEntry, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entryId' })
  entry: FinanceEntry;

  @Column({ type: 'uuid' })
  entryId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  /** principal reduces what is owed; markup is the cost of the loan and is not part of the balance */
  @Column({ type: 'varchar', length: 10, default: 'principal' })
  kind: 'principal' | 'markup';

  /** a payment method from Settings */
  @Column({ type: 'varchar', length: 30, default: '' })
  method: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  reference: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  proofId: string | null;
}

export type ChequeStatus = '' | 'Pending' | 'Cleared' | 'Bounced';

/** The kinds of account that can put money in: a contract manufacturer, a distributor, or a person (shareholder, partner). */
export const INVESTOR_TYPES = ['Manufacturer', 'Distributor', 'Person'] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

/** The part of a capital injection line invested against one stream (cost center). */
@Entity('finance_entry_streams')
@Index(['entryId'])
export class FinanceEntryStream extends AppEntity {
  @ManyToOne(() => FinanceEntry, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entryId' })
  entry: FinanceEntry;

  @Column({ type: 'uuid' })
  entryId: string;

  @Column({ type: 'varchar', length: 80 })
  stream: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  /** share of the investor's amount, 0 to 100 */
  @Column({ type: 'decimal', precision: 7, scale: 3, transformer: numeric })
  pct: number;
}

/** An income invoice or an expense bill outside the factory/distributor flow. */
@Entity('accounting_documents')
export class AccountingDocument extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 10 })
  kind: 'Income' | 'Expense';

  @Column({ type: 'varchar', length: 80 })
  category: string;

  /** amount in PKR (= foreignAmount x fxRate) */
  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, transformer: numeric })
  foreignAmount: number | null;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  /** PKR per 1 unit of `currency`, frozen when the document is created */
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 1, transformer: numeric })
  fxRate: number;

  @Column({ type: 'varchar', length: 150 })
  party: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Draft: saved, not posted, not owed yet. Issued: posted to the ledger. */
  @Column({ type: 'varchar', length: 10, default: 'Issued' })
  status: 'Draft' | 'Issued';

  // ───── income invoice details (the 4-step income form) ─────
  /** the number printed on the invoice (the refNo is the internal one) */
  @Column({ type: 'varchar', length: 60, default: '' })
  invoiceNo: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  customerTaxId: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  region: string;

  /** payment terms in days (Settings payment cycles); the due date follows from it */
  @Column({ type: 'int', nullable: true })
  paymentDays: number | null;

  /** the bank or cash account the money comes into (Settings) */
  @Column({ type: 'varchar', length: 60, default: '' })
  receivingAccount: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  orderRef: string;

  /** dispatch / acceptance status (Settings list) */
  @Column({ type: 'varchar', length: 60, default: '' })
  deliveryStatus: string;

  /** GRN, delivery challan or proof of delivery number */
  @Column({ type: 'varchar', length: 120, default: '' })
  deliveryProof: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  salesOwner: string;

  /** SKU lines: quantity in packs, dozens or cartons; sell price per pack in the invoice currency; cost per pack in PKR */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines: InvoiceLine[];

  /** invoice discount, in the invoice currency */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  discount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  salesTaxPct: number;

  /** expected withholding tax %: information only */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  whtPct: number;

  /** sales tax in PKR (part of amount, posted to Sales Tax Payable) */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  taxAmount: number;

  /** costs the seller carries, in PKR: freight, insurance, customs, packaging, other (profit estimate only) */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  sellerCosts: Record<string, number>;

  /** cost of the goods on the lines, PKR (profit estimate only) */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0, transformer: numeric })
  costOfGoods: number;
}

/** One SKU line of an income invoice. */
export interface InvoiceLine {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  uom: 'Packs' | 'Dozens' | 'Cartons';
  /** quantity in packs */
  packs: number;
  /** per pack, invoice currency */
  sellPrice: number;
  /** per pack, PKR */
  unitCost: number;
  /** packs x sell price, invoice currency */
  lineSales: number;
}

/** A (part) payment or receipt against an accounting document. */
@Entity('accounting_settlements')
export class AccountingSettlement extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => AccountingDocument, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'documentId' })
  document: AccountingDocument;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: numeric })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'Bank Transfer' })
  method: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}

/** One signature (seat A or B) on a finance entry or accounting document. */
@Entity('approvals')
@Unique(['docType', 'docId', 'seat'])
export class Approval extends AppEntity {
  @Column({ type: 'varchar', length: 12 })
  docType: 'FINANCE' | 'ACCOUNTING';

  @Column({ type: 'uuid' })
  docId: string;

  @Column({ type: 'varchar', length: 1 })
  seat: Exclude<Seat, 'None' | 'Both'>;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;
}
