import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { Role, Seat } from '../common/enums';
import { Distributor } from '../catalog/catalog.entities';

/** Someone who can log in. `seat` says which approval signature they can give. */
@Entity('users')
export class User extends AppEntity {
  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  /** bcrypt hash */
  @Column({ type: 'varchar', length: 100 })
  password: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'Viewer' })
  role: Role;

  @Column({ type: 'varchar', length: 10, default: 'None' })
  seat: Seat;

  @Column({ type: 'varchar', length: 10, default: 'Active' })
  status: 'Active' | 'Disabled';

  /** the root account (ROOT_EMAIL in .env): highest role, cannot be disabled or demoted from the users screen */
  @Column({ default: false })
  isRoot: boolean;

  /** only for role Distributor: which distributor this login belongs to */
  @ManyToOne(() => Distributor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor | null;

  @Column({ type: 'uuid', nullable: true })
  distributorId: string | null;
}
