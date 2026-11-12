import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Read, Roles } from '../auth/roles.decorator';
import { ReceiveDto, ShipDto } from './shipments.dto';
import { ShipmentsService } from './shipments.service';

/**
 * Shipments from the manufacturer to the distributor (or the warehouse), and their receipt.
 * A manufacturer login sees what it sent, a distributor login what was sent to it; the filters are ignored for them.
 */
@ApiTags('production-shipments')
@Controller('production-shipments')
export class ShipmentsController {
  constructor(private readonly service: ShipmentsService) {}

  @Get()
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('distributorId') distributorId?: string, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, { distributorId: distributorId || undefined, manufacturerId: manufacturerId || undefined });
  }

  @Get('stock')
  @Read('manufacturing', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'Zen Foods stock held by distributors: lots with their sell-by dates, and per product' })
  stock(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.stock(req.user, distributorId || undefined);
  }

  @Get('trail')
  @Read('manufacturing', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'Each delivery from shipment to cash: shipped, received, sold, on hand, sales and collected' })
  trail(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.trail(req.user, { distributorId: distributorId || undefined });
  }

  @Post()
  @Roles('Admin', 'Manufacturing', 'Manufacturer')
  @ApiOperation({ summary: 'Ship containers of an accepted order' })
  ship(@Request() req: any, @Body() dto: ShipDto) {
    return this.service.ship(req.user, dto);
  }

  @Post(':id/receive')
  @Roles('Admin', 'Manufacturing', 'Distribution', 'Distributor')
  @ApiOperation({ summary: 'Confirm what arrived: it is owed to the manufacturer and becomes stock' })
  receive(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveDto) {
    return this.service.receive(req.user, id, dto);
  }
}
