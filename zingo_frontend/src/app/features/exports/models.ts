/** Shapes returned by the export container endpoints. */

export type Incoterm = 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DDP';

export const INCOTERMS: { code: Incoterm; text: string }[] = [
  { code: 'EXW', text: 'Buyer organizes most of the carriage' },
  { code: 'FOB', text: 'Seller delivers the goods on board the vessel and pays the origin costs' },
  { code: 'CFR', text: 'Seller also pays the ocean freight' },
  { code: 'CIF', text: 'Seller also pays the ocean freight and the marine insurance' },
  { code: 'DAP', text: 'Seller delivers to the named place, import duty not included' },
  { code: 'DDP', text: 'Seller delivers with import duty and import clearance paid' },
];

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
  incoterm: Incoterm;
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
