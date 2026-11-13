import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { CreateDeliveryClaimDto, DecideDeliveryClaimDto } from './delivery-claims.dto';
import { DeliveryClaimsService } from './delivery-claims.service';

/**
 * Faulty goods in a manufacturer's delivery: the distributor raises, the manufacturer decides, Zen Foods sees all.
 * Partner logins see only their own claims; the filters are for staff.
 */
@ApiTags('delivery-claims')
@Controller('delivery-claims')
export class DeliveryClaimsController {
  constructor(private readonly service: DeliveryClaimsService) {}

  @Get()
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('distributorId') distributorId?: string, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, { distributorId: distributorId || undefined, manufacturerId: manufacturerId || undefined });
  }

  @Post()
  @Roles('Admin', 'Distribution', 'Distributor')
  @Permit('claims')
  @ApiOperation({ summary: 'Report damaged, missing or poor-quality bundles in a received delivery' })
  create(@Request() req: any, @Body() dto: CreateDeliveryClaimDto) {
    return this.service.create(req.user, dto);
  }

  @Post(':id/decide')
  @Roles('Admin', 'Manufacturing', 'Manufacturer')
  @ApiOperation({ summary: 'The manufacturer accepts (credit or replacement) or rejects with a reason' })
  decide(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDeliveryClaimDto) {
    return this.service.decide(req.user, id, dto);
  }

  @Get(':id/evidence')
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  evidence(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.evidence(req.user, id);
  }
}
