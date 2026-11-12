import { BadRequestException, Injectable } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { Distributor, Manufacturer, PartnerFile, Product } from './catalog.entities';
import { LookupsService } from '../setup/lookups.service';
import { StockService } from './stock.service';

@Injectable()
export class ProductsService extends CrudService<Product> {
  protected order = { sku: 'ASC' };
  protected relations = ['manufacturer', 'distributor'];

  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    private readonly stock: StockService,
    private readonly lookups: LookupsService,
  ) {
    super(repo);
  }

  /** products with the bundles in the warehouse, packets per container and the sell-out days that apply */
  async findAll() {
    const [rows, stock] = await Promise.all([super.findAll(), this.stock.stockByProduct()]);
    return rows.map((p) => this.shape(p, stock[p.id] ?? 0));
  }

  async create(dto: DeepPartial<Product>) {
    await this.check(dto, null);
    return super.create(dto);
  }

  async update(id: string, dto: DeepPartial<Product>) {
    await this.check(dto, await this.repo.findOne({ where: { id } }));
    return super.update(id, dto);
  }

  /** packets per container, and the sell-out days: the product's own, else the distributor's */
  private shape(p: Product, stockCartons: number) {
    return {
      ...p,
      stockCartons,
      packetsPerContainer: p.packsPerCarton * (p.bundlesPerContainer || 1),
      effectiveSelloutDays: p.selloutDays ?? p.distributor?.selloutDays ?? null,
    };
  }

  /**
   * Flavour and packet size must be active Settings entries (an unchanged old value is kept);
   * the assigned manufacturer and distributor must exist.
   */
  private async check(dto: DeepPartial<Product>, before: Product | null) {
    if (dto.flavour && dto.flavour !== before?.flavour) await this.lookups.assertActive('FLAVOUR', dto.flavour as string);
    if (dto.packetSize && dto.packetSize !== before?.packetSize) await this.lookups.assertActive('PACKET_SIZE', dto.packetSize as string);
    const em = this.repo.manager;
    if (dto.manufacturerId && !(await em.getRepository(Manufacturer).exist({ where: { id: dto.manufacturerId as string } }))) {
      throw new BadRequestException('Choose a manufacturer from Settings & Data.');
    }
    if (dto.distributorId && !(await em.getRepository(Distributor).exist({ where: { id: dto.distributorId as string } }))) {
      throw new BadRequestException('Choose a distributor from Settings & Data.');
    }
  }
}

@Injectable()
export class ManufacturersService extends CrudService<Manufacturer> {
  protected order = { name: 'ASC' };

  constructor(@InjectRepository(Manufacturer) repo: Repository<Manufacturer>, private readonly files: AttachmentsService) {
    super(repo);
  }

  async create(dto: DeepPartial<Manufacturer>) {
    const row = await super.create(dto);
    await linkFiles(this.files, 'MANUFACTURER', row.id, row.files);
    return row;
  }

  async update(id: string, dto: DeepPartial<Manufacturer>) {
    const row = await super.update(id, dto);
    await linkFiles(this.files, 'MANUFACTURER', row.id, row.files);
    return row;
  }
}

@Injectable()
export class DistributorsService extends CrudService<Distributor> {
  protected order = { name: 'ASC' };

  constructor(@InjectRepository(Distributor) repo: Repository<Distributor>, private readonly files: AttachmentsService) {
    super(repo);
  }

  async create(dto: DeepPartial<Distributor>) {
    const row = await super.create(dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }

  async update(id: string, dto: DeepPartial<Distributor>) {
    const row = await super.update(id, dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }
}

/** marks a partner's uploaded files as theirs, so only an Admin can delete them later */
async function linkFiles(files: AttachmentsService, ownerType: string, ownerId: string, list: PartnerFile[] | undefined) {
  for (const f of list ?? []) await files.attach(f.id, ownerType, ownerId);
}
