import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permit, Read, Roles } from '../auth/roles.decorator';
import { ClaimNoteDto, CreateDeliveryClaimDto, DecideDeliveryClaimDto } from './delivery-claims.dto';
import { DeliveryClaimsService } from './delivery-claims.service';

/**
 * Faulty goods in a manufacturer's delivery: the distributor raises, the manufacturer decides, Zen Foods sees all.
 * Partner logins see only their own claims; the filters are for staff.
 */
@ApiTags('delivery-claims')
@Controller('delivery-claims')
export class DeliveryClaimsController {
  constructor(private readonly service: DeliveryClaimsService) {}

  @Get()
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiQuery({ name: 'distributorId', required: false })
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('distributorId') distributorId?: string, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, { distributorId: distributorId || undefined, manufacturerId: manufacturerId || undefined });
  }

  @Post()
  @Roles('Admin', 'Distribution', 'Distributor')
  @Permit('claims')
  @ApiOperation({ summary: 'Report damaged, missing or poor-quality bundles in a received delivery' })
  create(@Request() req: any, @Body() dto: CreateDeliveryClaimDto) {
    return this.service.create(req.user, dto);
  }

  @Post(':id/decide')
  @Roles('Admin', 'Manufacturing', 'Manufacturer')
  @ApiOperation({ summary: 'The manufacturer\'s Owner / Manager accepts (credit or replacement), rejects or holds it, with a reason' })
  decide(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDeliveryClaimDto) {
    return this.service.decide(req.user, id, dto);
  }

  @Post(':id/notes')
  @Roles('Admin', 'Manufacturing', 'Distribution', 'Manufacturer', 'Distributor')
  @Permit('claims')
  @ApiOperation({ summary: 'Add a message to the claim\'s thread (distributor, manufacturer, Zen Foods)' })
  addNote(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimNoteDto) {
    return this.service.addNote(req.user, id, dto.text);
  }

  @Get(':id/proofs/:fileId')
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiOperation({ summary: 'Download one proof photo / PDF of a claim' })
  async proof(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const a = await this.service.proof(req.user, id, fileId);
    res.set({
      'Content-Type': a.mime,
      'Content-Length': String(a.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, no-store',
    });
    res.end(a.data);
  }

  @Get(':id/evidence')
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  evidence(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.evidence(req.user, id);
  }
}
