import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Money privacy for partner logins. Zen Foods buys from the manufacturer and sells to the distributor, and every
 * payment goes through Zen Foods, so:
 *  - a distributor never sees what Zen Foods pays the manufacturer (its rate, advance, the product's cost lines) nor
 *    Zen Foods' own cost and margin; goods it holds are valued at its own price;
 *  - a manufacturer never sees what the distributor is charged, Zen Foods' selling prices, nor the distributor's
 *    credit and terms.
 * Staff logins (and an Admin switched into a partner login sees what that partner sees) are untouched otherwise.
 * Runs on every response, so a new endpoint cannot leak these fields by accident.
 */

/** fields a distributor login never receives, wherever they are */
const HIDE_FROM_DISTRIBUTOR = new Set([
  'manufacturerRate', 'packagingRate', 'printingRate', 'inboundRate', 'outboundRate', 'unitCost', 'costRate', 'cost', 'margin',
  'minMarginPct', 'profitAllocationPerPack', 'valueInProduction', 'makers',
]);
/** fields a manufacturer login never receives, wherever they are */
const HIDE_FROM_MANUFACTURER = new Set([
  'saleRate', 'standardRate', 'minMarginPct', 'unitCost', 'costRate', 'margin', 'packagingRate', 'printingRate', 'inboundRate',
  'outboundRate', 'profitAllocationPerPack', 'spread', 'spreadPct', 'makers',
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** a manufacturer as a distributor may see it */
const slimManufacturer = (m: Obj) => ({ id: m['id'], name: m['name'] });
/** a distributor as a manufacturer may see it (enough to deliver to it) */
const slimDistributor = (d: Obj) => ({ id: d['id'], name: d['name'], region: d['region'] ?? null, address: d['address'] ?? null, contact: d['contact'] ?? null });

/** a production order (it carries the manufacturer) */
const isProductionOrder = (o: Obj) => 'manufacturerId' in o && 'containers' in o && 'destination' in o;
/** a manufacturer delivery row valued at the manufacturer's rate (it also carries the distributor's sale rate) */
const isShipmentRow = (o: Obj) => 'saleRate' in o && 'packets' in o && 'containers' in o;
/** a delivery claim (valued at the manufacturer's rate: what Zen Foods claims back) */
const isDeliveryClaim = (o: Obj) => 'kind' in o && 'bundles' in o && 'resolution' in o && 'value' in o;

function forDistributor(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => forDistributor(x, key));
  if (!isObj(v)) return v;
  if (key === 'manufacturer') return slimManufacturer(v);
  const o: Obj = {};
  for (const [k, x] of Object.entries(v)) if (!HIDE_FROM_DISTRIBUTOR.has(k)) o[k] = forDistributor(x, k);
  if (isProductionOrder(o)) {
    delete o['rate'];
    delete o['advancePct'];
    delete o['advanceAmount'];
    delete o['value'];
  }
  if (isShipmentRow(o)) {
    // the goods the distributor holds, valued at its own price instead of the manufacturer's
    const sale = Number(o['saleRate'] ?? 0);
    const containers = Number(o['containers'] ?? 0);
    const perContainer = containers ? Number(o['packets'] ?? 0) / containers : 0;
    o['value'] = r2(Number(o['packets'] ?? 0) * sale);
    o['receivedValue'] = r2(Number(o['receivedContainers'] ?? 0) * perContainer * sale);
    o['onHandValue'] = r2(Number(o['onHandContainers'] ?? 0) * perContainer * sale);
    delete o['rate'];
  }
  if (isDeliveryClaim(o)) delete o['value'];
  // a stock summary: the per-product value follows the repriced lots
  if (Array.isArray(o['lots']) && Array.isArray(o['byProduct'])) {
    const lots = o['lots'] as Obj[];
    o['byProduct'] = (o['byProduct'] as Obj[]).map((p) => ({
      ...p, value: r2(lots.filter((l) => l['productId'] === p['productId']).reduce((n, l) => n + Number(l['onHandValue'] ?? 0), 0)),
    }));
  }
  return o;
}

function forManufacturer(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => forManufacturer(x, key));
  if (!isObj(v)) return v;
  if (key === 'distributor') return slimDistributor(v);
  const o: Obj = {};
  for (const [k, x] of Object.entries(v)) if (!HIDE_FROM_MANUFACTURER.has(k)) o[k] = forManufacturer(x, k);
  // a product: Zen Foods' selling price stays with Zen Foods (the manufacturer's own rate and the MRP stay)
  if (key === 'product' || ('sku' in o && 'manufacturerRate' in o)) delete o['rate'];
  return o;
}

@Injectable()
export class PartnerViewInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const role = ctx.switchToHttp().getRequest()?.user?.role as string | undefined;
    if (role === 'Distributor') return next.handle().pipe(map((body) => forDistributor(body)));
    if (role === 'Manufacturer') return next.handle().pipe(map((body) => forManufacturer(body)));
    return next.handle();
  }
}
