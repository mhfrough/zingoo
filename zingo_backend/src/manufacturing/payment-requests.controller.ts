import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Read, Roles, Write } from '../auth/roles.decorator';
import { SignDto } from '../finance/finance.dto';
import { CreatePaymentRequestDto, PayRequestDto } from './payment-requests.dto';
import { PaymentRequestsService } from './payment-requests.service';
import { ReasonDto } from './production-orders.dto';

/** who may raise or withdraw a request: the manufacturer itself, or staff for it */
const FACTORY = ['Admin', 'Manufacturing', 'Manufacturer'] as const;

/**
 * Manufacturer payment requests. The manufacturer (or staff for it) asks for the advance or the balance of an
 * accepted order; Finance signs (one or two seats, by the approval threshold), rejects, or pays. A manufacturer
 * login only sees its own requests.
 */
@ApiTags('manufacturer-payment-requests')
@Controller('mfr-payment-requests')
export class PaymentRequestsController {
  constructor(private readonly service: PaymentRequestsService) {}

  @Get()
  @Read('manufacturing', 'finance', 'factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, manufacturerId || undefined);
  }

  @Get('position')
  @Read('manufacturing', 'finance', 'factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  @ApiOperation({ summary: 'Per order: value, advance, asked for, approved, paid and still to pay' })
  position(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.position(req.user, manufacturerId || undefined);
  }

  @Post()
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'Ask for the advance or the balance of an accepted order' })
  create(@Request() req: any, @Body() dto: CreatePaymentRequestDto) {
    return this.service.create(req.user, dto);
  }

  @Post(':id/withdraw')
  @Roles(...FACTORY)
  withdraw(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.withdraw(req.user, id);
  }

  @Post(':id/sign')
  @Write('finance')
  @ApiOperation({ summary: 'Sign as seat A or B (needs a matching seat on your user)' })
  sign(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignDto) {
    return this.service.sign(id, dto.seat, req.user);
  }

  @Post(':id/reject')
  @Write('finance')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.reject(id, dto.reason);
  }

  @Post(':id/pay')
  @Write('finance')
  @ApiOperation({ summary: 'Pay an approved request, fully or partly' })
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayRequestDto) {
    return this.service.pay(id, dto);
  }
}
