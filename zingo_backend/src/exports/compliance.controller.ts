import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { STAFF } from '../auth/access';
import { Read, Roles, Write } from '../auth/roles.decorator';
import { ComplianceService } from './compliance.service';
import { ClaimDecisionDto, ClaimDto, LogisticsDto, MarketApprovalDto, ReviewDto } from './exports.dto';

class UpdateMarketApprovalDto extends PartialType(MarketApprovalDto) {}

/** Market approvals per product and country, shipment logistics and documents, export claims. */
@ApiTags('exports')
@Controller()
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  @Get('market-approvals')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Product eligibility per market: label, registration, certificates, shelf life' })
  approvals(@Query('productId') productId?: string) {
    return this.service.approvals(productId);
  }

  @Post('market-approvals')
  @Roles('Admin', 'Exports', 'Distribution')
  create(@Request() req: any, @Body() dto: MarketApprovalDto) {
    return this.service.createApproval(req.user, dto);
  }

  @Patch('market-approvals/:id')
  @Roles('Admin', 'Exports', 'Distribution')
  @ApiOperation({ summary: 'Change a market approval; it goes back for review' })
  update(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketApprovalDto) {
    return this.service.updateApproval(req.user, id, dto);
  }

  @Post('market-approvals/:id/review')
  @Roles('Admin')
  @ApiOperation({ summary: 'The compliance reviewer approves or rejects (Admin)' })
  review(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.service.reviewApproval(req.user, id, dto.decision, dto.note);
  }

  @Patch('exports/:id/logistics')
  @Write('exports')
  @ApiOperation({ summary: 'Booking, container, seal, BL, vessel, ETD / ETA, status, documents and batch' })
  logistics(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LogisticsDto) {
    return this.service.logistics(id, dto);
  }

  @Get('export-claims')
  @Read('exports', 'accounting', 'distribution')
  claims(@Query('shipmentId') shipmentId?: string, @Query('distributorId') distributorId?: string) {
    return this.service.claims(shipmentId, distributorId);
  }

  @Post('exports/:id/claims')
  @Roles('Admin', 'Exports', 'Finance', 'Distribution')
  @ApiOperation({ summary: 'Raise a damage, shortage, quality or return claim on a shipped container' })
  raise(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimDto) {
    return this.service.raise(req.user, id, dto);
  }

  @Post('export-claims/:id/decide')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Approve (credit note or replacement) or reject a claim (Finance)' })
  decide(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimDecisionDto) {
    return this.service.decide(req.user, id, dto);
  }
}
