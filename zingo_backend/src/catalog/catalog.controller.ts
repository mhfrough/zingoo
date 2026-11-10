import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { STAFF, WRITE_ROLES } from '../auth/access';
import { Read, Write } from '../auth/roles.decorator';
import { CrudController } from '../common/crud.controller';
import { Distributor, Manufacturer, Product } from './catalog.entities';
import {
  CreateDistributorDto, CreateManufacturerDto, CreateProductDto, UpdateDistributorDto,
  UpdateManufacturerDto, UpdateProductDto,
} from './catalog.dto';
import { DistributorsService, ManufacturersService, ProductsService } from './catalog.service';
import { RatesService, SetRateDto } from './rates.service';

@ApiTags('products')
@Controller('products')
export class ProductsController extends CrudController<Product>({
  create: CreateProductDto, update: UpdateProductDto, read: STAFF, write: WRITE_ROLES.manufacturing,
}) {
  constructor(service: ProductsService) {
    super(service);
  }
}

@ApiTags('manufacturers')
@Controller('manufacturers')
export class ManufacturersController extends CrudController<Manufacturer>({
  create: CreateManufacturerDto, update: UpdateManufacturerDto, read: STAFF, write: WRITE_ROLES.admin,
}) {
  constructor(service: ManufacturersService) {
    super(service);
  }
}

@ApiTags('distributors')
@Controller('distributors')
export class DistributorsController extends CrudController<Distributor>({
  create: CreateDistributorDto, update: UpdateDistributorDto, read: STAFF, write: WRITE_ROLES.distribution,
}) {
  constructor(service: DistributorsService) {
    super(service);
  }
}

@ApiTags('distributors')
@Controller('distributor-rates')
export class DistributorRatesController {
  constructor(private readonly service: RatesService) {}

  @Get()
  @Read('pricing', 'distribution', 'portal')
  @ApiOperation({ summary: 'Price per pack agreed with each distributor, per SKU' })
  list() {
    return this.service.list();
  }

  @Put()
  @Write('distribution')
  @ApiOperation({ summary: 'Set (or change) the agreed rate of one distributor for one SKU' })
  set(@Body() dto: SetRateDto) {
    return this.service.set(dto);
  }

  @Delete(':id')
  @Write('distribution')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
