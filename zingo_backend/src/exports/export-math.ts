import { round2 } from '../common/numeric.transformer';
import { INCOTERM_DEFAULTS } from '../setup/setup.constants';

/** The fields of an export shipment the costing needs (a subset of `ExportShipment`). */
export interface ShipmentInputs {
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

/** Which cost lines an Incoterm puts on the seller. Edited on Settings & Data. */
export interface SellerFlags {
  origin?: boolean;
  ocean?: boolean;
  insurance?: boolean;
  destination?: boolean;
  duty?: boolean;
}

/** Cost buckets in the invoice currency, and how much of them the seller carries under the chosen Incoterm. */
export interface ShipmentCosts {
  origin: number;
  ocean: number;
  insurance: number;
  destination: number;
  fees: number;
  extras: number;
  /** what the seller pays, in the invoice currency */
  seller: number;
}

export interface ShipmentMath {
  packsPerCarton: number;
  /** invoice value in the invoice currency */
  revenueForeign: number;
  revenuePKR: number;
  /** goods cost in PKR */
  cogs: number;
  costs: ShipmentCosts;
  /** seller-borne costs in PKR at the invoice rate */
  sellerCostPKR: number;
  /** revenue - goods cost - seller costs (PKR) */
  net: number;
  grossProfit: number;
  /** net as a percentage of revenue */
  margin: number;
  /** invoice value less the freight and insurance the invoice includes */
  fobEquivalent: number;
}

const n = (v: unknown) => Number(v) || 0;

/** the flags of one Incoterm from the editable list, or the built-in rule when the list has no such entry */
export function flagsFor(map: Record<string, SellerFlags> | undefined, code: string): SellerFlags {
  return map?.[code] ?? INCOTERM_DEFAULTS.find((t) => t.code === code)?.flags ?? INCOTERM_DEFAULTS[1].flags;
}

/**
 * Cost buckets of a container and the part the seller carries. The Incoterm decides which lines are the seller's
 * (see Settings & Data); bank charges and other costs are always the seller's.
 */
export function shipmentCosts(x: ShipmentInputs, flags: SellerFlags): ShipmentCosts {
  const origin = n(x.inland) + n(x.origin) + n(x.documentation);
  const ocean = n(x.ocean);
  const insurance = n(x.insurance);
  const destination = n(x.destination) + n(x.duty);
  const seller =
    (flags.origin ? origin : 0) +
    (flags.ocean ? ocean : 0) +
    (flags.insurance ? insurance : 0) +
    (flags.destination ? n(x.destination) : 0) +
    (flags.duty ? n(x.duty) : 0) +
    n(x.bankFees) + n(x.otherCosts);
  return { origin, ocean, insurance, destination, fees: n(x.bankFees), extras: n(x.otherCosts), seller: round2(seller) };
}

/**
 * Revenue, goods cost, seller costs and profit of one container.
 * @param unitCost factory cost per carton (PKR)
 * @param flags the cost lines the container's Incoterm puts on the seller
 */
export function shipmentMath(x: ShipmentInputs, packsPerCarton: number, unitCost: number, flags: SellerFlags): ShipmentMath {
  const revenueForeign = round2(n(x.cartons) * packsPerCarton * n(x.rate));
  const revenuePKR = round2(revenueForeign * n(x.fxRate));
  const cogs = round2(n(x.cartons) * unitCost);
  const costs = shipmentCosts(x, flags);
  const sellerCostPKR = round2(costs.seller * n(x.fxRate));
  const net = round2(revenuePKR - cogs - sellerCostPKR);
  // the invoice price includes freight and insurance when the seller carries them, and excludes origin costs when the buyer does
  const fobEquivalent = round2(
    revenueForeign + (flags.origin ? 0 : costs.origin) - (flags.ocean ? costs.ocean : 0) - (flags.insurance ? costs.insurance : 0),
  );
  return {
    packsPerCarton, revenueForeign, revenuePKR, cogs, costs, sellerCostPKR, net,
    grossProfit: round2(revenuePKR - cogs),
    margin: revenuePKR ? round2((100 * net) / revenuePKR) : 0,
    fobEquivalent,
  };
}
