import { BadRequestException, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
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
    if (await this.repo.count()) return;
    const s = await this.settings.get();
    await this.repo.save(this.repo.create({ name: s.companyName, primary: true, active: true }));
  }

  private async followSettings() {
    const [s, primary] = await Promise.all([this.settings.get(), this.repo.findOne({ where: { primary: true } })]);
    if (primary && primary.name !== s.companyName) await this.repo.update({ id: primary.id }, { name: s.companyName });
  }

  async create(dto: DeepPartial<Company>) {
    const first = !(await this.repo.count());
    const row = await super.create({ ...dto, primary: first || !!dto.primary, active: first || dto.primary ? true : dto.active ?? true });
    if (row.primary) await this.makePrimary(row);
    return row;
  }

  async update(id: string, dto: DeepPartial<Company>) {
    const before = await this.findOne(id);
    if (before.primary && dto.primary === false) throw new BadRequestException('Make another company primary first.');
    if ((before.primary || dto.primary) && dto.active === false) throw new BadRequestException('The primary company stays active.');
    const row = await super.update(id, dto);
    if (row.primary) await this.makePrimary(row);
    return row;
  }

  async remove(id: string) {
    const row = await this.findOne(id);
    if (row.primary) throw new BadRequestException('The primary company cannot be deleted. Make another company primary first.');
    return super.remove(id);
  }

  /** the one primary company; its name becomes the company name in Settings */
  private async makePrimary(row: Company) {
    await this.repo.update({ id: Not(row.id), primary: true }, { primary: false });
    const s = await this.settings.get();
    if (s.companyName !== row.name) await this.settings.update({ companyName: row.name });
  }
}
