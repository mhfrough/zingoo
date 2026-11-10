import { Column } from 'typeorm';
import { AppEntity } from './app.entity';

/** Every business document has a human reference (B-1001, SO-201, FIN-001 ...). */
export abstract class DocEntity extends AppEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  refNo: string;
}
