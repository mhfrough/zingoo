import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { nextRef } from '../common/ref';
import { round2 } from '../common/numeric.transformer';
import { PostingService } from '../ledger/posting.service';
import { SettingsService } from '../setup/setup.service';
import { CreateBatchDto, CreateMfrPaymentDto, UpdateBatchDto } from './manufacturing.dto';
import { ManufacturerPayment, ProductionBatch } from './manufacturing.entities';

@Injectable()
export class BatchesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
  ) {}

  private async paidMap(em: EntityManager): Promise<Record<string, number>> {
    const rows: { batchId: string; paid: number }[] = await em.query(
      `SELECT "batchId", SUM(amount)::float8 AS paid FROM manufacturer_payments GROUP BY "batchId"`,
    );
    return Object.fromEntries(rows.map((r) => [r.batchId, r.paid]));
  }

  private decorate(b: ProductionBatch, paid: Record<string, number>) {
    const p = round2(paid[b.id] ?? 0);
    return { ...b, paid: p, due: Math.max(0, round2(Number(b.cost) - p)) };
  }

  async list() {
    const em = this.db.manager;
    const [rows, paid] = await Promise.all([
      em.find(ProductionBatch, { relations: ['product', 'manufacturer'], order: { date: 'DESC', refNo: 'DESC' } }),
      this.paidMap(em),
    ]);
    return rows.map((b) => this.decorate(b, paid));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const b = await em.findOne(ProductionBatch, { where: { id }, relations: ['product', 'manufacturer'] });
    if (!b) throw new NotFoundException('Batch not found');
    return this.decorate(b, await this.paidMap(em));
  }

  private check(dto: { targetCartons?: number; producedCartons?: number }, current?: ProductionBatch) {
    const target = dto.targetCartons ?? current?.targetCartons ?? 0;
    const produced = dto.producedCartons ?? current?.producedCartons ?? 0;
    if (produced > target * 5) throw new BadRequestException('Actual cartons look unusually high. Check the entry.');
  }

  create(dto: CreateBatchDto, opts: { refNo?: string } = {}) {
    this.check(dto);
    return this.db.transaction(async (em) => {
      const s = await this.settings.get(em);
      const refNo = opts.refNo ?? (await nextRef(em, ProductionBatch, s.docPrefixes['batch'] ?? 'B', 4, 1001));
      const batch = await em.save(em.create(ProductionBatch, { ...dto, refNo, status: 'Planned' }));
      return this.findOne(batch.id, em);
    });
  }

  update(id: string, dto: UpdateBatchDto) {
    return this.db.transaction(async (em) => {
      const b = await em.findOne(ProductionBatch, { where: { id } });
      if (!b) throw new NotFoundException('Batch not found');
      if (b.status === 'Released') throw new BadRequestException('Released batches cannot be edited.');
      this.check(dto, b);
      await em.save(em.merge(ProductionBatch, b, dto));
      return this.findOne(id, em);
    });
  }

  async remove(id: string) {
    const b = await this.db.manager.findOne(ProductionBatch, { where: { id } });
    if (!b) throw new NotFoundException('Batch not found');
    if (b.status !== 'Planned') throw new BadRequestException('Only planned batches can be deleted.');
    await this.db.manager.remove(b);
    return { deleted: true };
  }

  /** QC passed + cartons entered -> stock goes up and the manufacturer is owed the batch cost. */
  release(id: string) {
    return this.db.transaction(async (em) => {
      const b = await em.findOne(ProductionBatch, { where: { id } });
      if (!b) throw new NotFoundException('Batch not found');
      if (b.status === 'Released') throw new BadRequestException('This batch is already released.');
      if (b.qc !== 'Passed') throw new BadRequestException('Quality control must be Passed before release.');
      if (!(b.producedCartons > 0)) throw new BadRequestException('Enter the actual finished cartons before release.');
      b.status = 'Released';
      await em.save(b);
      await this.posting.syncBatch(em, id);
      return this.findOne(id, em);
    });
  }
}

@Injectable()
export class MfrPaymentsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
  ) {}

  list() {
    return this.db.manager.find(ManufacturerPayment, { relations: ['batch', 'batch.manufacturer'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  create(dto: CreateMfrPaymentDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const batch = await em.findOne(ProductionBatch, { where: { id: dto.batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'Released') throw new BadRequestException('Only released batches can be paid.');

      const [row] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM manufacturer_payments WHERE "batchId" = $1`, [batch.id]);
      const due = round2(Number(batch.cost) - Number(row.paid));
      if (dto.amount > due + 0.001) throw new BadRequestException(`Payment cannot exceed the open balance of PKR ${due}.`);

      const refNo = opts.refNo ?? (await nextRef(em, ManufacturerPayment, 'MP', 3));
      const pay = await em.save(em.create(ManufacturerPayment, { ...dto, refNo, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncMfrPayment(em, pay.id);
      return pay;
    });
  }
}
