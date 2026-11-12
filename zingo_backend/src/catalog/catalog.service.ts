import { Injectable } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { Distributor, Manufacturer, PartnerFile, Product } from './catalog.entities';
import { StockService } from './stock.service';

@Injectable()
export class ProductsService extends CrudService<Product> {
  protected order = { sku: 'ASC' };

  constructor(@InjectRepository(Product) repo: Repository<Product>, private readonly stock: StockService) {
    super(repo);
  }

  /** products with the cartons currently in the warehouse */
  async findAll() {
    const [rows, stock] = await Promise.all([super.findAll(), this.stock.stockByProduct()]);
    return rows.map((p) => ({ ...p, stockCartons: stock[p.id] ?? 0 }));
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
