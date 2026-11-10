import { SetMetadata } from '@nestjs/common';
import { Role } from '../common/enums';
import { WRITE_ROLES, WriteGroup, readRoles } from './access';

export const ROLES_KEY = 'roles';

/** Only these roles may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Roles that can open any of these pages may read this route. */
export const Read = (...pages: string[]) => Roles(...readRoles(...pages));

/** Roles allowed to change data in this group. */
export const Write = (group: WriteGroup) => Roles(...WRITE_ROLES[group]);
