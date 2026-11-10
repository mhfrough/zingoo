import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Product } from '../catalog/catalog.entities';
import { StockService } from '../catalog/stock.service';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { LookupsService } from '../setup/lookups.service';
import { ContainerType, Currency, Setting } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { flagsFor, shipmentMath } from './export-math';
import { CreateExportDto, ExportCostPaymentDto, ExportReceiptDto, UpdateExportDto } from './exports.dto';
import { ExportCostPayment, ExportReceipt, ExportShipment } from './exports.entities';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Export containers: a quote is a costing scenario; shipping it posts the invoice, the goods cost
 * and the seller-borne logistics. Foreign-currency collections post any realised exchange gain or loss.
 */
@Injectable()
export class ExportsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly lookups: LookupsService,
  ) {}

  /** factory cost per carton: the released-batch average, else the planning rates x packs */
  private async planningUnitCost(em: EntityManager, p: Product, packs: number): Promise<number> {
    const avg = await this.stock.unitCostFor(p.id, em);
    if (avg > 0) return avg;
    const variable = Number(p.manufacturerRate) + Number(p.packagingRate) + Number(p.printingRate) + Number(p.inboundRate);
    return round2(variable * packs);
  }

  private async view(em: EntityManager, x: ExportShipment, s: Setting) {
    const p = x.product ?? (await em.findOneOrFail(Product, { where: { id: x.productId } }));
    const packs = x.packsPerCarton ?? p.packsPerCarton ?? s.packsPerCarton;
    const unitCost = x.unitCost ?? (await this.planningUnitCost(em, p, packs));
    const m = shipmentMath(x, packs, unitCost, flagsFor(await this.lookups.incotermFlags(em), x.incoterm));
    const [paid] = await em.query(`SELECT COALESCE(SUM("foreignAmount"), 0)::float8 AS v FROM export_receipts WHERE "shipmentId" = $1`, [x.id]);
    const [costPaid] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM export_cost_payments WHERE "shipmentId" = $1`, [x.id]);
    const collected = round2(paid.v);
    const costsSettled = round2(costPaid.v);
    return {
      ...x,
      product: { id: p.id, sku: p.sku, name: p.name },
      ...m,
      unitCost,
      collected,
      due: Math.max(0, round2(m.revenueForeign - collected)),
      costPaid: costsSettled,
      costDue: Math.max(0, round2(m.sellerCostPKR - costsSettled)),
    };
  }

  async list() {
    const em = this.db.manager;
    const s = await this.settings.get(em);
    const rows = await em.find(ExportShipment, { relations: ['product'], order: { date: 'DESC', refNo: 'DESC' } });
    return Promise.all(rows.map((x) => this.view(em, x, s)));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const x = await em.findOne(ExportShipment, { where: { id }, relations: ['product'] });
    if (!x) throw new NotFoundException('Container not found');
    return this.view(em, x, await this.settings.get(em));
  }

  receipts() {
    return this.db.manager.find(ExportReceipt, { relations: ['shipment'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  costPayments() {
    return this.db.manager.find(ExportCostPayment, { relations: ['shipment'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  /** the currency and container must be set up, and the rate must be positive */
  private async check(em: EntityManager, d: { currency?: string; container?: string; productId?: string; incoterm?: string }) {
    if (d.currency && !(await em.findOne(Currency, { where: { code: d.currency } }))) {
      throw new BadRequestException(`Currency ${d.currency} is not set up.`);
    }
    if (d.container && !(await em.findOne(ContainerType, { where: { code: d.container } }))) {
      throw new BadRequestException(`Container type ${d.container} is not set up.`);
    }
    if (d.productId && !(await em.findOne(Product, { where: { id: d.productId } }))) {
      throw new BadRequestException('Choose an existing product.');
    }
    if (d.incoterm) await this.lookups.assertActive('INCOTERM', d.incoterm, em);
  }

  create(dto: CreateExportDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      await this.check(em, dto);
      const refNo = opts.refNo ?? (await nextRef(em, ExportShipment, 'EXP', 3));
      const x = await em.save(em.create(ExportShipment, { ...dto, refNo, status: 'Quote' }));
      return this.findOne(x.id, em);
    });
  }

  update(id: string, dto: UpdateExportDto) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id } });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('Shipped containers are locked; post an adjusting voucher for corrections.');
      await this.check(em, dto);
      await em.save(em.merge(ExportShipment, x, dto));
      return this.findOne(id, em);
    });
  }

  remove(id: string) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id } });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('Shipped containers cannot be deleted.');
      await em.remove(x);
      return { deleted: true };
    });
  }

  /** ship a quote: stock goes down, the goods cost is frozen and the invoice, cost and logistics post */
  ship(id: string, shipDate?: string) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id }, relations: ['product'] });
      if (!x) throw new NotFoundException('Container not found');
      if (x.status === 'Shipped') throw new BadRequestException('This container has already shipped.');
      const available = await this.stock.stockOf(x.productId, em);
      if (x.cartons > available) {
        throw new BadRequestException(`Not enough stock: ${x.cartons} cartons needed, ${available} in the warehouse.`);
      }
      const s = await this.settings.get(em);
      const packs = x.product.packsPerCarton ?? s.packsPerCarton;
      x.packsPerCarton = packs;
      x.unitCost = await this.planningUnitCost(em, x.product, packs);
      x.shipDate = shipDate ?? today();
      x.status = 'Shipped';
      await em.save(x);
      await this.posting.syncShipment(em, id);
      return this.findOne(id, em);
    });
  }

  /** money from the buyer, in the invoice currency, at the rate of the day it arrived */
  collect(id: string, dto: ExportReceiptDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const x = await this.findOne(id, em);
      if (x.status !== 'Shipped') throw new BadRequestException('Ship the container before collecting payment.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.foreignAmount > x.due + 0.001) {
        throw new BadRequestException(`Enter an amount within the open balance of ${x.currency} ${x.due}.`);
      }
      const refNo = opts.refNo ?? (await nextRef(em, ExportReceipt, 'XRC', 3));
      const r = await em.save(em.create(ExportReceipt, { ...dto, refNo, shipmentId: id, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncExportReceipt(em, r.id);
      return this.findOne(id, em);
    });
  }

  /** PKR paid for the seller-side logistics; settles the accrual, so it is not a second expense */
  payCosts(id: string, dto: ExportCostPaymentDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const x = await this.findOne(id, em);
      if (x.status !== 'Shipped') throw new BadRequestException('Ship the container before paying its costs.');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (dto.amount > x.costDue + 0.01) {
        throw new BadRequestException(`Enter an amount within the open export costs of PKR ${x.costDue}.`);
      }
      const refNo = opts.refNo ?? (await nextRef(em, ExportCostPayment, 'XCP', 3));
      const p = await em.save(em.create(ExportCostPayment, { ...dto, refNo, shipmentId: id, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncExportCostPayment(em, p.id);
      return this.findOne(id, em);
    });
  }
}
