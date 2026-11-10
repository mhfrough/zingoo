import { Column, Entity, Generated, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { DocEntity } from '../common/doc.entity';
import { numeric } from '../common/numeric.transformer';
import { Account } from '../setup/setup.entities';

/**
 * The journal: one row per debit or credit line. Every document that moves money writes its lines here
 * (and rewrites them when it changes), so total debit always equals total credit.
 */
@Entity('ledger_entries')
@Index(['refType', 'refId'])
@Index(['accountCode', 'entryDate'])
export class LedgerEntry extends AppEntity {
  /** keeps lines in the order they were posted */
  @Column({ type: 'int' })
  @Generated('increment')
  seq: number;

  @Column({ type: 'date' })
  entryDate: string;

  @Column({ type: 'varchar', length: 30 })
  source: string;

  /** the document's refNo, e.g. SO-201 */
  @Column({ type: 'varchar', length: 40 })
  reference: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accountCode', referencedColumnName: 'code' })
  account: Account;

  @Column({ type: 'varchar', length: 10 })
  accountCode: string;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  debit: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  credit: number;

  /** which kind of document wrote the line, and its id (used to replace the lines) */
  @Column({ type: 'varchar', length: 20 })
  refType: string;

  @Column({ type: 'uuid' })
  refId: string;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numeric })
  fxRate: number | null;
}

export interface VoucherLine {
  account: string;
  debit: number;
  credit: number;
}

/** A manual multi-line journal voucher (reversed by posting a second, opposite voucher). */
@Entity('journal_vouchers')
export class JournalVoucher extends DocEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 250 })
  memo: string;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, default: 1, transformer: numeric })
  fxRate: number;

  @Column({ type: 'varchar', length: 40, default: 'Posted' })
  status: string;

  /** refNo of the voucher this one reverses */
  @Column({ type: 'varchar', length: 30, nullable: true })
  reverses: string | null;

  @Column({ type: 'jsonb' })
  lines: VoucherLine[];
}
