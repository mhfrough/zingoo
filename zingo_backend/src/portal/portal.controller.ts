import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import {
  AcceptRequestDto, CreateAdviceDto, CreateReceiptDto, CreateRequestDto, ReviewDto,
} from './portal.dto';
import { PortalService } from './portal.service';

/** Roles that manage the distributor flows (accept requests, review claims). */
const MANAGE = ['Admin', 'Finance', 'Distribution'] as const;

/**
 * Distributor partner portal. A Distributor login sees only its own distributor (the `distributorId` query is ignored);
 * staff pass `?distributorId=` to look at one.
 */
@ApiTags('portal')
@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  // ── reads ──

  @Get('profile')
  @Read('portal')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiOperation({ summary: 'Account position, open tasks and the payment methods offered' })
  async profile(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.profile(await this.service.scope(req.user, distributorId));
  }

  @Get('orders')
  @Read('portal')
  async orders(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.ordersOf(await this.service.scope(req.user, distributorId));
  }

  @Get('requests')
  @Read('portal')
  async requests(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.requestsOf(await this.service.scope(req.user, distributorId));
  }

  @Get('receipts')
  @Read('portal')
  async receipts(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.receiptsOf(await this.service.scope(req.user, distributorId));
  }

  @Get('advices')
  @Read('portal')
  async advices(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.advicesOf(await this.service.scope(req.user, distributorId));
  }

  @Get('rates')
  @Read('portal')
  async rates(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.rates(await this.service.scope(req.user, distributorId));
  }

  @Get('statement')
  @Read('portal')
  async statement(@Request() req: any, @Query('distributorId') distributorId?: string) {
    return this.service.statement(await this.service.scope(req.user, distributorId));
  }

  @Get('desk')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Requests, payment advices and claims waiting for Zingoo, across distributors' })
  desk() {
    return this.service.desk();
  }

  @Get('receipts/:id/evidence')
  @Read('portal')
  receiptEvidence(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.attachment('receipt', id, req.user);
  }

  @Get('advices/:id/proof')
  @Read('portal')
  advanceProof(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.attachment('advice', id, req.user);
  }

  // ── distributor (or staff on its behalf) ──

  @Post('requests')
  @Read('portal')
  @Permit('orders')
  @ApiOperation({ summary: 'Ask for stock; Zingoo reviews it before a sales order is made' })
  createRequest(@Body() dto: CreateRequestDto, @Request() req: any) {
    return this.service.createRequest(dto, req.user);
  }

  @Post('receipts')
  @Read('portal')
  @Permit('receipts')
  @ApiOperation({ summary: 'Proof of delivery with good / damaged / missing cartons' })
  createReceipt(@Body() dto: CreateReceiptDto, @Request() req: any) {
    return this.service.createReceipt(dto, req.user);
  }

  @Post('advices')
  @Read('portal')
  @Permit('payments')
  @ApiOperation({ summary: 'Tell Zingo about a payment; it becomes cash only when staff confirm it' })
  createAdvice(@Body() dto: CreateAdviceDto, @Request() req: any) {
    return this.service.createAdvice(dto, req.user);
  }

  // ── staff ──

  @Post('requests/:id/accept')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Accept a request: creates a draft sales order with the price and terms locked' })
  accept(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptRequestDto, @Request() req: any) {
    return this.service.acceptRequest(id, dto, req.user);
  }

  @Post('requests/:id/reject')
  @Roles(...MANAGE)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Request() req: any) {
    return this.service.rejectRequest(id, dto.note, req.user);
  }

  @Post('receipts/:id/approve')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Approve a damage / shortage claim: posts a credit note' })
  approveClaim(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.approveClaim(id, req.user);
  }

  @Post('receipts/:id/reject')
  @Roles(...MANAGE)
  rejectClaim(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Request() req: any) {
    return this.service.rejectClaim(id, dto.note, req.user);
  }

  @Post('advices/:id/confirm')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Verify the money: creates the collection, so cash and receivables update' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.confirmAdvice(id, req.user);
  }

  @Post('advices/:id/reject')
  @Roles('Admin', 'Finance')
  rejectAdvice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Request() req: any) {
    return this.service.rejectAdvice(id, dto.note, req.user);
  }
}
