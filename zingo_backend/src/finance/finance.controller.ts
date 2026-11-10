import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import {
  CreateAccountingDto, CreateFinanceDto, SettleDto, SignDto, UpdateAccountingDto, UpdateFinanceDto,
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
