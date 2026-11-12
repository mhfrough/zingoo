import { BadRequestException, Injectable } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { CrudService } from '../common/crud.service';
import { Distributor, Manufacturer, PartnerBankAccount, PartnerFile, Product } from './catalog.entities';
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

  async create(dto: DeepPartial<Product>) {
    await this.check(dto, null);
    return super.create(dto);
  }

  async update(id: string, dto: DeepPartial<Product>) {
    await this.check(dto, await this.repo.findOne({ where: { id } }));
    return super.update(id, dto);
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
    if (dto.flavour && dto.flavour !== before?.flavour) await this.lookups.assertActive('FLAVOUR', dto.flavour as string);
    if (dto.packetSize && dto.packetSize !== before?.packetSize) await this.lookups.assertActive('PACKET_SIZE', dto.packetSize as string);
    const em = this.repo.manager;
    if (dto.manufacturerId && !(await em.getRepository(Manufacturer).exist({ where: { id: dto.manufacturerId as string } }))) {
      throw new BadRequestException('Choose a manufacturer from Settings & Data.');
    }
    if (dto.distributorId && !(await em.getRepository(Distributor).exist({ where: { id: dto.distributorId as string } }))) {
      throw new BadRequestException('Choose a distributor from Settings & Data.');
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
    if (dto.bankAccounts) dto.bankAccounts = await this.cleanBanks(dto.bankAccounts as PartnerBankAccount[], []);
    const row = await super.create(dto);
    await linkFiles(this.files, 'MANUFACTURER', row.id, row.files);
    return row;
  }

  async update(id: string, dto: DeepPartial<Manufacturer>) {
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

  async create(dto: DeepPartial<Distributor>) {
    cleanAreas(dto);
    const row = await super.create(dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }

  async update(id: string, dto: DeepPartial<Distributor>) {
    cleanAreas(dto);
    const row = await super.update(id, dto);
    await linkFiles(this.files, 'DISTRIBUTOR', row.id, row.files);
    return row;
  }
}

/** covered areas: trimmed, no blanks, no repeats, not the main city again */
function cleanAreas(dto: DeepPartial<Distributor>) {
  if (!dto.areas) return;
  const main = String(dto.region ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  dto.areas = (dto.areas as string[]).map((a) => a.trim()).filter((a) => {
    const k = a.toLowerCase();
    if (!a || k === main || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** marks a partner's uploaded files as theirs, so only an Admin can delete them later */
async function linkFiles(files: AttachmentsService, ownerType: string, ownerId: string, list: PartnerFile[] | undefined) {
  for (const f of list ?? []) await files.attach(f.id, ownerType, ownerId);
}
