import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import {
  ChequeDto, CreateAccountingDto, CreateCapitalDto, CreateFinanceDto, RepaymentDto, SettleDto, SignDto,
  UpdateAccountingDto, UpdateFinanceDto,
} from './finance.dto';
import { AccountingService, FinanceService } from './finance.service';

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @Read('finance')
  @ApiOperation({ summary: 'Capital, spend and receipts, with signatures and approval state' })
  list() {
    return this.service.list();
  }

  @Get('accounts')
  @Read('finance')
  @ApiOperation({ summary: 'Accounts that can put money in: people (Settings), manufacturers and distributors' })
  accounts() {
    return this.service.investorAccounts();
  }

  @Get(':id')
  @Read('finance')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Write('finance')
  create(@Body() dto: CreateFinanceDto) {
    return this.service.create(dto);
  }

  @Post('capital-injection')
  @Write('finance')
  @ApiOperation({ summary: 'Capital injection by one investor or several, with payment details, cheque and stream split' })
  createCapital(@Body() dto: CreateCapitalDto) {
    return this.service.createCapital(dto);
  }

  @Get(':id/position')
  @Read('finance')
  @ApiOperation({ summary: 'A loan or advance now: terms, repayments, what is spent per stream, what is left' })
  position(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.position(id);
  }

  @Post(':id/repayments')
  @Write('finance')
  @ApiOperation({ summary: 'Record a repayment of a loan or advance (or the markup paid on it)' })
  repay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RepaymentDto) {
    return this.service.repay(id, dto);
  }

  @Post(':id/cheque')
  @Write('finance')
  @ApiOperation({ summary: 'Mark a capital cheque cleared (cash is posted on the clearing date) or bounced' })
  cheque(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChequeDto) {
    return this.service.markCheque(id, dto);
  }

  @Patch(':id')
  @Write('finance')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFinanceDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Write('finance')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/sign')
  @Write('finance')
  @ApiOperation({ summary: 'Sign as seat A or B (needs a matching seat on your user)' })
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SignDto, @Request() req: any) {
    return this.service.sign(id, dto.seat, req.user);
  }
}

@ApiTags('accounting')
@Controller('accounting-documents')
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  @Get()
  @Read('accounting')
  @ApiOperation({ summary: 'Income invoices and expense bills with paid, due and status' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Read('accounting')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Write('finance')
  create(@Body() dto: CreateAccountingDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Write('finance')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountingDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Write('finance')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/sign')
  @Write('finance')
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SignDto, @Request() req: any) {
    return this.service.sign(id, dto.seat, req.user);
  }

  @Post(':id/settle')
  @Write('finance')
  @ApiOperation({ summary: 'Collect an income invoice or pay an expense bill, fully or partly' })
  settle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleDto) {
    return this.service.settle(id, dto);
  }
}

@ApiTags('accounting')
@Controller('accounting-settlements')
export class SettlementsController {
  constructor(private readonly service: AccountingService) {}

  @Get()
  @Read('accounting')
  list() {
    return this.service.settlements();
  }
}
