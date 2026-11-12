/**
 * Who may change what. Mirrors zingo_backend/src/auth/access.ts (the server enforces it;
 * this only hides buttons that would be refused).
 */
export type Role = 'Admin' | 'Manufacturing' | 'Finance' | 'Distribution' | 'Exports' | 'Viewer' | 'Investor' | 'Distributor' | 'Manufacturer';
export type WriteGroup = 'manufacturing' | 'distribution' | 'finance' | 'exports' | 'admin';

export const WRITE_ROLES: Record<WriteGroup, Role[]> = {
  manufacturing: ['Admin', 'Manufacturing'],
  distribution: ['Admin', 'Distribution', 'Exports'],
  finance: ['Admin', 'Finance'],
  exports: ['Admin', 'Finance', 'Exports'],
  admin: ['Admin'],
};

export const canWrite = (role: string | undefined, group: WriteGroup): boolean =>
  !!role && (WRITE_ROLES[group] as string[]).includes(role);
