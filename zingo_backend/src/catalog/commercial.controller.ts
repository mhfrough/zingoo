import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { STAFF } from '../auth/access';
import { Roles } from '../auth/roles.decorator';
import { CreateDistributorPriceDto, DistributorCreditDto, PriceDecisionDto } from './catalog.dto';
import { CommercialService } from './commercial.service';

/** An international distributor's credit approval, bank verification and price list. */
@ApiTags('distributors')
@Controller('distributors/:id')
export class CommercialController {
  constructor(private readonly service: CommercialService) {}

  @Put('credit')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Approve the credit limit, its currency, expiry and control (Finance)' })
  credit(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DistributorCreditDto) {
    return this.service.setCredit(req.user, id, dto);
  }

  @Post('banks/:index/verify')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Mark one of the distributor bank accounts verified (Finance)' })
  verifyBank(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    return this.service.verifyBank(req.user, id, index);
  }

  @Get('prices')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Every price version of the distributor, newest first' })
  prices(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.prices(id);
  }

  @Post('prices')
  @Roles('Admin', 'Distribution', 'Exports', 'Finance')
  @ApiOperation({ summary: 'Add a price version for one SKU (under the margin floor it waits for Finance)' })
  addPrice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDistributorPriceDto) {
    return this.service.addPrice(req.user, id, dto);
  }

  @Post('prices/:priceId/approve')
  @Roles('Admin', 'Finance')
  approvePrice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('priceId', ParseUUIDPipe) priceId: string, @Body() dto: PriceDecisionDto) {
    return this.service.approvePrice(req.user, id, priceId, dto.note);
  }

  @Post('prices/:priceId/reject')
  @Roles('Admin', 'Finance')
  rejectPrice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('priceId', ParseUUIDPipe) priceId: string, @Body() dto: PriceDecisionDto) {
    return this.service.rejectPrice(req.user, id, priceId, dto.note);
  }

  @Delete('prices/:priceId')
  @Roles('Admin', 'Distribution', 'Exports', 'Finance')
  removePrice(@Param('id', ParseUUIDPipe) id: string, @Param('priceId', ParseUUIDPipe) priceId: string) {
    return this.service.removePrice(id, priceId);
  }
}
