import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { CreateDistInvoiceDto, DistInvoicePayDto } from './dist-invoices.dto';
import { DistInvoicesService } from './dist-invoices.service';
import { ReasonDto } from './production-orders.dto';

/** who verifies invoices and records the distributor's payments */
const MANAGE = ['Admin', 'Finance', 'Distribution'] as const;

/**
 * Distributor sales invoices for containers distributed. A distributor login reports and sees its own;
 * staff verify or reject them and record payments.
 */
@ApiTags('distributor-invoices')
@Controller('distributor-invoices')
export class DistInvoicesController {
  constructor(private readonly service: DistInvoicesService) {}

  @Get()
  @Read('portal', 'distribution', 'finance', 'manufacturing')
  @ApiQuery({ name: 'distributorId', required: false })
  list(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.list(req.user, distributorId || undefined);
  }

  @Post()
  @Roles('Admin', 'Distribution', 'Distributor')
  @Permit('orders')
  @ApiOperation({ summary: 'Report containers distributed: a sales invoice, delivery by delivery' })
  create(@Request() req: any, @Body() dto: CreateDistInvoiceDto) {
    return this.service.create(req.user, dto);
  }

  @Post(':id/verify')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Accept the invoice: income, receivable and cost of goods post' })
  verify(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.verify(req.user, id);
  }

  @Post(':id/reject')
  @Roles(...MANAGE)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Request() req: any) {
    return this.service.reject(id, dto.reason, req.user);
  }

  @Post(':id/pay')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Record money received from the distributor against a verified invoice' })
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DistInvoicePayDto, @Request() req: any) {
    return this.service.pay(id, dto, req.user);
  }
}
