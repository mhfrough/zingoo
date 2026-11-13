import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppEntity } from '../common/app.entity';
import { PortalRole, Role, Seat } from '../common/enums';
import { Distributor, Manufacturer } from '../catalog/catalog.entities';

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

  /** a distributor login's role in the portal (spec section 7): Owner, Sales, Finance, Warehouse, Read-only */
  @Column({ type: 'varchar', length: 12, default: 'Owner' })
  portalRole: PortalRole;

  /** only for role Manufacturer: which manufacturer this login belongs to */
  @ManyToOne(() => Manufacturer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manufacturerId' })
  manufacturer: Manufacturer | null;

  @Column({ type: 'uuid', nullable: true })
  manufacturerId: string | null;
}
