import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { STAFF } from '../auth/access';
import { Roles } from '../auth/roles.decorator';
import { MAX_ATTACHMENT_BYTES, AttachmentsService } from './attachments.service';

/** Roles that may add files (everyone inside the company except the read-only reviewer). */
const UPLOADERS = STAFF.filter((r) => r !== 'Viewer' && r !== 'Investor');

/** Optional: what the file will belong to. */
class UploadMeta {
  @IsOptional() @IsString() @MaxLength(30) ownerType?: string;
  @IsOptional() @IsUUID() ownerId?: string;
}

/**
 * Files (payment proofs, agreements). Upload is multipart ("file" field, 5 MB at most); download returns the
 * file itself with its type, as an attachment so a browser never runs it.
 */
@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @Post()
  @Roles(...UPLOADERS)
  @ApiOperation({ summary: 'Upload a file (image, PDF or Word document, 5 MB at most)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: UploadMeta, @Request() req: any) {
    return this.service.create(file, req.user.name, { type: body.ownerType, id: body.ownerId });
  }

  @Get(':id/meta')
  @Roles(...STAFF)
  meta(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.metaOf(id);
  }

  @Get(':id')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Download a file' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.service.content(id);
    res.set({
      'Content-Type': a.mime,
      'Content-Length': String(a.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, no-store',
    });
    res.end(a.data);
  }

  @Delete(':id')
  @Roles(...UPLOADERS)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.remove(id, req.user);
  }
}
