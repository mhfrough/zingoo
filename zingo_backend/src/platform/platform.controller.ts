import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Request, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Equals, IsEmail, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { DataSource, Repository } from 'typeorm';
import { Attachment } from '../attachments/attachment.entity';
import { Distributor, Manufacturer } from '../catalog/catalog.entities';
import { Company } from '../companies/company.entity';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { ROLES } from '../common/enums';
import { CompaniesService } from '../companies/companies.service';
import { clearBusinessData } from '../database/clear-data';
import { PlatformInfo } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';

/** the platform's own details (Settings > Zingo); empty text clears a line */
class UpdatePlatformDto implements PlatformInfo {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(150) tagline?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID() logoId?: string;
  @IsOptional() @IsString() @MaxLength(250) logoName?: string;
  @IsOptional() @IsString() @MaxLength(5000) address?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @ValidateIf((_, v) => !!v) @IsEmail() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(150) website?: string;
  @IsOptional() @IsString() @MaxLength(40) taxNo?: string;
}

/** the super admin types DELETE to confirm */
class ConfirmDto {
  @Equals('DELETE', { message: 'Type DELETE to confirm.' }) confirm: string;
}

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** only the super admin (the root account, not an Admin "viewing as" someone) */
function superAdminOnly(req: any) {
  if (!req.user?.isRoot || req.user?.viewAs) throw new ForbiddenException('Only the super admin can do this.');
}

/**
 * The platform (Zingoo) and the super admin's tools: the platform's name, logo and contact details, logos for every
 * page, deleting companies and clearing the business data.
 */
@ApiTags('platform')
@Controller()
export class PlatformController {
  constructor(
    private readonly settings: SettingsService,
    private readonly companies: CompaniesService,
    private readonly db: DataSource,
    @InjectRepository(Attachment) private readonly files: Repository<Attachment>,
  ) {}

  @Get('platform/identity')
  @Roles(...ROLES)
  @ApiOperation({ summary: 'Who is signed in, for the sidebar: the company, the distributor or the manufacturer' })
  async identity(@Request() req: any) {
    const u = req.user;
    const role = u.isRoot && !u.viewAs ? 'Super admin' : u.role;
    const c = await this.db.getRepository(Company).findOne({ where: { primary: true } });
    // the company that issues documents (shown on printed vouchers for every login)
    const issuer = c ? { name: c.name, logoId: c.logoId ?? null } : null;
    if (u.distributorId) {
      const d = await this.db.getRepository(Distributor).findOne({ where: { id: u.distributorId } });
      if (d) return { kind: 'distributor', name: d.name, sub: [d.code, d.region].filter(Boolean).join(' · ') || null, logoId: d.logoId ?? null, role: `Distributor · ${u.portalRole}`, issuer };
    }
    if (u.manufacturerId) {
      const m = await this.db.getRepository(Manufacturer).findOne({ where: { id: u.manufacturerId } });
      if (m) return { kind: 'manufacturer', name: m.name, sub: m.contact || null, logoId: m.logoId ?? null, role: `Manufacturer · ${u.portalRole}`, issuer };
    }
    if (c) return { kind: 'company', name: c.name, sub: [c.city, c.market === 'International' ? c.country : null].filter(Boolean).join(', ') || null, logoId: c.logoId ?? null, role, issuer };
    const p = await this.platform();
    return { kind: 'platform', name: p.name, sub: p.tagline || null, logoId: p.logoId ?? null, role, issuer };
  }

  @Public()
  @Get('platform')
  @ApiOperation({ summary: 'The platform name, logo and contact details (also before login)' })
  async platform() {
    const s = await this.settings.get();
    return { ...(s.platform ?? {}), name: s.platform?.name?.trim() || 'Zingoo' };
  }

  @Patch('platform')
  @ApiOperation({ summary: 'Super admin: change the platform details' })
  async updatePlatform(@Body() dto: UpdatePlatformDto, @Request() req: any) {
    superAdminOnly(req);
    const s = await this.settings.get();
    if (dto.logoId) await this.checkLogo(dto.logoId);
    const next: PlatformInfo = { ...(s.platform ?? {}), ...dto };
    if (!next.logoId) { delete next.logoId; delete next.logoName; }
    await this.settings.update({ platform: next });
    return this.platform();
  }

  @Public()
  @Get('logos/:id')
  @ApiOperation({ summary: 'A logo image (company, partner or platform), shown inline' })
  async logo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.files.createQueryBuilder('a').addSelect('a.data').where('a.id = :id', { id }).getOne();
    if (!a || a.ownerType !== 'logo' || !IMAGE_MIMES.includes(a.mime)) throw new NotFoundException('Logo not found.');
    res.set({
      'Content-Type': a.mime,
      'Content-Length': String(a.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'public, max-age=86400, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(a.data);
  }

  @Delete('platform/companies/:id')
  @ApiOperation({ summary: 'Super admin: delete any company, the primary one too' })
  removeCompany(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    superAdminOnly(req);
    return this.companies.removeAsSuperAdmin(id);
  }

  @Post('platform/companies/delete-all')
  @ApiOperation({ summary: 'Super admin: delete every company (type DELETE)' })
  removeAllCompanies(@Body() _dto: ConfirmDto, @Request() req: any) {
    superAdminOnly(req);
    return this.companies.removeAll();
  }

  @Post('platform/clear-data')
  @ApiOperation({ summary: 'Super admin: delete all business data, keep the setup (type DELETE)' })
  async clearData(@Body() _dto: ConfirmDto, @Request() req: any) {
    superAdminOnly(req);
    return clearBusinessData(this.db);
  }

  /** a logo must be an uploaded image marked as a logo */
  private async checkLogo(id: string) {
    const a = await this.files.findOne({ where: { id } });
    if (!a || a.ownerType !== 'logo' || !IMAGE_MIMES.includes(a.mime)) throw new ForbiddenException('Upload the logo as an image first.');
  }
}
