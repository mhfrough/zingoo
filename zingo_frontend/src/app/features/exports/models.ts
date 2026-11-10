/** Shapes returned by the export container endpoints. */

export interface ContainerType {
  code: string;
  maxCartons: number;
}

/** What the seller carries, in the invoice currency. */
export interface ShipmentCosts {
  origin: number;
  ocean: number;
  insurance: number;
  destination: number;
  fees: number;
  extras: number;
  seller: number;
}

/** A container quote or shipment with its costing, what was collected and what is still due. */
export interface ExportRow {
  id: string;
  refNo: string;
  date: string;
  shipDate: string | null;
  buyer: string;
  country: string;
  port: string | null;
  container: string;
  incoterm: string;
  productId: string;
  product: { id: string; sku: string; name: string };
  cartons: number;
  currency: string;
  /** PKR per 1 unit of the invoice currency */
  fxRate: number;
  /** selling price per pack, in the invoice currency */
  rate: number;
  inland: number;
  origin: number;
  documentation: number;
  ocean: number;
  insurance: number;
  destination: number;
  duty: number;
  bankFees: number;
  otherCosts: number;
  status: 'Quote' | 'Shipped';
  packsPerCarton: number;
  unitCost: number;
  revenueForeign: number;
  revenuePKR: number;
  cogs: number;
  costs: ShipmentCosts;
  sellerCostPKR: number;
  net: number;
  grossProfit: number;
  margin: number;
  fobEquivalent: number;
  /** foreign money received so far */
  collected: number;
  /** foreign money still to receive */
  due: number;
  costPaid: number;
  costDue: number;
}

/** Foreign-currency money received for a shipment. */
export interface ExportReceipt {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  foreignAmount: number;
  fxRate: number;
  method: string;
  note: string | null;
  shipment: { refNo: string; currency: string; buyer: string; fxRate: number };
}

/** PKR paid for the seller-side logistics costs of a shipment. */
export interface ExportCostPayment {
  id: string;
  refNo: string;
  date: string;
  shipmentId: string;
  amount: number;
  method: string;
  note: string | null;
  shipment: { refNo: string; buyer: string };
}
