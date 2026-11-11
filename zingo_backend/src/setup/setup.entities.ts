import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { numeric } from '../common/numeric.transformer';
import { ACCOUNT_TYPES, CATEGORY_KINDS } from '../common/enums';

/** Company-wide assumptions. Always exactly one row (id = 1). */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 150 })
  companyName: string;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  baseCurrency: string;

  @Column({ type: 'int', default: 7 })
  fiscalMonth: number;

  @Column({ type: 'varchar', length: 20, default: 'en-PK' })
  numberFormat: string;

  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  capitalTarget: number;

  @Column({ type: 'int' })
  packsPerCarton: number;

  /** spend at or above this needs two signatures */
  @Column({ type: 'decimal', precision: 16, scale: 2, transformer: numeric })
  approvalThreshold: number;

  @Column({ type: 'varchar', length: 100 })
  signatoryA: string;

  @Column({ type: 'varchar', length: 100 })
  signatoryB: string;

  @Column({ type: 'int' })
  lowStockCartons: number;

  @Column({ type: 'varchar', length: 10, default: '40HC' })
  containerSize: string;

  @Column({ type: 'varchar', length: 5, default: 'FOB' })
  defaultIncoterm: string;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0, transformer: numeric })
  salesTaxRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, transformer: numeric })
  profitAllocationPerPack: number;

  /** allowed distributor payment terms in days */
  @Column({ type: 'jsonb' })
  paymentCycles: number[];

  @Column({ type: 'int', default: 30 })
  defaultPaymentCycle: number;

  /** reference prefixes: { sales: 'SO', batch: 'B', finance: 'FIN', accounting: 'ACC', export: 'EXP' } */
  @Column({ type: 'jsonb' })
  docPrefixes: Record<string, string>;

  /** upper day limits of the aged-receivable buckets, e.g. [30, 60, 90] = 1-30, 31-60, 61-90, over 90 days */
  @Column({ type: 'jsonb', default: () => "'[30,60,90]'" })
  agingBuckets: number[];
}

@Entity('currencies')
export class Currency {
  @PrimaryColumn({ type: 'varchar', length: 3 })
  code: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 8 })
  symbol: string;

  /** PKR per 1 unit of this currency */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numeric })
  rate: number;
}

/** Chart of accounts. Ledger lines point at `code`. */
@Entity('accounts')
export class Account extends AppEntity {
  @Column({ type: 'varchar', length: 10, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  type: (typeof ACCOUNT_TYPES)[number];

  @Column({ default: true })
  active: boolean;
}

/** Cost centers (with budget), income categories and expense categories. */
@Entity('categories')
@Unique(['kind', 'name'])
export class Category extends AppEntity {
  @Column({ type: 'varchar', length: 12 })
  kind: (typeof CATEGORY_KINDS)[number];

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** PKR allocation, only used by cost centers */
  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0, transformer: numeric })
  budget: number;

  /** cost centers: the type of investment stream, from the STREAM_TYPE list in Settings ('' = not set) */
  @Column({ type: 'varchar', length: 40, default: '' })
  streamType: string;

  /** cost centers of a depreciable type: percent of the value lost per year */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, transformer: numeric })
  depreciationRate: number;
}

@Entity('container_types')
export class ContainerType {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  code: string;

  @Column({ type: 'int' })
  maxCartons: number;
}

/** The editable pick-lists (payment methods, Incoterms ...). The code is stored on documents, so it never changes; the rest can. */
@Entity('lookups')
@Unique(['list', 'code'])
export class Lookup extends AppEntity {
  /** PAY_METHOD, INCOTERM, CAPITAL_SOURCE, STREAM_TYPE or PERSON (a shareholder or partner who can invest) */
  @Column({ type: 'varchar', length: 20 })
  list: string;

  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 250, default: '' })
  description: string;

  /** switches of the list: Incoterm cost lines, capital source { liability }, stream type { depreciable } */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  flags: Record<string, boolean>;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
