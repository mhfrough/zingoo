import { ShipmentCosts } from './models';

/** The fields of a quote the costing needs. */
export interface QuoteInputs {
  cartons: number;
  rate: number;
  fxRate: number;
  incoterm: string;
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

/** Which cost lines an Incoterm puts on the seller (edited on Settings & Data). */
export type SellerFlags = Record<string, boolean> | undefined;

const n = (v: unknown) => Number(v) || 0;
const rnd = (v: number) => Math.round(v * 100) / 100;

/**
 * What the seller pays under the chosen Incoterm, in the invoice currency (the same rule the server uses when it ships).
 * The Incoterm's flags say which of origin, ocean freight, insurance, destination charges and import duty are the seller's;
 * bank charges and other costs always are.
 */
export function sellerCosts(x: QuoteInputs, flags: SellerFlags): ShipmentCosts {
  const f = flags ?? {};
  const origin = n(x.inland) + n(x.origin) + n(x.documentation);
  const ocean = n(x.ocean);
  const insurance = n(x.insurance);
  const destination = n(x.destination) + n(x.duty);
  const seller =
    (f['origin'] ? origin : 0) + (f['ocean'] ? ocean : 0) + (f['insurance'] ? insurance : 0) +
    (f['destination'] ? n(x.destination) : 0) + (f['duty'] ? n(x.duty) : 0) + n(x.bankFees) + n(x.otherCosts);
  return { origin, ocean, insurance, destination, fees: n(x.bankFees), extras: n(x.otherCosts), seller: rnd(seller) };
}

/** A live estimate shown while the quote form is open. `unitCost` is the goods cost per bundle in PKR. */
export function quoteEstimate(x: QuoteInputs, packsPerCarton: number, unitCost: number, flags: SellerFlags) {
  const revenueForeign = rnd(n(x.cartons) * packsPerCarton * n(x.rate));
  const revenuePKR = rnd(revenueForeign * n(x.fxRate));
  const cogs = rnd(n(x.cartons) * unitCost);
  const costs = sellerCosts(x, flags);
  const sellerPKR = rnd(costs.seller * n(x.fxRate));
  const net = rnd(revenuePKR - cogs - sellerPKR);
  return { revenueForeign, revenuePKR, cogs, costs, sellerPKR, net, margin: revenuePKR ? (100 * net) / revenuePKR : 0 };
}
