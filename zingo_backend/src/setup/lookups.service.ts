import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CAPITAL_SOURCE_DEFAULTS, INCOTERM_DEFAULTS, PAYMENT_METHODS, STREAM_TYPE_DEFAULTS } from './setup.constants';
import { Lookup } from './setup.entities';

/** The pick-lists the client can edit on Settings & Data. */
export const LOOKUP_LISTS = ['PAY_METHOD', 'INCOTERM', 'CAPITAL_SOURCE', 'STREAM_TYPE'] as const;
export type LookupList = (typeof LOOKUP_LISTS)[number];

/** what each list calls its entries in messages */
const LIST_LABEL: Record<LookupList, string> = {
  PAY_METHOD: 'payment method', INCOTERM: 'Incoterm', CAPITAL_SOURCE: 'capital source', STREAM_TYPE: 'stream type',
};

/** The cost lines an Incoterm can put on the seller. Bank charges and other costs are always the seller's. */
export const INCOTERM_FLAGS = ['origin', 'ocean', 'insurance', 'destination', 'duty'] as const;

/** The yes / no switches each list can carry: Incoterm cost lines, loan or equity, depreciable or not. */
const LIST_FLAGS: Record<LookupList, readonly string[]> = {
  PAY_METHOD: [],
  INCOTERM: INCOTERM_FLAGS,
  CAPITAL_SOURCE: ['liability'],
  STREAM_TYPE: ['depreciable'],
};

/**
 * Editable pick-lists: payment methods, Incoterms (with the cost lines the seller carries), capital sources
 * (equity or a loan / advance) and types of investment stream (depreciable or not).
 * Documents store the code, so a code never changes or disappears: an entry is switched off instead and no
 * longer offered in new forms. Missing starting entries are added every time the API starts.
 */
@Injectable()
export class LookupsService implements OnApplicationBootstrap {
  constructor(@InjectRepository(Lookup) private readonly repo: Repository<Lookup>) {}

  async onApplicationBootstrap() {
    await this.ensureDefaults();
  }

  /**
   * Adds the starting entries of a list that has none at all (a new list on an older database).
   * A list the client already has, even an edited or emptied one, is never touched.
   */
  async ensureDefaults() {
    const have = new Set((await this.repo.find({ select: { list: true } })).map((r) => r.list));
    const rows = [
      ...(have.has('PAY_METHOD') ? [] : PAYMENT_METHODS.map((code, i) => this.repo.create({ list: 'PAY_METHOD', code, sortOrder: i }))),
      ...(have.has('INCOTERM') ? [] : INCOTERM_DEFAULTS.map((t, i) => this.repo.create({ list: 'INCOTERM', code: t.code, description: t.description, flags: t.flags, sortOrder: i }))),
      ...(have.has('CAPITAL_SOURCE') ? [] : CAPITAL_SOURCE_DEFAULTS.map((c, i) => this.repo.create({
        list: 'CAPITAL_SOURCE', code: c.code, description: c.description, flags: { liability: c.liability }, active: c.active, sortOrder: i,
      }))),
      ...(have.has('STREAM_TYPE') ? [] : STREAM_TYPE_DEFAULTS.map((t, i) => this.repo.create({
        list: 'STREAM_TYPE', code: t.code, description: t.description, flags: { depreciable: t.depreciable }, sortOrder: i,
      }))),
    ];
    if (rows.length) await this.repo.save(rows);
  }

  list(list?: string) {
    return this.repo.find({ where: list ? { list } : {}, order: { list: 'ASC', sortOrder: 'ASC', code: 'ASC' } });
  }

  async create(dto: { list: LookupList; code: string; description?: string; flags?: Record<string, boolean> }) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('Enter a name.');
    if (await this.repo.findOne({ where: { list: dto.list, code } })) throw new ConflictException('This entry already exists.');
    const last = await this.repo.find({ where: { list: dto.list }, order: { sortOrder: 'DESC' }, take: 1 });
    return this.repo.save(this.repo.create({
      list: dto.list, code, description: dto.description ?? '', flags: this.cleanFlags(dto.list, dto.flags), sortOrder: (last[0]?.sortOrder ?? -1) + 1,
    }));
  }

  async update(id: string, patch: { description?: string; flags?: Record<string, boolean>; active?: boolean }) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Entry not found');
    if (patch.active === false && (await this.repo.count({ where: { list: row.list, active: true } })) <= 1 && row.active) {
      throw new BadRequestException('Keep at least one active entry in this list.');
    }
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.flags) row.flags = this.cleanFlags(row.list as LookupList, patch.flags);
    if (patch.active !== undefined) row.active = patch.active;
    return this.repo.save(row);
  }

  /** throws unless the code is an active entry of the list (used to validate documents) */
  async assertActive(list: LookupList, code: string | undefined, em?: EntityManager) {
    if (code === undefined) return;
    const repo = em ? em.getRepository(Lookup) : this.repo;
    const row = await repo.findOne({ where: { list, code } });
    if (!row || !row.active) {
      throw new BadRequestException(`"${code}" is not an active ${LIST_LABEL[list]}. Choose one from Settings & Data.`);
    }
  }

  /** true when the capital source is a loan or an advance (money to pay back), false for equity */
  async isLiability(em: EntityManager, code: string): Promise<boolean> {
    const row = await em.getRepository(Lookup).findOne({ where: { list: 'CAPITAL_SOURCE', code } });
    return !!row?.flags?.['liability'];
  }

  /** true when the stream type loses value over time and so carries a depreciation rate */
  async isDepreciable(em: EntityManager | undefined, code: string): Promise<boolean> {
    const repo = em ? em.getRepository(Lookup) : this.repo;
    const row = await repo.findOne({ where: { list: 'STREAM_TYPE', code } });
    return !!row?.flags?.['depreciable'];
  }

  /** which cost lines the seller carries, per Incoterm code */
  async incotermFlags(em?: EntityManager): Promise<Record<string, Record<string, boolean>>> {
    const repo = em ? em.getRepository(Lookup) : this.repo;
    const rows = await repo.find({ where: { list: 'INCOTERM' } });
    return Object.fromEntries(rows.map((r) => [r.code, r.flags]));
  }

  /** only the flag names the list knows, always as booleans */
  private cleanFlags(list: LookupList, flags?: Record<string, boolean>) {
    return Object.fromEntries(LIST_FLAGS[list].map((f) => [f, !!flags?.[f]]));
  }
}
