import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles, Write } from '../auth/roles.decorator';
import { DistributorAccountService } from './distributor-account.service';
import { AllocateDto, ClaimDto, CreditOverrideDto, RejectAdviceDto, RemittanceAdviceDto, RemittanceDto } from './exports.dto';
import { ComplianceService } from './compliance.service';
import { ExportsService } from './exports.service';

/** An international distributor's account: orders, invoices, remittances, aging, statement and credit. */
@ApiTags('distributors')
@Controller()
export class DistributorAccountController {
  constructor(private readonly service: DistributorAccountService, private readonly exports: ExportsService, private readonly compliance: ComplianceService) {}

  // ───────────── the distributor's own portal ─────────────

  @Get('portal/intl/account')
  @Roles('Distributor')
  @ApiOperation({ summary: 'Your orders, invoices, due dates, aging, payments, claims and statement (no internal costs)' })
  myAccount(@Request() req: any) {
    return this.service.portalAccount(req.user.distributorId);
  }

  @Get('portal/intl/prices')
  @Roles('Distributor')
  @ApiOperation({ summary: 'Your agreed prices that apply now or later' })
  myPrices(@Request() req: any) {
    return this.service.portalPrices(req.user.distributorId);
  }

  @Get('portal/intl/notifications')
  @Roles('Distributor')
  myNotifications(@Request() req: any) {
    return this.service.notifications(req.user.distributorId);
  }

  @Post('portal/intl/advices')
  @Roles('Distributor')
  @Permit('payments')
  @ApiOperation({ summary: 'Tell us you paid, with the bank proof' })
  advise(@Request() req: any, @Body() dto: RemittanceAdviceDto) {
    return this.service.advise(req.user, dto);
  }

  @Post('portal/intl/shipments/:id/claims')
  @Roles('Distributor')
  @Permit('claims')
  @ApiOperation({ summary: 'Raise a damage, shortage, quality or return claim on your shipment' })
  claim(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimDto) {
    return this.compliance.raise(req.user, id, dto);
  }

  @Post('remittance-advices/:id/reject')
  @Roles('Admin', 'Finance')
  rejectAdvice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectAdviceDto) {
    return this.service.rejectAdvice(req.user, id, dto.note);
  }

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
