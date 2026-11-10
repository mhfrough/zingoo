import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { INCOTERM_DEFAULTS, PAYMENT_METHODS } from './setup.constants';
import { Lookup } from './setup.entities';

/** The pick-lists the client can edit on Settings & Data. */
export const LOOKUP_LISTS = ['PAY_METHOD', 'INCOTERM'] as const;
export type LookupList = (typeof LOOKUP_LISTS)[number];

/** The cost lines an Incoterm can put on the seller. Bank charges and other costs are always the seller's. */
export const INCOTERM_FLAGS = ['origin', 'ocean', 'insurance', 'destination', 'duty'] as const;

/**
 * Editable pick-lists: payment methods and Incoterms (with the cost lines the seller carries).
 * Documents store the code, so a code never changes or disappears: an entry is switched off instead and no
 * longer offered in new forms. Missing starting entries are added every time the API starts.
 */
@Injectable()
export class LookupsService implements OnApplicationBootstrap {
  constructor(@InjectRepository(Lookup) private readonly repo: Repository<Lookup>) {}

  async onApplicationBootstrap() {
    await this.ensureDefaults();
  }

  /** adds the starting entries that are not there yet (never changes or re-adds one the client edited) */
  async ensureDefaults() {
    if ((await this.repo.count()) > 0) return;
    await this.repo.save([
      ...PAYMENT_METHODS.map((code, i) => this.repo.create({ list: 'PAY_METHOD', code, sortOrder: i })),
      ...INCOTERM_DEFAULTS.map((t, i) => this.repo.create({ list: 'INCOTERM', code: t.code, description: t.description, flags: t.flags, sortOrder: i })),
    ]);
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
      throw new BadRequestException(`"${code}" is not an active ${list === 'PAY_METHOD' ? 'payment method' : 'Incoterm'}. Choose one from Settings & Data.`);
    }
  }

  /** which cost lines the seller carries, per Incoterm code */
  async incotermFlags(em?: EntityManager): Promise<Record<string, Record<string, boolean>>> {
    const repo = em ? em.getRepository(Lookup) : this.repo;
    const rows = await repo.find({ where: { list: 'INCOTERM' } });
    return Object.fromEntries(rows.map((r) => [r.code, r.flags]));
  }

  /** only the known flag names, always as booleans (Incoterms only) */
  private cleanFlags(list: LookupList, flags?: Record<string, boolean>) {
    if (list !== 'INCOTERM') return {};
    return Object.fromEntries(INCOTERM_FLAGS.map((f) => [f, !!flags?.[f]]));
  }
}
