import { Column, Entity } from 'typeorm';
import { AppEntity } from '../common/app.entity';

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

  @Column({ default: false })
  primary: boolean;

  @Column({ default: true })
  active: boolean;
}
