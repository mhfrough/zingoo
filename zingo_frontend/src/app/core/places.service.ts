import { Injectable, computed, signal } from '@angular/core';
import { SelectOption } from '../ui';

/** one city of public/data/pk-places.json */
interface Place {
  name: string;
  province: string;
  district: string | null;
}

/** one district of public/data/pk-places.json */
interface District {
  name: string;
  province: string;
}

/** a district or city option value: "Province|Name" (names repeat across provinces) */
export const placeKey = (province: string, name: string) => `${province}|${name}`;
/** the parts of a placeKey */
export const splitKey = (key: string) => {
  const i = key.indexOf('|');
  return { province: key.slice(0, i), name: key.slice(i + 1) };
};

/**
 * Pakistan provinces, districts and cities for the searchable selects (GeoNames data in public/data/pk-places.json).
 * The file is fetched once, the first time a form asks for it; a failed fetch leaves the lists empty.
 * Districts and cities narrow down: the districts of the chosen provinces, the cities of the chosen districts.
 */
@Injectable({ providedIn: 'root' })
export class PlacesService {
  private places = signal<Place[]>([]);
  private districtList = signal<District[]>([]);
  private provinceNames = signal<string[]>([]);
  private started = false;

  /** every province, biggest first */
  readonly provinces = computed<SelectOption<string>[]>(() => this.provinceNames().map((p) => ({ value: p, label: p })));

  /** loads the file (once) */
  load() {
    if (this.started) return;
    this.started = true;
    fetch('data/pk-places.json')
      .then((r) => r.json())
      .then((j: { provinces: { name: string }[]; districts?: District[]; cities: Place[] }) => {
        this.provinceNames.set(j.provinces.map((p) => p.name));
        this.districtList.set(j.districts ?? []);
        this.places.set(j.cities.map((c) => ({ name: c.name, province: c.province, district: c.district ?? null })));
      })
      .catch(() => {
        this.started = false;
      });
  }

  /** the cities of one province (all cities when none is given), with the province as the second line */
  cities(province?: string | null): SelectOption<string>[] {
    return this.places()
      .filter((c) => !province || c.province === province)
      .map((c) => ({ value: c.name, label: c.name, sub: c.province }));
  }

  /** the districts of the given provinces (all when none), valued "Province|District" */
  districtsIn(provinces: string[]): SelectOption<string>[] {
    const set = new Set(provinces);
    return this.districtList()
      .filter((d) => !set.size || set.has(d.province))
      .map((d) => ({ value: placeKey(d.province, d.name), label: d.name, sub: d.province }));
  }

  /** the cities of the given districts, else of the given provinces, else all; valued "Province|City" */
  citiesIn(provinces: string[], districtKeys: string[]): SelectOption<string>[] {
    const ps = new Set(provinces);
    const ds = new Set(districtKeys);
    return this.places()
      .filter((c) => (ds.size ? !!c.district && ds.has(placeKey(c.province, c.district)) : !ps.size || ps.has(c.province)))
      .map((c) => ({ value: placeKey(c.province, c.name), label: c.name, sub: [c.district, c.province].filter(Boolean).join(', ') }));
  }

  /** the district of a city, if known */
  districtOf(province: string, city: string): string | null {
    return this.places().find((c) => c.province === province && c.name === city)?.district ?? null;
  }

  /** the province a city belongs to, if the city is known */
  provinceOf(city: string): string | null {
    return this.places().find((c) => c.name === city)?.province ?? null;
  }
}
