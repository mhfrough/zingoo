import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { DistOrderPayDto } from './dist-invoices.dto';
import { DistOrderMoneyService } from './dist-order-money.service';
import { ReasonDto } from './production-orders.dto';

/**
 * Money on a distributor's orders: what each order comes to, what was paid on it and what is left, with the days
 * since the goods arrived. A distributor sees and pays its own; staff see any distributor's and can reverse a payment.
 */
@ApiTags('distributor-invoices')
@Controller('distributor-orders')
export class DistOrderMoneyController {
  constructor(private readonly service: DistOrderMoneyService) {}

  @Get('money')
  @Read('portal', 'distribution', 'finance')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'Every order with its amount, paid, balance and days since received' })
  orders(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.orders(req.user, distributorId || null);
  }

  @Get('money/:orderRef')
  @Read('portal', 'distribution', 'finance')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'One order: each payment with the balance after it' })
  ledger(@Request() req: any, @Param('orderRef') orderRef: string, @Query('distributorId') distributorId?: string) {
    return this.service.ledger(req.user, orderRef, distributorId || null);
  }

  @Post('pay')
  @Roles('Admin', 'Finance', 'Distribution', 'Distributor')
  @Permit('payments')
  @ApiOperation({ summary: 'Pay on an order: counts at once, set against its sales invoices' })
  pay(@Request() req: any, @Body() dto: DistOrderPayDto) {
    return this.service.pay(req.user, dto);
  }

  @Post('payments/:id/reverse')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Take back a payment that did not arrive' })
  reverse(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.reverse(req.user, id, dto.reason);
  }
}
