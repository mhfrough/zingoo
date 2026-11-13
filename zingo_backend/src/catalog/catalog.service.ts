import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { AreaCity, AreaDistrict, Distributor, Manufacturer, PackagingTemplate, PartnerBankAccount, PartnerFile, Product } from './catalog.entities';
import { LookupsService } from '../setup/lookups.service';
import { StockService } from './stock.service';

@Injectable()
export class ProductsService extends CrudService<Product> {
  protected order = { sku: 'ASC' };
  protected relations = ['manufacturer', 'distributor'];

  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    private readonly stock: StockService,
    private readonly lookups: LookupsService,
  ) {
    super(repo);
  }

  /** products with the bundles in the warehouse, packets per container and the sell-out days that apply */
  async findAll() {
    const [rows, stock] = await Promise.all([super.findAll(), this.stock.stockByProduct()]);
    return rows.map((p) => this.shape(p, stock[p.id] ?? 0));
  }

  /** older products: their one packaging becomes the default template, their distributor the first of the list */
  async onApplicationBootstrap() {
    const rows = (await this.repo.find()).filter((p) => !(p.packagings ?? []).length || (p.distributorId && !(p.distributorIds ?? []).length));
    for (const p of rows) {
      if (!(p.packagings ?? []).length) p.packagings = [{ name: 'Standard', packetsPerBundle: p.packsPerCarton, bundlesPerContainer: p.bundlesPerContainer, isDefault: true }];
      if (p.distributorId && !(p.distributorIds ?? []).length) p.distributorIds = [p.distributorId];
    }
    if (rows.length) await this.repo.save(rows);
  }

  async create(dto: DeepPartial<Product>) {
    await this.check(dto, null);
    this.settle(dto, null);
    return super.create(dto);
  }

  async update(id: string, dto: DeepPartial<Product>) {
    const before = await this.repo.findOne({ where: { id } });
    await this.check(dto, before);
    this.settle(dto, before);
    return super.update(id, dto);
  }

  /**
   * Keeps the single fields in step with the lists: the default packaging template sets packets per bundle and
   * bundles per container (or the single fields make a "Standard" template), and the first distributor of the
   * list is the main one.
   */
  private settle(dto: DeepPartial<Product>, before: Product | null) {
    if (dto.sku) dto.sku = String(dto.sku).trim();
    if (dto.packagings) {
      const list = (dto.packagings as PackagingTemplate[]).map((t) => ({ ...t, name: t.name.trim() }));
      const names = new Set(list.map((t) => t.name.toLowerCase()));
      if (names.size !== list.length) throw new BadRequestException('Give each packaging template its own name.');
      const defaults = list.filter((t) => t.isDefault).length;
      if (defaults > 1) throw new BadRequestException('Only one packaging template can be the default.');
      if (!defaults) list[0].isDefault = true;
      const d = list.find((t) => t.isDefault)!;
      dto.packagings = list;
      dto.packsPerCarton = d.packetsPerBundle;
      dto.bundlesPerContainer = d.bundlesPerContainer;
    } else if (dto.packsPerCarton !== undefined || dto.bundlesPerContainer !== undefined) {
      const ppb = Number(dto.packsPerCarton ?? before?.packsPerCarton ?? 1);
      const bpc = Number(dto.bundlesPerContainer ?? before?.bundlesPerContainer ?? 10);
      const list = [...(before?.packagings ?? [])];
      const i = list.findIndex((t) => t.isDefault);
      if (i >= 0) list[i] = { ...list[i], packetsPerBundle: ppb, bundlesPerContainer: bpc };
      else list.unshift({ name: 'Standard', packetsPerBundle: ppb, bundlesPerContainer: bpc, isDefault: true });
      dto.packagings = list;
    }
    if (dto.distributorIds) {
      const ids = [...new Set(dto.distributorIds as string[])];
      dto.distributorIds = ids;
      dto.distributorId = ids[0] ?? null;
    } else if (dto.distributorId !== undefined) {
      const rest = (before?.distributorIds ?? []).filter((x) => x !== dto.distributorId);
      dto.distributorIds = dto.distributorId ? [dto.distributorId as string, ...rest] : rest;
    }
  }

  /** packets per container, and the sell-out days: the product's own, else the distributor's */
  private shape(p: Product, stockCartons: number) {
    return {
      ...p,
      stockCartons,
      packetsPerContainer: p.packsPerCarton * (p.bundlesPerContainer || 1),
      effectiveSelloutDays: p.selloutDays ?? p.distributor?.selloutDays ?? null,
    };
  }

  /**
   * Flavour and packet size must be active Settings entries (an unchanged old value is kept);
   * the assigned manufacturer and distributor must exist.
   */
  private async check(dto: DeepPartial<Product>, before: Product | null) {
    // one SKU code per product, whatever the letter case or spaces around it
    if (dto.sku) {
      const sku = String(dto.sku).trim();
      const [taken] = await this.repo.manager.query(
        `SELECT id, name FROM products WHERE lower(trim(sku)) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`, [sku, before?.id ?? null]);
      if (taken) throw new ConflictException(`SKU ${sku} is already used by ${taken.name}.`);
    }
    if (dto.flavour && dto.flavour !== before?.flavour) await this.lookups.assertActive('FLAVOUR', dto.flavour as string);
    if (dto.packetSize && dto.packetSize !== before?.packetSize) await this.lookups.assertActive('PACKET_SIZE', dto.packetSize as string);
    const em = this.repo.manager;
    if (dto.manufacturerId && !(await em.getRepository(Manufacturer).exist({ where: { id: dto.manufacturerId as string } }))) {
      throw new BadRequestException('Choose a manufacturer from Settings & Data.');
    }
    if (dto.distributorId && !(await em.getRepository(Distributor).exist({ where: { id: dto.distributorId as string } }))) {
      throw new BadRequestException('Choose a distributor from Settings & Data.');
    }
    for (const id of (dto.distributorIds as string[] | undefined) ?? []) {
      if (!(await em.getRepository(Distributor).exist({ where: { id } }))) throw new BadRequestException('Choose distributors from Settings & Data.');
    }
  }
}

@Injectable()
export class ManufacturersService extends CrudService<Manufacturer> {
  protected order = { name: 'ASC' };

  constructor(
    @InjectRepository(Manufacturer) repo: Repository<Manufacturer>,
    private readonly files: AttachmentsService,
    private readonly lookups: LookupsService,
  ) {
    super(repo);
  }

  async create(dto: DeepPartial<Manufacturer>) {
    termRules(dto);
    if (dto.bankAccounts) dto.bankAccounts = await this.cleanBanks(dto.bankAccounts as PartnerBankAccount[], []);
    const row = await super.create(dto);
    await linkFiles(this.files, 'MANUFACTURER', row.id, row.files);
    return row;
  }

  async update(id: string, dto: DeepPartial<Manufacturer>) {
    termRules(dto);
    if (dto.bankAccounts) {
      const before = await this.repo.findOne({ where: { id } });
      dto.bankAccounts = await this.cleanBanks(dto.bankAccounts as PartnerBankAccount[], before?.bankAccounts ?? []);
    }
    const row = await super.update(id, dto);
    await linkFiles(this.files, 'MANUFACTURER', row.id, row.files);
    return row;
  }

  /**
   * Bank accounts: the bank must be an active entry of the Settings list (one already saved may stay),
   * no account twice, and exactly one default (the first one when none is ticked).
   */
  private async cleanBanks(list: PartnerBankAccount[], before: PartnerBankAccount[]): Promise<PartnerBankAccount[]> {
    const out = list.map((a) => ({
      bank: a.bank.trim(), title: a.title.trim(), account: a.account.replace(/\s+/g, '').toUpperCase(),
      branch: a.branch?.trim() || undefined, isDefault: !!a.isDefault,
    }));
    const old = new Set(before.map((a) => a.bank));
    for (const a of out) if (!old.has(a.bank)) await this.lookups.assertActive('BANK', a.bank);
    const seen = new Set<string>();
    for (const a of out) {
      const key = `${a.bank}|${a.account}`;
      if (seen.has(key)) throw new BadRequestException(`${a.bank} account ${a.account} is listed twice.`);
      seen.add(key);
    }
    const defaults = out.filter((a) => a.isDefault).length;
    if (defaults > 1) throw new BadRequestException('Only one bank account can be the default.');
    if (out.length && !defaults) out[0].isDefault = true;
    return out;
  }
}

@Injectable()
export class DistributorsService extends CrudService<Distributor> {
  protected order = { name: 'ASC' };

  constructor(@InjectRepository(Distributor) repo: Repository<Distributor>, private readonly files: AttachmentsService) {
    super(repo);
  }

  /** older records: the single province and extra cities move to the new area lists once */
  async onApplicationBootstrap() {
    const rows = await this.repo.find();
    const old = rows.filter((d) => !(d.provinces ?? []).length && !(d.cities ?? []).length && !(d.countries ?? []).length && (d.province || d.region));
    for (const d of old) {
      d.provinces = d.province ? [d.province] : [];
      d.cities = [d.region, ...(d.areas ?? [])].filter(Boolean).map((name) => ({ name, province: d.province ?? '', district: null }));
    }
    if (old.length) await this.repo.save(old);
  }

  async create(dto: DeepPartial<Distributor>) {
    cleanAreas(dto, null);
    await this.checkExclusive(null, dto, null);
    const row = await super.create(dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }

  /**
   * Exclusivity: when this distributor or another one is exclusive, they may not share any area (a province
   * includes its districts and cities). A permanently suspended distributor no longer holds its areas.
   */
  private async checkExclusive(id: string | null, dto: DeepPartial<Distributor>, before: Distributor | null) {
    const me = {
      provinces: (dto.provinces ?? before?.provinces ?? []) as string[],
      districts: (dto.districts ?? before?.districts ?? []) as AreaDistrict[],
      cities: (dto.cities ?? before?.cities ?? []) as AreaCity[],
      countries: (dto.countries ?? before?.countries ?? []) as string[],
    };
    const exclusive = dto.exclusive ?? before?.exclusive ?? false;
    if ((dto.status ?? before?.status) === 'Permanent suspend') return;
    const mine = areaKeys(me);
    const others = (await this.repo.find()).filter((d) => d.id !== id && d.status !== 'Permanent suspend' && (exclusive || d.exclusive));
    for (const o of others) {
      for (const a of mine) {
        const clash = areaKeys(o).find((b) => holds(a, b) || holds(b, a));
        if (clash) {
          throw new BadRequestException(o.exclusive
            ? `${clash.label} is given exclusively to ${o.name}.`
            : `${clash.label} is already covered by ${o.name}, so it cannot be exclusive here.`);
        }
      }
    }
  }

  async update(id: string, dto: DeepPartial<Distributor>) {
    const before = await this.repo.findOne({ where: { id } });
    cleanAreas(dto, before);
    await this.checkExclusive(id, dto, before);
    if (dto.status && dto.status !== 'Temporary suspend') dto.statusUntil = null;
    const row = await super.update(id, dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }
}

/** a term not chosen has no figures: no advance term = 0% advance, no credit line = no limit and no days */
function termRules(dto: DeepPartial<Manufacturer>) {
  if (!dto.paymentTerms) return;
  const terms = [...new Set(dto.paymentTerms as string[])] as Manufacturer['paymentTerms'];
  dto.paymentTerms = terms;
  if (!terms.includes('Advance')) dto.advancePct = 0;
  if (!terms.includes('Credit line')) {
    dto.creditLimit = 0;
    dto.paymentDays = 0;
  }
}

/** one area as a comparable key: P|province, D|province|district, C|province|district|city, N|country */
type AreaKey = { level: 'P' | 'D' | 'C' | 'N'; province: string; district: string; name: string; label: string };

const norm = (s: unknown) => String(s ?? '').trim();

/**
 * Every area a distributor really covers, as keys: only the most specific choice counts. A province with
 * districts or cities picked inside it narrows down to those; a district with cities picked inside it, to them.
 */
function areaKeys(d: Pick<Distributor, 'provinces' | 'districts' | 'cities' | 'countries'>): AreaKey[] {
  const lc = (s: unknown) => String(s ?? '').toLowerCase();
  const narrowedProvince = (p: string) => (d.districts ?? []).some((x) => lc(x.province) === lc(p)) || (d.cities ?? []).some((c) => lc(c.province) === lc(p));
  const narrowedDistrict = (x: AreaDistrict) => (d.cities ?? []).some((c) => lc(c.province) === lc(x.province) && c.district === x.name);
  return [
    ...(d.provinces ?? []).filter((p) => !narrowedProvince(p)).map((p): AreaKey => ({ level: 'P', province: p, district: '', name: p, label: p })),
    ...(d.districts ?? []).filter((x) => !narrowedDistrict(x)).map((x): AreaKey => ({ level: 'D', province: x.province, district: x.name, name: x.name, label: `${x.name} district` })),
    ...(d.cities ?? []).map((c): AreaKey => ({ level: 'C', province: c.province, district: c.district ?? '', name: c.name, label: c.name })),
    ...(d.countries ?? []).map((c): AreaKey => ({ level: 'N', province: '', district: '', name: c, label: c })),
  ];
}

/** does area a include area b (a province holds its districts and cities, a district its cities) */
function holds(a: AreaKey, b: AreaKey): boolean {
  if (a.level === 'N' || b.level === 'N') return a.level === b.level && a.name.toLowerCase() === b.name.toLowerCase();
  if (a.province.toLowerCase() !== b.province.toLowerCase()) return false;
  if (a.level === 'P') return true;
  if (a.level === 'D') return b.level !== 'P' && (b.level === 'D' ? a.name === b.name : !!b.district && b.district === a.name);
  return b.level === 'C' && a.name.toLowerCase() === b.name.toLowerCase();
}

/**
 * Areas cleaned (trimmed, no blanks or repeats), a market's areas kept and the other's dropped
 * (Local: Pakistan areas; International: countries; Both: both), and a territory label for lists.
 */
function cleanAreas(dto: DeepPartial<Distributor>, before: Distributor | null) {
  const market = (dto.market ?? before?.market ?? 'Local') as Distributor['market'];
  const uniq = <T>(list: T[], key: (x: T) => string) => {
    const seen = new Set<string>();
    return list.filter((x) => {
      const k = key(x).toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  if (dto.provinces) dto.provinces = uniq((dto.provinces as string[]).map(norm), (x) => x);
  if (dto.districts) dto.districts = uniq((dto.districts as AreaDistrict[]).map((x) => ({ name: norm(x.name), province: norm(x.province) })), (x) => `${x.province}|${x.name}`);
  if (dto.cities) dto.cities = uniq((dto.cities as AreaCity[]).map((x) => ({ name: norm(x.name), province: norm(x.province), district: norm(x.district) || null })), (x) => `${x.province}|${x.name}`);
  if (dto.countries) dto.countries = uniq((dto.countries as string[]).map(norm), (x) => x);
  if (market === 'Local' && (dto.market || dto.countries)) dto.countries = [];
  if (market === 'International' && (dto.market || dto.provinces || dto.districts || dto.cities)) {
    dto.provinces = [];
    dto.districts = [];
    dto.cities = [];
  }
  const pick = <K extends keyof Distributor>(k: K) => (dto[k] as Distributor[K] | undefined) ?? before?.[k];
  const label = norm(dto.region)
    || (pick('cities') as AreaCity[] | undefined)?.[0]?.name
    || (pick('districts') as AreaDistrict[] | undefined)?.[0]?.name
    || (pick('provinces') as string[] | undefined)?.[0]
    || (pick('countries') as string[] | undefined)?.[0]
    || before?.region;
  if (!label) throw new BadRequestException('Choose at least one area the distributor covers.');
  dto.region = label.slice(0, 80);
}

/** marks a partner's uploaded files as theirs, so only an Admin can delete them later */
async function linkFiles(files: AttachmentsService, ownerType: string, ownerId: string, list: PartnerFile[] | undefined) {
  for (const f of list ?? []) await files.attach(f.id, ownerType, ownerId);
}
