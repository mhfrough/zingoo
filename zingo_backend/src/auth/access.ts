import { ROLES, Role } from '../common/enums';

/**
 * Who may see which page and who may change what.
 * Copied from the client prototype (rolePages / writeGroups).
 */
export const ROLE_PAGES: Record<Role, string[]> = {
  Admin: ['overview', 'manufacturing', 'finance', 'accounting', 'distribution', 'pricing', 'exports', 'ledger', 'users', 'settings', 'portal'],
  Manufacturing: ['overview', 'manufacturing', 'pricing'],
  Finance: ['overview', 'finance', 'accounting', 'ledger', 'pricing', 'exports', 'settings', 'portal'],
  Distribution: ['overview', 'distribution', 'pricing', 'portal'],
  Exports: ['overview', 'exports', 'pricing', 'distribution'],
  Viewer: ['overview', 'manufacturing', 'finance', 'accounting', 'distribution', 'pricing', 'exports', 'ledger', 'users', 'settings'],
  /** an investor or business owner: sees the business and where the money went, changes nothing */
  Investor: ['overview', 'finance'],
  Distributor: ['portal'],
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

/** Every internal (non-distributor) role. */
export const STAFF: Role[] = ROLES.filter((r) => r !== 'Distributor');
