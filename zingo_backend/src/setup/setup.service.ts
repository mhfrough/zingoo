import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { EntityManager, Repository } from 'typeorm';
import { Account, Category, ContainerType, Currency, Setting } from './setup.entities';
import { DEFAULT_SETTINGS } from './setup.constants';

@Injectable()
export class SettingsService {
  /** fires after settings change, so approval-dependent postings can be re-checked */
  readonly changed$ = new Subject<void>();

  constructor(@InjectRepository(Setting) private readonly repo: Repository<Setting>) {}

  async get(em?: EntityManager): Promise<Setting> {
    const repo = em ? em.getRepository(Setting) : this.repo;
    const found = await repo.findOne({ where: { id: 1 } });
    return found ?? repo.save(repo.create({ id: 1, ...DEFAULT_SETTINGS }));
  }

  async update(patch: Partial<Setting>) {
    const current = await this.get();
    const next = await this.repo.save(this.repo.merge(current, { ...patch, id: 1 }));
    this.changed$.next();
    return next;
  }
}

@Injectable()
export class AccountsService {
  constructor(@InjectRepository(Account) private readonly repo: Repository<Account>) {}

  list() {
    return this.repo.find({ order: { code: 'ASC' } });
  }

  /** add an account; the code and the name must both be new */
  async create(dto: { code: string; name: string; type: Account['type'] }) {
    if (await this.repo.findOne({ where: [{ code: dto.code }, { name: dto.name }] })) {
      throw new ConflictException('An account with this code or name already exists.');
    }
    return this.repo.save(this.repo.create({ ...dto, active: true }));
  }

  /** rename or switch off; a used account keeps its postings */
  async update(id: string, patch: { name?: string; active?: boolean }) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Account not found');
    if (patch.name && patch.name !== a.name && (await this.repo.findOne({ where: { name: patch.name } }))) {
      throw new ConflictException('An account with this name already exists.');
    }
    return this.repo.save(this.repo.merge(a, patch));
  }

  /**
   * Account code for a ledger account name. "Expense · X" and "Income · X" accounts are
   * created on first use, so a new cost center or category just works.
   */
  async codeFor(em: EntityManager, name: string): Promise<string> {
    const repo = em.getRepository(Account);
    const found = await repo.findOne({ where: { name } });
    if (found) return found.code;

    const m = /^(Expense|Income) · (.+)$/.exec(name);
    if (!m) throw new BadRequestException(`Unknown ledger account "${name}"`);
    const [kind, base] = m[1] === 'Expense' ? ['Expense', 6000] : ['Revenue', 4500];
    const last = await repo
      .createQueryBuilder('a')
      .select('MAX(CAST(a.code AS INT))', 'max')
      .where('a.name LIKE :p', { p: `${m[1]} · %` })
      .getRawOne();
    const code = String(last?.max ? Number(last.max) + 10 : base);
    await repo.save(repo.create({ code, name, type: kind as Account['type'], active: true }));
    return code;
  }
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly repo: Repository<Category>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
  ) {}

  list(kind?: string) {
    return this.repo.find({ where: kind ? { kind: kind as Category['kind'] } : {}, order: { kind: 'ASC', name: 'ASC' } });
  }

  async createCostCenter(name: string, budget: number) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Enter a name.');
    const exists = await this.repo.findOne({ where: { kind: 'COST_CENTER', name: clean } });
    if (exists) throw new ConflictException('This cost center already exists.');
    return this.repo.save(this.repo.create({ kind: 'COST_CENTER', name: clean, budget }));
  }

  async setBudget(id: string, budget: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Category not found');
    row.budget = budget;
    return this.repo.save(row);
  }
}

@Injectable()
export class CatalogListsService {
  constructor(
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    @InjectRepository(ContainerType) private readonly containers: Repository<ContainerType>,
  ) {}

  currencyList() {
    return this.currencies.find({ order: { code: 'ASC' } });
  }

  containerList() {
    return this.containers.find({ order: { code: 'ASC' } });
  }
}
