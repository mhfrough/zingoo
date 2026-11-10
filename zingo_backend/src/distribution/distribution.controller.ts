import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import { CreateCollectionDto, CreateOrderDto, CreditOverrideDto, UpdateOrderDto } from './distribution.dto';
import { CollectionsService, OrdersService } from './distribution.service';

@ApiTags('distribution')
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  @Read('distribution', 'pricing', 'accounting')
  @ApiOperation({ summary: 'Sales orders with invoice value, collected, outstanding and due date' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Read('distribution', 'pricing', 'accounting')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Write('distribution')
  create(@Body() dto: CreateOrderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Write('distribution')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Write('distribution')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/dispatch')
  @Write('distribution')
  @ApiOperation({ summary: 'Dispatch a draft order: reduces stock, posts the invoice and cost of goods sold (blocked by a credit hold)' })
  dispatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.dispatch(id);
  }

  @Post(':id/credit-override')
  @Write('finance')
  @ApiOperation({ summary: 'Finance / Admin: allow this draft order although the distributor is over the credit limit' })
  creditOverride(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditOverrideDto, @Request() req: any) {
    return this.service.creditOverride(id, dto.reason, req.user);
  }
}

@ApiTags('distribution')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly service: CollectionsService) {}

  @Get()
  @Read('distribution', 'accounting')
  list() {
    return this.service.list();
  }

  @Post()
  @Write('distribution')
  @ApiOperation({ summary: 'Record money received from a distributor against a dispatched order' })
  create(@Body() dto: CreateCollectionDto) {
    return this.service.create(dto);
  }
}
