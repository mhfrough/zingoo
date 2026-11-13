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

export const OWN_STATE_KEY = 'ownState';

/** The call only changes the caller's own state (marking notices read): open on hold and to every portal role. */
export const OwnState = () => SetMetadata(OWN_STATE_KEY, true);

export const PORTAL_PERMIT_KEY = 'portalPermit';

/** what a distributor login may do in the portal, by its portal role (spec section 7) */
export const PORTAL_PERMITS = {
  /** place requests and orders, report sales */
  orders: ['Owner', 'Sales'],
  /** confirm what arrived */
  receipts: ['Owner', 'Warehouse'],
  /** send payment advices and remittance proof */
  payments: ['Owner', 'Finance'],
  /** raise claims and returns */
  claims: ['Owner', 'Sales', 'Warehouse'],
  /** upload a file (photos for a claim, proof of payment) */
  uploads: ['Owner', 'Sales', 'Finance', 'Warehouse'],
} as const;
export type PortalPermit = keyof typeof PORTAL_PERMITS;

/** A distributor login needs this portal permission for the route (changes only; reading follows its own rules). */
export const Permit = (permit: PortalPermit) => SetMetadata(PORTAL_PERMIT_KEY, permit);
