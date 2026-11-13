import { Product } from '../ops/models';

/** rounds to paisa so tables and the ledger never disagree by a fraction */
const rnd = (v: number) => Math.round(v * 100) / 100;

/** Per-pack cost build-up and margins for one SKU, all in PKR. */
export interface UnitEconomics {
  factory: number;
  packaging: number;
  printing: number;
  inbound: number;
  /** packaging + printing + inbound freight (billed separately from the factory rate) */
  addOns: number;
  /** factory + add-ons: what a pack costs landed in the warehouse */
  variable: number;
  /** landed cost + the overhead share */
  total: number;
  overhead: number;
  /** what the distributor pays per pack */
  distributor: number;
  /** distributor price - landed cost */
  gross: number;
  /** distributor price - landed cost - overhead */
  net: number;
  grossPct: number;
  netPct: number;
  /** retail MRP - distributor price: what the shop and the distributor share */
  retailSpread: number;
}

/**
 * The price bridge of one SKU:
 *   landed cost = factory + packaging + printing + inbound freight + outbound freight
 *   gross       = distributor price - landed cost
 *   net         = gross - overhead per pack
 * It is a planning model; dispatched orders freeze their own cost, and company profit is on the income statement.
 */
export function unitEconomics(
  p: Pick<Product, 'manufacturerRate' | 'packagingRate' | 'printingRate' | 'inboundRate' | 'rate' | 'mrp'> & { outboundRate?: number },
  overhead: number,
): UnitEconomics {
  const factory = Number(p.manufacturerRate) || 0;
  const packaging = Number(p.packagingRate) || 0;
  const printing = Number(p.printingRate) || 0;
  const inbound = Number(p.inboundRate) || 0;
  const outbound = Number(p.outboundRate) || 0;
  const distributor = Number(p.rate) || 0;
  const oh = Number(overhead) || 0;
  const addOns = rnd(packaging + printing + inbound + outbound);
  const variable = rnd(factory + addOns);
  const total = rnd(variable + oh);
  const gross = rnd(distributor - variable);
  const net = rnd(distributor - total);
  return {
    factory, packaging, printing, inbound, addOns, variable, total, overhead: oh, distributor, gross, net,
    grossPct: distributor ? (100 * gross) / distributor : 0,
    netPct: distributor ? (100 * net) / distributor : 0,
    retailSpread: rnd((Number(p.mrp) || 0) - distributor),
  };
}
