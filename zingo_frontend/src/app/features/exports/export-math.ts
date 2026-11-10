import { Incoterm, ShipmentCosts } from './models';

/** The fields of a quote the costing needs. */
export interface QuoteInputs {
  cartons: number;
  rate: number;
  fxRate: number;
  incoterm: Incoterm;
  inland: number;
  origin: number;
  documentation: number;
  ocean: number;
  insurance: number;
  destination: number;
  duty: number;
  bankFees: number;
  otherCosts: number;
}

const n = (v: unknown) => Number(v) || 0;
const rnd = (v: number) => Math.round(v * 100) / 100;

/**
 * What the seller pays under the Incoterm, in the invoice currency (the same rule as the server uses when it ships):
 * EXW nothing at origin, FOB origin costs, CFR + ocean freight, CIF + insurance, DAP + destination charges, DDP + import duty.
 * Bank fees and other costs are always the seller's.
 */
export function sellerCosts(x: QuoteInputs): ShipmentCosts {
  const origin = n(x.inland) + n(x.origin) + n(x.documentation);
  const ocean = n(x.ocean);
  const insurance = n(x.insurance);
  const destination = n(x.destination) + n(x.duty);
  const t = x.incoterm || 'FOB';
  const seller =
    (t === 'EXW' ? 0 : origin) +
    (['CFR', 'CIF', 'DAP', 'DDP'].includes(t) ? ocean : 0) +
    (['CIF', 'DAP', 'DDP'].includes(t) ? insurance : 0) +
    (['DAP', 'DDP'].includes(t) ? n(x.destination) : 0) +
    (t === 'DDP' ? n(x.duty) : 0) +
    n(x.bankFees) + n(x.otherCosts);
  return { origin, ocean, insurance, destination, fees: n(x.bankFees), extras: n(x.otherCosts), seller: rnd(seller) };
}

/** A live estimate shown while the quote form is open. `unitCost` is the goods cost per carton in PKR. */
export function quoteEstimate(x: QuoteInputs, packsPerCarton: number, unitCost: number) {
  const revenueForeign = rnd(n(x.cartons) * packsPerCarton * n(x.rate));
  const revenuePKR = rnd(revenueForeign * n(x.fxRate));
  const cogs = rnd(n(x.cartons) * unitCost);
  const costs = sellerCosts(x);
  const sellerPKR = rnd(costs.seller * n(x.fxRate));
  const net = rnd(revenuePKR - cogs - sellerPKR);
  return { revenueForeign, revenuePKR, cogs, costs, sellerPKR, net, margin: revenuePKR ? (100 * net) / revenuePKR : 0 };
}
