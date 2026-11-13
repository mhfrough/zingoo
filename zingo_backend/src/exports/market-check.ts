import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ExportShipment, ProductMarketApproval } from './exports.entities';

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const same = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Before an order for a distributor ships: an approved market approval for the product in the destination country,
 * registration and certificates in date, and a batch whose expiry leaves the minimum shelf life.
 */
export async function checkMarket(em: EntityManager, x: ExportShipment, shipDate: string) {
  const ok = (await em.find(ProductMarketApproval, { where: { productId: x.productId, status: 'Approved' } })).find((a) => same(a.country, x.country));
  if (!ok) throw new BadRequestException(`This product has no approved market approval for ${x.country}. The compliance reviewer approves it first.`);
  if (ok.registrationExpiry && ok.registrationExpiry < shipDate) throw new BadRequestException(`The product registration for ${x.country} expired on ${ok.registrationExpiry}.`);
  const lapsed = (ok.certificates ?? []).filter((c) => c.expiry && c.expiry < shipDate).map((c) => c.type);
  if (lapsed.length) throw new BadRequestException(`Certificates for ${x.country} have expired: ${lapsed.join(', ')}.`);
  if (!x.batchRef) throw new BadRequestException('Enter the batch / lot number under Logistics before it ships.');
  if (ok.minShelfLifeDays > 0) {
    if (!x.expiryDate) throw new BadRequestException(`${x.country} needs ${ok.minShelfLifeDays} days of shelf life; enter the batch expiry date.`);
    const left = days(shipDate, x.expiryDate);
    if (left < ok.minShelfLifeDays) throw new BadRequestException(`The batch has ${left} days of shelf life left; ${x.country} needs at least ${ok.minShelfLifeDays}.`);
  }
}
