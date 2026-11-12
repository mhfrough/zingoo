import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Read, Roles, Write } from '../auth/roles.decorator';
import {
  AcceptProductionOrderDto, CreateProductionOrderDto, ReasonDto, StageDto, UpdateProductionOrderDto,
} from './production-orders.dto';
import { ProductionOrdersService } from './production-orders.service';

/** who may answer an order and report progress: the manufacturer itself, or staff acting for it */
const FACTORY = ['Admin', 'Manufacturing', 'Manufacturer'] as const;

/**
 * Production orders. Staff place, send and cancel them; the manufacturer (its own login, or staff for it)
 * accepts or rejects them and reports each production step. A manufacturer login only ever sees its own
 * orders, never drafts; the `manufacturerId` query is ignored for it.
 */
@ApiTags('production-orders')
@Controller('production-orders')
export class ProductionOrdersController {
  constructor(private readonly service: ProductionOrdersService) {}

  @Get()
  @Read('manufacturing', 'factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, manufacturerId || undefined);
  }

  @Get('profile')
  @Read('factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  @ApiOperation({ summary: 'The manufacturer a factory portal shows, with its order counts and the production stages' })
  profile(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.profile(req.user, manufacturerId || undefined);
  }

  @Get(':id')
  @Read('manufacturing', 'factory')
  findOne(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user, id);
  }

  @Post()
  @Write('manufacturing')
  @ApiOperation({ summary: 'Place a production order (a draft, or sent at once with send: true)' })
  create(@Request() req: any, @Body() dto: CreateProductionOrderDto) {
    return this.service.create(req.user, dto);
  }

  @Patch(':id')
  @Write('manufacturing')
  update(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductionOrderDto) {
    return this.service.update(req.user, id, dto);
  }

  @Delete(':id')
  @Write('manufacturing')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/send')
  @Write('manufacturing')
  @ApiOperation({ summary: 'Send a draft to the manufacturer' })
  send(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.send(req.user, id);
  }

  @Post(':id/cancel')
  @Write('manufacturing')
  @ApiOperation({ summary: 'Cancel a sent or accepted order, with a reason' })
  cancel(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.cancel(req.user, id, dto);
  }

  @Post(':id/accept')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer accepts the order (optionally with a ready date)' })
  accept(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptProductionOrderDto) {
    return this.service.accept(req.user, id, dto);
  }

  @Post(':id/reject')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer rejects the order, with a reason' })
  reject(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.reject(req.user, id, dto);
  }

  @Post(':id/stage')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer reports the production step it has reached' })
  stage(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.service.stage(req.user, id, dto);
  }
}
