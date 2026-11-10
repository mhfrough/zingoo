import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Read } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('dashboard')
  @Read('overview')
  @ApiOperation({ summary: 'Overview cards, alerts and latest orders' })
  dashboard() {
    return this.service.dashboard();
  }

  @Get('stock')
  @Read('overview', 'manufacturing')
  @ApiOperation({ summary: 'Cartons and packs in the warehouse per SKU' })
  stock() {
    return this.service.stock();
  }

  @Get('alerts')
  @Read('overview')
  alerts() {
    return this.service.alerts();
  }

  @Get('income-statement')
  @Read('accounting', 'ledger', 'finance')
  @ApiQuery({ name: 'period', required: false, example: 'all', description: 'all or YYYY-MM' })
  income(@Query('period') period = 'all') {
    return this.service.incomeStatement(period);
  }

  @Get('cash-flows')
  @Read('accounting', 'ledger', 'finance')
  @ApiOperation({ summary: 'Cash in and out by source, adding up to the cash balance' })
  cashFlows() {
    return this.service.cashFlows();
  }

  @Get('periods')
  @Read('accounting', 'ledger', 'finance')
  periods() {
    return this.service.periods();
  }

  @Get('trial-balance')
  @Read('accounting', 'ledger', 'finance')
  trialBalance() {
    return this.service.trialBalance();
  }

  @Get('cash-book')
  @Read('accounting', 'ledger', 'finance')
  @ApiQuery({ name: 'period', required: false })
  cashBook(@Query('period') period = 'all') {
    return this.service.cashBook(period);
  }

  @Get('journal')
  @Read('accounting', 'ledger', 'finance')
  @ApiQuery({ name: 'period', required: false })
  journal(@Query('period') period = 'all') {
    return this.service.journal(period);
  }

  @Get('receivables')
  @Read('accounting', 'ledger', 'finance', 'distribution')
  receivables() {
    return this.service.receivables();
  }

  @Get('payables')
  @Read('accounting', 'ledger', 'finance', 'manufacturing')
  payables() {
    return this.service.payables();
  }

  @Get('budgets')
  @Read('finance')
  @ApiOperation({ summary: 'Budget, spent and % used per cost center' })
  budgets() {
    return this.service.budgets();
  }
}
