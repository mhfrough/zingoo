import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Request } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Roles } from '../auth/roles.decorator';
import { ROLES, Role } from '../common/enums';
import { REF_KINDS, RefKind, nextNumber, refTaken } from '../common/ref';
import { SettingsService } from './setup.service';

/** which number kinds a partner login may ask about: a distributor its order numbers, a manufacturer its invoice numbers */
const PARTNER_KINDS: Partial<Record<Role, RefKind[]>> = { Distributor: ['distOrder'], Manufacturer: ['mfrInvoice'] };

/**
 * Document numbers a form shows before saving: the next one (MO-027, DO-012, SKU-004, PR-009), which the person may
 * change, and a check that a typed number is not used already. Saving checks again, so two people cannot take one.
 */
@ApiTags('Settings & data')
@Controller('refs')
@Roles(...ROLES)
export class RefsController {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly settings: SettingsService) {}

  private kind(kind: string, user: { role: Role }): RefKind {
    if (!(kind in REF_KINDS)) throw new BadRequestException('Unknown number kind.');
    const allowed = PARTNER_KINDS[user.role];
    if (['Distributor', 'Manufacturer'].includes(user.role) && !allowed?.includes(kind as RefKind)) throw new ForbiddenException('Your role does not allow this.');
    return kind as RefKind;
  }

  @Get('next/:kind')
  @ApiOperation({ summary: 'The next document number of a kind (production, distOrder, product, mfrInvoice)' })
  async next(@Param('kind') kind: string, @Request() req: { user: { role: Role } }) {
    const k = this.kind(kind, req.user);
    const s = await this.settings.get();
    return { next: await nextNumber(this.db.manager, k, s.docPrefixes) };
  }

  @Get('check/:kind')
  @ApiOperation({ summary: 'Whether a typed document number is already used' })
  async check(@Param('kind') kind: string, @Query('value') value: string, @Query('except') except: string | undefined, @Request() req: { user: { role: Role } }) {
    const k = this.kind(kind, req.user);
    const v = String(value ?? '').trim();
    if (!v) return { taken: false };
    return { taken: await refTaken(this.db.manager, k, v, except || null) };
  }
}
