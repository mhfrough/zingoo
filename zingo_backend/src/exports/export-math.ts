import { round2 } from '../common/numeric.transformer';

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

/**
 * Cost buckets of a container and the part the seller carries.
 *   EXW  - nothing at origin; FOB - origin costs
 *   CFR  - plus ocean freight; CIF - plus insurance
 *   DAP  - plus destination charges; DDP - plus import duty
 * Bank fees and other costs are always the seller's.
 */
export function shipmentCosts(x: ShipmentInputs): ShipmentCosts {
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
  return { origin, ocean, insurance, destination, fees: n(x.bankFees), extras: n(x.otherCosts), seller: round2(seller) };
}

/**
 * Revenue, goods cost, seller costs and profit of one container.
 * @param unitCost factory cost per carton (PKR)
 */
export function shipmentMath(x: ShipmentInputs, packsPerCarton: number, unitCost: number): ShipmentMath {
  const revenueForeign = round2(n(x.cartons) * packsPerCarton * n(x.rate));
  const revenuePKR = round2(revenueForeign * n(x.fxRate));
  const cogs = round2(n(x.cartons) * unitCost);
  const costs = shipmentCosts(x);
  const sellerCostPKR = round2(costs.seller * n(x.fxRate));
  const net = round2(revenuePKR - cogs - sellerCostPKR);
  const t = x.incoterm;
  const fobEquivalent = round2(
    revenueForeign +
    (t === 'EXW' ? costs.origin : 0) -
    (['CFR', 'CIF', 'DAP', 'DDP'].includes(t) ? costs.ocean : 0) -
    (['CIF', 'DAP', 'DDP'].includes(t) ? costs.insurance : 0),
  );
  return {
    packsPerCarton, revenueForeign, revenuePKR, cogs, costs, sellerCostPKR, net,
    grossProfit: round2(revenuePKR - cogs),
    margin: revenuePKR ? round2((100 * net) / revenuePKR) : 0,
    fobEquivalent,
  };
}
