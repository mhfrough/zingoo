import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import {
  CreateExportDto, ExportCostPaymentDto, ExportReceiptDto, ShipExportDto, UpdateExportDto,
} from './exports.dto';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  @Get()
  @Read('exports', 'accounting', 'ledger')
  @ApiOperation({ summary: 'Container quotes and shipments with costing, collected and due' })
  list() {
    return this.service.list();
  }

  @Get('receipts')
  @Read('exports', 'accounting', 'ledger')
  receipts() {
    return this.service.receipts();
  }

  @Get('cost-payments')
  @Read('exports', 'accounting', 'ledger')
  costPayments() {
    return this.service.costPayments();
  }

  @Get(':id')
  @Read('exports', 'accounting', 'ledger')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Write('exports')
  create(@Body() dto: CreateExportDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Write('exports')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExportDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Write('exports')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/ship')
  @Write('exports')
  @ApiOperation({ summary: 'Ship a quote: freezes the goods cost and posts invoice, cost and logistics' })
  ship(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipExportDto) {
    return this.service.ship(id, dto.shipDate);
  }

  @Post(':id/collect')
  @Write('exports')
  @ApiOperation({ summary: 'Foreign-currency receipt; the difference to the invoice rate is FX gain or loss' })
  collect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExportReceiptDto) {
    return this.service.collect(id, dto);
  }

  @Post(':id/pay-costs')
  @Write('exports')
  @ApiOperation({ summary: 'Pay the seller-side logistics costs (PKR)' })
  payCosts(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExportCostPaymentDto) {
    return this.service.payCosts(id, dto);
  }
}
