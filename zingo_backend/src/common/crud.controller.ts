import {
  Body, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, SetMetadata, Type, ValidationPipe,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { ROLES_KEY } from '../auth/roles.decorator';
import { Role } from './enums';
import { AppEntity } from './app.entity';
import { CrudService } from './crud.service';

/**
 * Base class for a plain CRUD controller:
 *
 *   @ApiTags('products') @Controller('products')
 *   export class ProductsController extends CrudController<Product>({ create: CreateProductDto, update: UpdateProductDto, read: STAFF, write: WRITE_ROLES.manufacturing }) {
 *     constructor(service: ProductsService) { super(service); }
 *   }
 */
export function CrudController<E extends AppEntity>(opts: {
  create: Type<unknown>;
  update: Type<unknown>;
  read: Role[];
  write: Role[];
}) {
  const pipe = (expectedType: Type<unknown>) =>
    new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true }, expectedType,
    });

  abstract class Base {
    constructor(protected readonly service: CrudService<E>) {}

    @Get()
    @SetMetadata(ROLES_KEY, opts.read)
    findAll(@Query() query: Record<string, string>) {
      return this.service.findAll(query);
    }

    @Get(':id')
    @SetMetadata(ROLES_KEY, opts.read)
    findOne(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.findOne(id);
    }

    @Post()
    @SetMetadata(ROLES_KEY, opts.write)
    @ApiBody({ type: opts.create })
    create(@Body(pipe(opts.create)) dto: any) {
      return this.service.create(dto);
    }

    @Patch(':id')
    @SetMetadata(ROLES_KEY, opts.write)
    @ApiBody({ type: opts.update })
    update(@Param('id', ParseUUIDPipe) id: string, @Body(pipe(opts.update)) dto: any) {
      return this.service.update(id, dto);
    }

    @Delete(':id')
    @SetMetadata(ROLES_KEY, opts.write)
    remove(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.remove(id);
    }
  }

  return Base;
}
