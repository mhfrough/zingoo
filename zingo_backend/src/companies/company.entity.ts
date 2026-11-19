import { Column, Entity } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';

/**
 * A company of the group (Zen Foods and its sister companies). One is the primary company: its name is the
 * company name on Settings and on documents.
 */
@Entity('companies')
export class Company extends AppEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  legalName: string;

  /** tax number (NTN) */
  @Column({ type: 'varchar', length: 40, default: '' })
  taxNo: string;

  @Column({ type: 'varchar', length: 250, default: '' })
  address: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  phone: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  email: string;

  /** point of contact */
  @Column({ type: 'varchar', length: 150, default: '' })
  poc: string;

  /** month the financial year starts (1 = January) */
  @Column({ type: 'int', default: 7 })
  fiscalMonth: number;

  /** Local (Pakistan) or International */
  @Column({ type: 'varchar', length: 20, default: 'Local' })
  market: string;

  /** international: the world region (Middle East, Europe ...); local: empty */
  @Column({ type: 'varchar', length: 60, default: '' })
  region: string;

  /** international: the country; local: Pakistan */
  @Column({ type: 'varchar', length: 80, default: 'Pakistan' })
  country: string;

  /** the state or province */
  @Column({ type: 'varchar', length: 80, default: '' })
  state: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  city: string;

  /** the currency the company trades in (Settings currencies), PKR by default */
  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  /** optional money and approvals of this company: spending at or above this needs both signatories (null = not set) */
  @Column({ type: 'decimal', precision: 16, scale: 2, nullable: true, transformer: numeric })
  approvalThreshold: number | null;

  @Column({ type: 'varchar', length: 120, default: '' })
  signatoryA: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  signatoryB: string;

  /** what this company plans to raise (null = not set) */
  @Column({ type: 'decimal', precision: 16, scale: 2, nullable: true, transformer: numeric })
  capitalTarget: number | null;

  @Column({ default: false })
  primary: boolean;

  @Column({ default: true })
  active: boolean;
}
