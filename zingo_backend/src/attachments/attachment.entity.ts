import { Column, Entity, Index } from 'typeorm';
import { AppEntity } from '../common/app.entity';

/**
 * A file kept in the database: a payment proof, an investor agreement, a cargo photo.
 * Files are small (5 MB at most) and few, so the database is the simplest safe place: they back up
 * with the data and nothing extra has to be run. Move to object storage if the volume ever grows.
 */
@Entity('attachments')
@Index(['ownerType', 'ownerId'])
export class Attachment extends AppEntity {
  /** the name the file had when it was chosen (cleaned) */
  @Column({ type: 'varchar', length: 250 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  mime: string;

  @Column({ type: 'int' })
  size: number;

  /** the file itself */
  @Column({ type: 'bytea', select: false })
  data: Buffer;

  /** what the file belongs to, e.g. CAPITAL / an entry id; empty until a form attaches it */
  @Column({ type: 'varchar', length: 30, nullable: true })
  ownerType: string | null;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  /** who uploaded it */
  @Column({ type: 'varchar', length: 120 })
  uploadedBy: string;
}
