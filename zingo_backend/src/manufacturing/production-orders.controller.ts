import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MAX_ATTACHMENT_BYTES } from '../attachments/attachments.service';
import { Read, Roles, Write } from '../auth/roles.decorator';
import {
  AcceptProductionOrderDto, CreateProductionOrderDto, GroupAcceptDto, GroupReasonDto, GroupStageDto, ReasonDto, StageDto, UpdateProductionOrderDto,
} from './production-orders.dto';
import { ORDER_DOC_KINDS, OrderDocKind, ProductionOrdersService } from './production-orders.service';

/** who may attach files to an order: both partners (on their own orders) and the staff who run orders */
const DOC_WRITERS = ['Admin', 'Manufacturing', 'Distribution', 'Manufacturer', 'Distributor'] as const;

/** who may answer an order and report progress: the manufacturer itself, or staff acting for it */
const FACTORY = ['Admin', 'Manufacturing', 'Manufacturer'] as const;

/**
 * Production orders. Staff place, send and cancel them; the manufacturer (its own login, or staff for it)
 * accepts or rejects them and reports each production step. A manufacturer login only ever sees its own
 * orders, never drafts; the `manufacturerId` query is ignored for it.
 */
@ApiTags('production-orders')
@Controller('production-orders')
export class ProductionOrdersController {
  constructor(private readonly service: ProductionOrdersService) {}

  @Get()
  @Read('manufacturing', 'factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  list(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.list(req.user, manufacturerId || undefined);
  }

  @Get('profile')
  @Read('factory')
  @ApiQuery({ name: 'manufacturerId', required: false })
  @ApiOperation({ summary: 'The manufacturer a factory portal shows, with its order counts and the production stages' })
  profile(@Request() req: any, @Query('manufacturerId') manufacturerId?: string) {
    return this.service.profile(req.user, manufacturerId || undefined);
  }

  @Post(':id/documents')
  @Roles(...DOC_WRITERS)
  @ApiOperation({ summary: 'Attach a file to an order: kind CHALLAN (signed dispatch voucher), INVOICE (manufacturer invoice copy) or OTHER' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, kind: { type: 'string', enum: [...ORDER_DOC_KINDS] } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }))
  addDocument(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body('kind') kind: string) {
    if (!ORDER_DOC_KINDS.includes(kind as OrderDocKind)) throw new BadRequestException('Say what the file is: CHALLAN, INVOICE or OTHER.');
    return this.service.addDocument(req.user, id, kind as OrderDocKind, file);
  }

  @Get(':id/documents/:docId')
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiOperation({ summary: 'Download one file of an order' })
  async document(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Res() res: Response) {
    const a = await this.service.documentContent(req.user, id, docId);
    res.set({
      'Content-Type': a.mime,
      'Content-Length': String(a.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, no-store',
    });
    res.end(a.data);
  }

  @Delete(':id/documents/:docId')
  @Roles(...DOC_WRITERS)
  removeDocument(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.service.removeDocument(req.user, id, docId);
  }

  @Get(':id/detail')
  @Read('manufacturing', 'factory', 'portal', 'distribution')
  @ApiOperation({ summary: 'One order in full: timeline, loads with transport, claims and the production steps' })
  detail(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(req.user, id);
  }

  @Get(':id')
  @Read('manufacturing', 'factory')
  findOne(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user, id);
  }

  @Post()
  @Write('manufacturing')
  @ApiOperation({ summary: 'Place a production order (a draft, or sent at once with send: true)' })
  create(@Request() req: any, @Body() dto: CreateProductionOrderDto) {
    return this.service.create(req.user, dto);
  }

  @Patch(':id')
  @Write('manufacturing')
  update(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductionOrderDto) {
    return this.service.update(req.user, id, dto);
  }

  @Delete(':id')
  @Write('manufacturing')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/send')
  @Write('manufacturing')
  @ApiOperation({ summary: 'Send a draft to the manufacturer' })
  send(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.send(req.user, id);
  }

  @Post(':id/cancel')
  @Write('manufacturing')
  @ApiOperation({ summary: 'Cancel a sent or accepted order, with a reason' })
  cancel(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.cancel(req.user, id, dto);
  }

  @Post('group/accept')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'Accept every product of a combined order at once (one ready date)' })
  acceptGroup(@Request() req: any, @Body() dto: GroupAcceptDto) {
    return this.service.acceptGroup(req.user, dto);
  }

  @Post('group/reject')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'Reject every product of a combined order, with a reason' })
  rejectGroup(@Request() req: any, @Body() dto: GroupReasonDto) {
    return this.service.rejectGroup(req.user, dto);
  }

  @Post('group/stage')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'Report the production step every product of a combined order has reached' })
  stageGroup(@Request() req: any, @Body() dto: GroupStageDto) {
    return this.service.stageGroup(req.user, dto);
  }

  @Post(':id/accept')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer accepts the order (optionally with a ready date)' })
  accept(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptProductionOrderDto) {
    return this.service.accept(req.user, id, dto);
  }

  @Post(':id/reject')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer rejects the order, with a reason' })
  reject(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.service.reject(req.user, id, dto);
  }

  @Post(':id/stage')
  @Roles(...FACTORY)
  @ApiOperation({ summary: 'The manufacturer reports the production step it has reached' })
  stage(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.service.stage(req.user, id, dto);
  }
}
