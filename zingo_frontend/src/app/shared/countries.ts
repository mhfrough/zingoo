import { SelectOption } from '../ui';

/** ISO 3166-1 alpha-2 codes of the world's countries and territories (reference data, not a business list). */
const CODES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ ' +
  'NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ ' +
  'TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS XK YE ZA ZM ZW'
).split(' ');

let cached: SelectOption<string>[] | null = null;

/** every country by its English name (Pakistan left out: local areas are chosen separately), sorted */
export function countryOptions(): SelectOption<string>[] {
  if (cached) return cached;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  cached = CODES.map((c) => names.of(c) ?? c)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ value: n, label: n }));
  return cached;
}
