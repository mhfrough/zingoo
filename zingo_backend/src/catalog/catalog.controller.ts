import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { STAFF, WRITE_ROLES } from '../auth/access';
import { CrudController } from '../common/crud.controller';
import { Distributor, Manufacturer, Product } from './catalog.entities';
import {
  CreateDistributorDto, CreateManufacturerDto, CreateProductDto, UpdateDistributorDto,
  UpdateManufacturerDto, UpdateProductDto,
} from './catalog.dto';
import { DistributorsService, ManufacturersService, ProductsService } from './catalog.service';

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
