import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
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

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** only for capital: Equity or Partner Loan */
  @Column({ type: 'varchar', length: 15, default: '' })
  funding: 'Equity' | 'Partner Loan' | '';
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
