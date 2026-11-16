import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { CloseDistDispatchDto, CreateDistDispatchDto } from './dist-dispatches.dto';
import { DistDispatchesService } from './dist-dispatches.service';

/**
 * Goods a distributor sends to its own customers, and whether they arrived. A distributor login sees its own;
 * the filter is for staff.
 */
@ApiTags('distributor-dispatches')
@Controller('distributor-dispatches')
export class DistDispatchesController {
  constructor(private readonly service: DistDispatchesService) {}

  @Get()
  @Read('portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  list(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.list(req.user, distributorId || undefined);
  }

  @Post()
  @Roles('Admin', 'Distribution', 'Distributor')
  @Permit('receipts')
  @ApiOperation({ summary: 'Send bundles of a received delivery to a customer' })
  create(@Request() req: any, @Body() dto: CreateDistDispatchDto) {
    return this.service.create(req.user, dto);
  }

  @Post(':id/close')
  @Roles('Admin', 'Distribution', 'Distributor')
  @Permit('receipts')
  @ApiOperation({ summary: 'The dispatch reached the customer, or came back' })
  close(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDistDispatchDto) {
    return this.service.close(req.user, id, dto);
  }
}
