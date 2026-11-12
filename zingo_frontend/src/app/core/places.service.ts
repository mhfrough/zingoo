import { Injectable, computed, signal } from '@angular/core';
import { SelectOption } from '../ui';

/** one place of public/data/pk-places.json */
interface Place {
  name: string;
  province: string;
}

/**
 * Pakistan provinces and cities for the searchable selects (GeoNames data in public/data/pk-places.json).
 * The file is fetched once, the first time a form asks for it; a failed fetch leaves the lists empty
 * and the forms fall back to typing.
 */
@Injectable({ providedIn: 'root' })
export class PlacesService {
  private places = signal<Place[]>([]);
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
      .then((j: { provinces: { name: string }[]; cities: Place[] }) => {
        this.provinceNames.set(j.provinces.map((p) => p.name));
        this.places.set(j.cities.map((c) => ({ name: c.name, province: c.province })));
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

  /** the province a city belongs to, if the city is known */
  provinceOf(city: string): string | null {
    return this.places().find((c) => c.name === city)?.province ?? null;
  }
}
