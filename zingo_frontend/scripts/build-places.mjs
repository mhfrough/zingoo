/**
 * Builds `public/data/pk-places.json` (provinces and cities of Pakistan) from the GeoNames dump.
 *
 * Usage:
 *   1. Download and unzip into one folder:
 *        https://download.geonames.org/export/dump/PK.zip              (gives PK.txt)
 *        https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   2. npm run data:places -- <that folder>
 *
 * Rule: a populated place (feature class P) with 5,000 or more people, plus every district and provincial seat.
 * Sections of cities, abandoned or destroyed places and farm villages are left out.
 * Data licence: Creative Commons Attribution 4.0 (GeoNames). Keep the `attribution` field in the output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npm run data:places -- <folder with PK.txt and admin1CodesASCII.txt>');
  process.exit(1);
}

/** feature codes kept: plain places, provincial / district seats, the capital and "locality" places */
const KEEP = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLC', 'PPLL']);
/** administrative seats are kept whatever their population */
const SEAT = new Set(['PPLA', 'PPLA2', 'PPLC']);
const MIN_POPULATION = 5000;
/** GeoNames calls code 08 just "Islamabad"; the official name is clearer in a dropdown */
const RENAME = { '08': 'Islamabad Capital Territory' };
const PROVINCE_ORDER = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Kashmir'];

/** admin1 code -> province name */
const provinces = {};
for (const line of fs.readFileSync(path.join(folder, 'admin1CodesASCII.txt'), 'utf8').split('\n')) {
  const [code, name] = line.split('\t');
  if (code?.startsWith('PK.')) provinces[code.slice(3)] = RENAME[code.slice(3)] ?? name;
}

const seen = new Set();
const cities = fs
  .readFileSync(path.join(folder, 'PK.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
  // columns: 1 name, 4 lat, 5 lon, 6 feature class, 7 feature code, 10 admin1 code, 14 population
  .filter((c) => c[6] === 'P' && KEEP.has(c[7]) && (Number(c[14]) >= MIN_POPULATION || SEAT.has(c[7])) && provinces[c[10]])
  .map((c) => ({
    name: c[1],
    province: provinces[c[10]],
    population: Number(c[14]) || 0,
    lat: Number(c[4]),
    lon: Number(c[5]),
    seat: SEAT.has(c[7]),
  }))
  .filter((c) => {
    const key = `${c.name}|${c.province}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));

const output = {
  source: 'GeoNames (PK.zip and admin1CodesASCII.txt)',
  url: 'https://download.geonames.org/export/dump/',
  license: 'CC BY 4.0',
  attribution: 'Place names from GeoNames, https://www.geonames.org, licensed under Creative Commons Attribution 4.0.',
  generated: new Date().toISOString().slice(0, 10),
  rule: `Populated places with ${MIN_POPULATION.toLocaleString('en')} or more people, plus every district / provincial seat. Sorted by population.`,
  provinces: PROVINCE_ORDER.map((name) => ({ name, cities: cities.filter((c) => c.province === name).length })),
  cities,
};

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'pk-places.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(output));
console.log(`Wrote ${cities.length} cities to ${target}`);
