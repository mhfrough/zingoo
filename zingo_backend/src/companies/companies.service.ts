import { BadRequestException, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { Currency } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import { Company } from './company.entity';

/**
 * The companies of the group. Exactly one is primary and active; its name is kept as the company name in Settings.
 * The first company is made from Settings when the API starts on a database that has none.
 */
@Injectable()
export class CompaniesService extends CrudService<Company> implements OnApplicationBootstrap {
  protected order = { primary: 'DESC', name: 'ASC' };

  constructor(@InjectRepository(Company) repo: Repository<Company>, private readonly settings: SettingsService) {
    super(repo);
  }

  async onApplicationBootstrap() {
    // the company name changed on Settings: the primary company follows
    this.settings.changed$.subscribe(() => void this.followSettings().catch(() => undefined));
    // the first start makes the starting company from Settings, once: the super admin may later delete every company
    const s = await this.settings.get();
    if (s.setupDone) return;
    if (!(await this.repo.count())) await this.repo.save(this.repo.create({ name: s.companyName, primary: true, active: true }));
    await this.settings.update({ setupDone: true });
  }

  private async followSettings() {
    const [s, primary] = await Promise.all([this.settings.get(), this.repo.findOne({ where: { primary: true } })]);
    if (primary && primary.name !== s.companyName) await this.repo.update({ id: primary.id }, { name: s.companyName });
  }

  /** a local company is in Pakistan; an international one names its country; the currency must be on Settings */
  private async clean(dto: DeepPartial<Company>, before?: Company) {
    const market = dto.market ?? before?.market ?? 'Local';
    if (market === 'Local') {
      dto.country = 'Pakistan';
      dto.region = '';
    } else if (dto.market !== undefined || dto.country !== undefined) {
      const country = String(dto.country ?? before?.country ?? '').trim();
      if (!country || country === 'Pakistan') throw new BadRequestException('Choose the country of an international company.');
      dto.country = country;
    }
    if (dto.currency !== undefined) {
      dto.currency = String(dto.currency).toUpperCase();
      if (!(await this.repo.manager.findOne(Currency, { where: { code: dto.currency } }))) {
        throw new BadRequestException(`Currency ${dto.currency} is not on Settings & Data. Add it there first.`);
      }
    }
    return dto;
  }

  async create(dto: DeepPartial<Company>) {
    await this.clean(dto);
    const first = !(await this.repo.count());
    const row = await super.create({ ...dto, primary: first || !!dto.primary, active: first || dto.primary ? true : dto.active ?? true });
    if (row.primary) await this.makePrimary(row);
    return row;
  }

  async update(id: string, dto: DeepPartial<Company>) {
    const before = await this.findOne(id);
    if (before.primary && dto.primary === false) throw new BadRequestException('Make another company primary first.');
    if ((before.primary || dto.primary) && dto.active === false) throw new BadRequestException('The primary company stays active.');
    await this.clean(dto, before);
    const row = await super.update(id, dto);
    if (row.primary) await this.makePrimary(row);
    return row;
  }

  async remove(id: string) {
    const row = await this.findOne(id);
    if (row.primary) throw new BadRequestException('The primary company cannot be deleted. Make another company primary first.');
    return super.remove(id);
  }

  /**
   * Super admin: delete any company, the primary one too. The next active company (else any) becomes primary; with
   * none left, the platform name (Settings > Zingo) names the business.
   */
  async removeAsSuperAdmin(id: string) {
    const row = await this.findOne(id);
    await this.repo.remove(row);
    if (row.primary) await this.promoteNext();
    return { deleted: true };
  }

  /** super admin: delete every company of the group */
  async removeAll() {
    const n = await this.repo.count();
    await this.repo.clear();
    await this.promoteNext();
    return { deleted: n };
  }

  private async promoteNext() {
    const next = (await this.repo.findOne({ where: { active: true }, order: { name: 'ASC' } })) ?? (await this.repo.findOne({ where: {}, order: { name: 'ASC' } }));
    if (next) {
      await this.repo.update({ id: next.id }, { primary: true, active: true });
      return this.makePrimary({ ...next, primary: true });
    }
    const s = await this.settings.get();
    const name = s.platform?.name?.trim() || 'Zingoo';
    if (s.companyName !== name) await this.settings.update({ companyName: name });
  }

  /** the one primary company; its name becomes the company name in Settings */
  private async makePrimary(row: Company) {
    await this.repo.update({ id: Not(row.id), primary: true }, { primary: false });
    const s = await this.settings.get();
    if (s.companyName !== row.name) await this.settings.update({ companyName: row.name });
  }
}
