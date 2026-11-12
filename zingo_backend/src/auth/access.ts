import { ROLES, Role } from '../common/enums';

/**
 * Who may see which page and who may change what.
 * Copied from the client prototype (rolePages / writeGroups).
 */
export const ROLE_PAGES: Record<Role, string[]> = {
  Admin: ['overview', 'manufacturing', 'finance', 'accounting', 'distribution', 'pricing', 'exports', 'ledger', 'users', 'settings', 'portal', 'factory'],
  Manufacturing: ['overview', 'manufacturing', 'pricing', 'factory'],
  Finance: ['overview', 'finance', 'accounting', 'ledger', 'pricing', 'exports', 'settings', 'portal'],
  Distribution: ['overview', 'distribution', 'pricing', 'portal'],
  Exports: ['overview', 'exports', 'pricing', 'distribution'],
  Viewer: ['overview', 'manufacturing', 'finance', 'accounting', 'distribution', 'pricing', 'exports', 'ledger', 'users', 'settings', 'factory'],
  /** an investor or business owner: sees the business and where the money went, changes nothing */
  Investor: ['overview', 'finance'],
  Distributor: ['portal'],
  /** a manufacturer's own login: its production orders only (the factory portal) */
  Manufacturer: ['factory'],
};

export type WriteGroup = 'manufacturing' | 'distribution' | 'finance' | 'exports' | 'admin';

export const WRITE_ROLES: Record<WriteGroup, Role[]> = {
  manufacturing: ['Admin', 'Manufacturing'],
  distribution: ['Admin', 'Distribution', 'Exports'],
  finance: ['Admin', 'Finance'],
  exports: ['Admin', 'Finance', 'Exports'],
  admin: ['Admin'],
};

/** Roles that can open at least one of these pages. */
export const readRoles = (...pages: string[]): Role[] =>
  ROLES.filter((r) => pages.some((p) => ROLE_PAGES[r].includes(p)));

/** Logins of partner companies: they only see their own records, never staff data. */
export const PARTNER_ROLES: Role[] = ['Distributor', 'Manufacturer'];

/** Every internal role (not a distributor or manufacturer login). */
export const STAFF: Role[] = ROLES.filter((r) => !PARTNER_ROLES.includes(r));
