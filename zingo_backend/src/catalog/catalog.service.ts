import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { Distributor, Manufacturer, Product } from './catalog.entities';
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

  constructor(@InjectRepository(Manufacturer) repo: Repository<Manufacturer>) {
    super(repo);
  }
}

@Injectable()
export class DistributorsService extends CrudService<Distributor> {
  protected order = { name: 'ASC' };

  constructor(@InjectRepository(Distributor) repo: Repository<Distributor>) {
    super(repo);
  }
}
