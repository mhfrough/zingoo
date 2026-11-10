import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { Distributor, DistributorRate, Product } from './catalog.entities';

/** Set the price per pack agreed with one distributor for one SKU (replaces an earlier agreement). */
export class SetRateDto {
  @IsUUID() distributorId: string;
  @IsUUID() productId: string;
  @IsNumber() @Min(0) rate: number;
}

/**
 * Agreed rates: a distributor's own price per pack for a SKU. New orders for that pair start from this price
 * instead of the product's standard rate; orders already booked keep the rate they were booked at.
 */
@Injectable()
export class RatesService {
  constructor(
    @InjectRepository(DistributorRate) private readonly repo: Repository<DistributorRate>,
    @InjectRepository(Distributor) private readonly distributors: Repository<Distributor>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  list() {
    return this.repo.find({ relations: ['distributor', 'product'], order: { createdAt: 'ASC' } });
  }

  /** one rate per distributor and SKU: creates it or changes the existing one */
  async set(dto: SetRateDto) {
    if (!(await this.distributors.findOne({ where: { id: dto.distributorId } }))) throw new BadRequestException('Choose an existing distributor.');
    if (!(await this.products.findOne({ where: { id: dto.productId } }))) throw new BadRequestException('Choose an existing product.');
    const found = await this.repo.findOne({ where: { distributorId: dto.distributorId, productId: dto.productId } });
    const saved = await this.repo.save(found ? this.repo.merge(found, { rate: dto.rate }) : this.repo.create(dto));
    return this.repo.findOneOrFail({ where: { id: saved.id }, relations: ['distributor', 'product'] });
  }

  async remove(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Agreed rate not found');
    await this.repo.remove(r);
    return { deleted: true };
  }
}
