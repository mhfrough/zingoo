/**
 * Areas a distributor covers, compared for exclusivity. Mirrors the server's rule (catalog.service.ts):
 * a province holds its districts and cities, a district its cities; countries only match themselves.
 */

/** one covered area */
export interface Area {
  level: 'P' | 'D' | 'C' | 'N';
  province: string;
  district: string;
  name: string;
}

/** what a distributor record holds */
export interface AreaHolder {
  provinces?: string[];
  districts?: { name: string; province: string }[];
  cities?: { name: string; province: string; district?: string | null }[];
  countries?: string[];
}

/** every area a distributor really covers: a province or district narrowed by choices inside it counts as those */
export function areasOf(d: AreaHolder): Area[] {
  const lc = (s: unknown) => String(s ?? '').toLowerCase();
  const narrowedProvince = (p: string) => (d.districts ?? []).some((x) => lc(x.province) === lc(p)) || (d.cities ?? []).some((c) => lc(c.province) === lc(p));
  const narrowedDistrict = (x: { name: string; province: string }) => (d.cities ?? []).some((c) => lc(c.province) === lc(x.province) && c.district === x.name);
  return [
    ...(d.provinces ?? []).filter((p) => !narrowedProvince(p)).map((p): Area => ({ level: 'P', province: p, district: '', name: p })),
    ...(d.districts ?? []).filter((x) => !narrowedDistrict(x)).map((x): Area => ({ level: 'D', province: x.province, district: x.name, name: x.name })),
    ...(d.cities ?? []).map((c): Area => ({ level: 'C', province: c.province, district: c.district ?? '', name: c.name })),
    ...(d.countries ?? []).map((c): Area => ({ level: 'N', province: '', district: '', name: c })),
  ];
}

/** does a include b */
export function holds(a: Area, b: Area): boolean {
  if (a.level === 'N' || b.level === 'N') return a.level === b.level && a.name.toLowerCase() === b.name.toLowerCase();
  if (a.province.toLowerCase() !== b.province.toLowerCase()) return false;
  if (a.level === 'P') return true;
  if (a.level === 'D') return b.level !== 'P' && (b.level === 'D' ? a.name === b.name : !!b.district && b.district === a.name);
  return b.level === 'C' && a.name.toLowerCase() === b.name.toLowerCase();
}

/** do two areas overlap (one holds the other) */
export const overlaps = (a: Area, b: Area) => holds(a, b) || holds(b, a);
