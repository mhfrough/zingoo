import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { DispatchDto, PickupDto, ReceiveDispatchDto, ReceiveDto, ShipDto } from './shipments.dto';
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

  @Get('incoming')
  @Read('manufacturing', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'Orders on their way to a distributor: waiting, in production, or ready to collect' })
  incoming(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.incoming(req.user, distributorId || undefined);
  }

  @Post('dispatch')
  @Roles('Admin', 'Manufacturing', 'Manufacturer')
  @ApiOperation({ summary: 'Ready to Dispatch: the manufacturer loads the distributor\'s vehicle for a whole order (quantities, vehicle, driver, proof of handover)' })
  dispatch(@Request() req: any, @Body() dto: DispatchDto) {
    return this.service.dispatchGroup(req.user, dto);
  }

  @Post('pickup')
  @Roles('Admin', 'Manufacturing', 'Distribution', 'Distributor')
  @Permit('receipts')
  @ApiOperation({ summary: 'The distributor collects containers of a ready order from the factory' })
  pickup(@Request() req: any, @Body() dto: PickupDto) {
    return this.service.pickup(req.user, dto);
  }

  @Post()
  @Roles('Admin', 'Manufacturing', 'Manufacturer')
  @ApiOperation({ summary: 'Ship containers of an accepted order' })
  ship(@Request() req: any, @Body() dto: ShipDto) {
    return this.service.ship(req.user, dto);
  }

  @Post('receive-dispatch')
  @Roles('Admin', 'Manufacturing', 'Distribution', 'Distributor')
  @Permit('receipts')
  @ApiOperation({ summary: 'Receive a whole dispatch: accept it, or report damage on arrival (a dispute the manufacturer answers)' })
  receiveDispatch(@Request() req: any, @Body() dto: ReceiveDispatchDto) {
    return this.service.receiveDispatch(req.user, dto);
  }

  @Post(':id/receive')
  @Roles('Admin', 'Manufacturing', 'Distribution', 'Distributor')
  @Permit('receipts')
  @ApiOperation({ summary: 'Confirm what arrived: it is owed to the manufacturer and becomes stock' })
  receive(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveDto) {
    return this.service.receive(req.user, id, dto);
  }
}
