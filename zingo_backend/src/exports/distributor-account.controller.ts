import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Roles, Write } from '../auth/roles.decorator';
import { DistributorAccountService } from './distributor-account.service';
import { AllocateDto, CreditOverrideDto, RemittanceDto } from './exports.dto';
import { ExportsService } from './exports.service';

/** An international distributor's account: orders, invoices, remittances, aging, statement and credit. */
@ApiTags('distributors')
@Controller()
export class DistributorAccountController {
  constructor(private readonly service: DistributorAccountService, private readonly exports: ExportsService) {}

  @Get('distributors/:id/account')
  @Read('exports', 'accounting', 'ledger', 'distribution')
  @ApiOperation({ summary: 'Orders, invoices, remittances, aging per currency, running statement and credit position' })
  account(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.account(id);
  }

  @Post('distributors/:id/remittances')
  @Write('exports')
  @ApiOperation({ summary: 'Money the distributor sent; applied to the invoices given, the rest kept as its credit' })
  remit(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemittanceDto) {
    return this.service.remit(req.user, id, dto);
  }

  @Post('distributors/:id/remittances/:remittanceId/allocate')
  @Write('exports')
  @ApiOperation({ summary: 'Apply money not yet used to invoices' })
  allocate(@Param('id', ParseUUIDPipe) id: string, @Param('remittanceId', ParseUUIDPipe) remittanceId: string, @Body() dto: AllocateDto) {
    return this.service.allocate(id, remittanceId, dto.allocations);
  }

  @Post('exports/:id/credit-override')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Let one order ship over the credit limit or with invoices overdue (Finance)' })
  override(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditOverrideDto) {
    return this.exports.creditOverride(req.user, id, dto.reason);
  }
}
