import { Column, Entity, Index } from 'typeorm';
import { AppEntity } from '../common/app.entity';

export const NOTE_TONES = ['info', 'success', 'warning', 'danger'] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

/**
 * One in-app notification for one audience: a group of staff roles, one distributor's logins or one manufacturer's
 * logins. Who has read it is kept on the row (user ids), so each login has its own unread state.
 */
@Entity('notifications')
@Index(['audience', 'targetId'])
export class Notification extends AppEntity {
  /** staff = the company roles in `roles`; distributor / manufacturer = every login of `targetId` */
  @Column({ type: 'varchar', length: 12 })
  audience: 'staff' | 'distributor' | 'manufacturer';

  /** the distributor or manufacturer id (empty for staff) */
  @Column({ type: 'uuid', nullable: true })
  targetId: string | null;

  /** staff roles that see it (Admin always does) */
  @Column({ type: 'text', array: true, nullable: true })
  roles: string[] | null;

  /** what happened, e.g. request.filed, claim.decided, shipment.dispatched */
  @Column({ type: 'varchar', length: 40 })
  kind: string;

  @Column({ type: 'varchar', length: 8, default: 'info' })
  tone: NoteTone;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** where the bell takes the reader (an app path with ?tab=) */
  @Column({ type: 'varchar', length: 200, nullable: true })
  link: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  refNo: string | null;

  /** who did it: never told about their own action */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actorName: string | null;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  readBy: string[];
}
