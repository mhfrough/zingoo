import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { EntityManager, Repository } from 'typeorm';
import { LookupsService } from './lookups.service';
import { Account, Category, ContainerType, Currency, Lookup, Setting } from './setup.entities';
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
    const em = this.repo.manager;
    if (patch.containerSize && !(await em.findOne(ContainerType, { where: { code: patch.containerSize } }))) {
      throw new BadRequestException(`Container type ${patch.containerSize} is not set up.`);
    }
    if (patch.defaultIncoterm && !(await em.findOne(Lookup, { where: { list: 'INCOTERM', code: patch.defaultIncoterm, active: true } }))) {
      throw new BadRequestException(`${patch.defaultIncoterm} is not an active Incoterm.`);
    }
    if (patch.docPrefixes) {
      const bad = Object.entries(patch.docPrefixes).find(([, v]) => !/^[A-Za-z]{1,6}$/.test(String(v)));
      if (bad) throw new BadRequestException('A document prefix is 1 to 6 letters, for example SO.');
      patch = { ...patch, docPrefixes: { ...current.docPrefixes, ...patch.docPrefixes } };
    }
    if (patch.agingBuckets) {
      const b = patch.agingBuckets;
      if (b.length < 1 || b.length > 6 || b.some((v, i) => i > 0 && v <= b[i - 1])) {
        throw new BadRequestException('Aging limits must be 1 to 6 day counts, each larger than the one before.');
      }
    }
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

    const m = /^(Expense|Income|Capital Source|Owner Equity|Advance Receivable) · (.+)$/.exec(name);
    if (!m) throw new BadRequestException(`Unknown ledger account "${name}"`);
    // each investor gets their own account: a loan or advance a liability, equity an equity account,
    // an advance the company paid out a receivable (asset)
    const [kind, base] =
      m[1] === 'Expense' ? ['Expense', 6000]
      : m[1] === 'Income' ? ['Revenue', 4500]
      : m[1] === 'Owner Equity' ? ['Equity', 3200]
      : m[1] === 'Advance Receivable' ? ['Asset', 1700]
      : ['Liability', 2500];
    const last = await repo
      .createQueryBuilder('a')
      .select('MAX(CAST(a.code AS INT))', 'max')
      .where('a.name LIKE :p', { p: `${m[1]} · %` })
      .getRawOne();
    let next = last?.max ? Number(last.max) + 10 : base;
    // never reuse a code a fixed account already has (the next free step)
    while (await repo.findOne({ where: { code: String(next) } })) next += 10;
    const code = String(next);
    await repo.save(repo.create({ code, name, type: kind as Account['type'], active: true }));
    return code;
  }
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly repo: Repository<Category>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    private readonly lookups: LookupsService,
  ) {}

  list(kind?: string) {
    return this.repo.find({ where: kind ? { kind: kind as Category['kind'] } : {}, order: { kind: 'ASC', name: 'ASC' } });
  }

  /** a known stream type (or none) and a depreciation rate that is kept only for a depreciable type */
  private async streamFields(type: string | undefined, rate: number | undefined) {
    const streamType = (type ?? '').trim();
    if (!streamType) return { streamType: '', depreciationRate: 0 };
    await this.lookups.assertActive('STREAM_TYPE', streamType);
    const depreciable = await this.lookups.isDepreciable(undefined, streamType);
    return { streamType, depreciationRate: depreciable ? Math.round((rate ?? 0) * 100) / 100 : 0 };
  }

  async createCostCenter(name: string, budget: number, streamType?: string, depreciationRate?: number) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Enter a name.');
    const exists = await this.repo.findOne({ where: { kind: 'COST_CENTER', name: clean } });
    if (exists) throw new ConflictException('This cost center already exists.');
    return this.repo.save(this.repo.create({ kind: 'COST_CENTER', name: clean, budget, ...(await this.streamFields(streamType, depreciationRate)) }));
  }

  /** the type of an investment stream, and its depreciation rate when the type is depreciable */
  async setStream(id: string, streamType: string, depreciationRate?: number) {
    const row = await this.repo.findOne({ where: { id, kind: 'COST_CENTER' } });
    if (!row) throw new NotFoundException('Cost center not found');
    Object.assign(row, await this.streamFields(streamType, depreciationRate));
    return this.repo.save(row);
  }

  async setBudget(id: string, budget: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Category not found');
    row.budget = budget;
    return this.repo.save(row);
  }

  /** add an income or expense category (it becomes available on new invoices and bills) */
  async create(kind: 'INCOME' | 'EXPENSE', name: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Enter a name.');
    if (await this.repo.findOne({ where: { kind, name: clean } })) throw new ConflictException('This category already exists.');
    return this.repo.save(this.repo.create({ kind, name: clean, budget: 0 }));
  }

  /** how many documents use a category name (cost centers: finance entries; income / expense: accounting documents) */
  private async usage(kind: Category['kind'], name: string): Promise<number> {
    const [r] = kind === 'COST_CENTER'
      ? await this.repo.query('SELECT COUNT(*)::int AS n FROM finance_entries WHERE category = $1', [name])
      : await this.repo.query('SELECT COUNT(*)::int AS n FROM accounting_documents WHERE category = $1 AND kind = $2', [name, kind === 'INCOME' ? 'Income' : 'Expense']);
    return r.n;
  }

  /**
   * Rename a category. Documents that used the old name follow it, and so does its ledger account
   * ("Expense · Old" becomes "Expense · New") unless another category still uses that account.
   */
  async rename(id: string, name: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Enter a name.');
    return this.repo.manager.transaction(async (em) => {
      const row = await em.findOne(Category, { where: { id } });
      if (!row) throw new NotFoundException('Category not found');
      if (row.name === clean) return row;
      if (await em.findOne(Category, { where: { kind: row.kind, name: clean } })) throw new ConflictException('A category with this name already exists.');
      const old = row.name;
      if (row.kind === 'COST_CENTER') {
        await em.query('UPDATE finance_entries SET category = $1 WHERE category = $2', [clean, old]);
      } else {
        await em.query('UPDATE accounting_documents SET category = $1 WHERE category = $2 AND kind = $3', [clean, old, row.kind === 'INCOME' ? 'Income' : 'Expense']);
      }
      const family = row.kind === 'INCOME' ? ['INCOME'] : ['COST_CENTER', 'EXPENSE'];
      const sharing = await em.query('SELECT COUNT(*)::int AS n FROM categories WHERE name = $1 AND id <> $2 AND kind = ANY($3)', [old, id, family]);
      const prefix = row.kind === 'INCOME' ? 'Income' : 'Expense';
      const target = await em.findOne(Account, { where: { name: `${prefix} · ${clean}` } });
      if (!sharing[0].n && !target) await em.update(Account, { name: `${prefix} · ${old}` }, { name: `${prefix} · ${clean}` });
      row.name = clean;
      return em.save(row);
    });
  }

  /** a category that documents already use cannot be deleted (rename it instead) */
  async remove(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Category not found');
    const used = await this.usage(row.kind, row.name);
    if (used) throw new ConflictException(`${used} document(s) use "${row.name}". Rename it instead of deleting it.`);
    await this.repo.remove(row);
    return { deleted: true };
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

  /** add a currency; its rate is PKR per 1 unit */
  async addCurrency(dto: { code: string; name: string; symbol: string; rate: number }) {
    const code = dto.code.trim().toUpperCase();
    if (await this.currencies.findOne({ where: { code } })) throw new ConflictException('This currency already exists.');
    return this.currencies.save(this.currencies.create({ ...dto, code }));
  }

  /** change a name, symbol or rate; PKR is the base currency and always 1 */
  async updateCurrency(code: string, patch: { name?: string; symbol?: string; rate?: number }) {
    const c = await this.currencies.findOne({ where: { code } });
    if (!c) throw new NotFoundException('Currency not found');
    if (code === 'PKR' && patch.rate !== undefined && Math.abs(patch.rate - 1) > 0.000001) {
      throw new BadRequestException('PKR is the base currency; its rate is always 1.');
    }
    return this.currencies.save(this.currencies.merge(c, patch));
  }

  /** a currency that documents, products or manufacturers use cannot be deleted */
  async removeCurrency(code: string) {
    if (code === 'PKR') throw new BadRequestException('PKR is the base currency and cannot be deleted.');
    const c = await this.currencies.findOne({ where: { code } });
    if (!c) throw new NotFoundException('Currency not found');
    const [r] = await this.currencies.query(
      `SELECT (SELECT COUNT(*) FROM accounting_documents WHERE currency = $1) + (SELECT COUNT(*) FROM export_shipments WHERE currency = $1)
            + (SELECT COUNT(*) FROM journal_vouchers WHERE currency = $1) + (SELECT COUNT(*) FROM products WHERE currency = $1)
            + (SELECT COUNT(*) FROM manufacturers WHERE currency = $1) AS n`,
      [code],
    );
    if (Number(r.n)) throw new ConflictException('This currency is used by existing records. Change its rate instead of deleting it.');
    await this.currencies.remove(c);
    return { deleted: true };
  }

  async addContainer(dto: { code: string; maxCartons: number }) {
    const code = dto.code.trim().toUpperCase();
    if (await this.containers.findOne({ where: { code } })) throw new ConflictException('This container type already exists.');
    return this.containers.save(this.containers.create({ code, maxCartons: dto.maxCartons }));
  }

  async updateContainer(code: string, maxCartons: number) {
    const c = await this.containers.findOne({ where: { code } });
    if (!c) throw new NotFoundException('Container type not found');
    c.maxCartons = maxCartons;
    return this.containers.save(c);
  }

  /** a container type used by a quote or set as the default cannot be deleted */
  async removeContainer(code: string) {
    const c = await this.containers.findOne({ where: { code } });
    if (!c) throw new NotFoundException('Container type not found');
    const [r] = await this.containers.query(
      `SELECT (SELECT COUNT(*) FROM export_shipments WHERE container = $1) + (SELECT COUNT(*) FROM settings WHERE "containerSize" = $1) AS n`,
      [code],
    );
    if (Number(r.n)) throw new ConflictException('This container type is in use (a quote or the default). Change that first.');
    await this.containers.remove(c);
    return { deleted: true };
  }
}
