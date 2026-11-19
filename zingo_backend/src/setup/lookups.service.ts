import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Attachment } from '../attachments/attachment.entity';
import { Distributor, Manufacturer } from '../catalog/catalog.entities';
import { plainText } from '../common/plain-text';
import { CAPITAL_SOURCE_DEFAULTS, INCOTERM_DEFAULTS, KYC_REQUIRED, PAYMENT_METHODS, SIMPLE_LIST_DEFAULTS, STREAM_TYPE_DEFAULTS } from './setup.constants';
import { Lookup } from './setup.entities';

/** The simple pick-lists of the loan and advance forms: just a name (and a note), no switches. */
export const SIMPLE_LISTS = ['LOAN_TENURE', 'REPAY_PLAN', 'REPAY_FREQUENCY', 'ADVANCE_PURPOSE', 'SETTLEMENT_METHOD', 'BANK_ACCOUNT', 'DELIVERY_STATUS', 'BILL_TYPE', 'BILL_TREATMENT', 'APPROVER', 'FLAVOUR', 'PACKET_SIZE', 'BANK', 'ORDER_STAGE', 'DIST_CLASSIFICATION', 'KYC_DOC_TYPE', 'REMITTANCE_METHOD', 'CERT_TYPE', 'EXPORT_DOC_TYPE', 'CONTAINER_UNIT', 'TRANSPORT_UNIT'] as const;

/** The pick-lists the client can edit on Settings & Data. */
export const LOOKUP_LISTS = ['PAY_METHOD', 'INCOTERM', 'CAPITAL_SOURCE', 'STREAM_TYPE', 'PERSON', ...SIMPLE_LISTS] as const;
export type LookupList = (typeof LOOKUP_LISTS)[number];

/** what each list calls its entries in messages */
const LIST_LABEL: Record<LookupList, string> = {
  PAY_METHOD: 'payment method', INCOTERM: 'Incoterm', CAPITAL_SOURCE: 'capital source', STREAM_TYPE: 'stream type', PERSON: 'investor account',
  LOAN_TENURE: 'loan tenure', REPAY_PLAN: 'repayment plan', REPAY_FREQUENCY: 'repayment frequency', ADVANCE_PURPOSE: 'advance purpose',
  SETTLEMENT_METHOD: 'settlement method', BANK_ACCOUNT: 'bank or cash account', DELIVERY_STATUS: 'delivery status', BILL_TYPE: 'bill type', BILL_TREATMENT: 'accounting treatment', APPROVER: 'approver',
  FLAVOUR: 'flavour', PACKET_SIZE: 'packet size', BANK: 'bank', ORDER_STAGE: 'production stage', DIST_CLASSIFICATION: 'distributor classification', KYC_DOC_TYPE: 'KYC document type', REMITTANCE_METHOD: 'remittance method', CERT_TYPE: 'certificate type', EXPORT_DOC_TYPE: 'export document type', CONTAINER_UNIT: 'container unit', TRANSPORT_UNIT: 'transport unit',
};

/** The cost lines an Incoterm can put on the seller. Bank charges and other costs are always the seller's. */
export const INCOTERM_FLAGS = ['origin', 'ocean', 'insurance', 'destination', 'duty'] as const;

/** The free-text fields each list can carry (an investor account: company and point of contact). */
const LIST_META: Partial<Record<LookupList, readonly string[]>> = {
  PERSON: ['company', 'poc'],
  // months the loan runs ('' = open, no fixed end)
  LOAN_TENURE: ['months'],
  // months between two instalments ('' = custom, agreed per loan)
  REPAY_FREQUENCY: ['months'],
  // a picture of the certificate (an uploaded file)
  CERT_TYPE: ['pictureId', 'pictureName'],
  // whose account it is, and the bank details (a cash counter has none)
  BANK_ACCOUNT: ['kind', 'ownerType', 'ownerId', 'ownerName', 'bank', 'title', 'account', 'branch'],
};

/** the lists whose description is written in the rich-text editor */
const RICH_LISTS: readonly string[] = ['LOAN_TENURE', 'REPAY_PLAN', 'REPAY_FREQUENCY', 'CERT_TYPE'];

/** who a bank or cash account belongs to */
export const ACCOUNT_OWNERS = ['Company', 'Investor', 'Distributor', 'Manufacturer'] as const;

/** the months of the standard repayment frequencies, by name */
const FREQUENCY_MONTHS: Record<string, string> = { Monthly: '1', Quarterly: '3', 'Half-yearly': '6', Yearly: '12', Annually: '12' };

/** The yes / no switches each list can carry: Incoterm cost lines, loan or equity, depreciable or not. */
const LIST_FLAGS: Record<LookupList, readonly string[]> = {
  PAY_METHOD: [],
  INCOTERM: INCOTERM_FLAGS,
  // liability: money to pay back; advance: temporary funding (purpose, settlement and direction instead of loan terms)
  CAPITAL_SOURCE: ['liability', 'advance'],
  STREAM_TYPE: ['depreciable'],
  // an investor account is an investor, a business owner, or both
  PERSON: ['investor', 'owner'],
  LOAN_TENURE: [], REPAY_PLAN: [], REPAY_FREQUENCY: [], ADVANCE_PURPOSE: [], SETTLEMENT_METHOD: [], BANK_ACCOUNT: [], DELIVERY_STATUS: [], BILL_TYPE: [], BILL_TREATMENT: [], APPROVER: [], FLAVOUR: [], PACKET_SIZE: [], BANK: [], ORDER_STAGE: [], DIST_CLASSIFICATION: [],
  // a KYC document type can be required before an international distributor's documents are submitted
  KYC_DOC_TYPE: ['required'],
  REMITTANCE_METHOD: [],
  CERT_TYPE: [],
  EXPORT_DOC_TYPE: [],
  CONTAINER_UNIT: [],
  TRANSPORT_UNIT: [],
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
        list: 'CAPITAL_SOURCE', code: c.code, description: c.description, flags: { liability: c.liability, advance: c.advance }, active: c.active, sortOrder: i,
      }))),
      ...(have.has('STREAM_TYPE') ? [] : STREAM_TYPE_DEFAULTS.map((t, i) => this.repo.create({
        list: 'STREAM_TYPE', code: t.code, description: t.description, flags: { depreciable: t.depreciable }, sortOrder: i,
      }))),
      ...SIMPLE_LISTS.flatMap((list) => (have.has(list) ? [] : SIMPLE_LIST_DEFAULTS[list].map((code, i) => this.repo.create({ list, code, sortOrder: i })))),
    ];
    if (rows.length) await this.repo.save(rows);
    // the starting KYC document types the spec makes mandatory
    if (!have.has('KYC_DOC_TYPE')) {
      const kyc = await this.repo.find({ where: { list: 'KYC_DOC_TYPE' } });
      for (const k of kyc) k.flags = { required: KYC_REQUIRED.includes(k.code) };
      if (kyc.length) await this.repo.save(kyc);
    }
    // capital sources made before the "advance" switch existed: the Partner Advance default is an advance
    const olds = (await this.repo.find({ where: { list: 'CAPITAL_SOURCE' } })).filter((r) => r.flags?.['advance'] === undefined);
    for (const r of olds) r.flags = { ...r.flags, advance: r.code === 'Partner Advance' };
    if (olds.length) await this.repo.save(olds);
    // people made before investor accounts had roles are investors
    const people = (await this.repo.find({ where: { list: 'PERSON' } })).filter((r) => r.flags?.['investor'] === undefined);
    for (const r of people) r.flags = { investor: true, owner: !!r.flags?.['owner'] };
    if (people.length) await this.repo.save(people);
    // bank and cash accounts made before they had an owner are the company's own
    const accounts = (await this.repo.find({ where: { list: 'BANK_ACCOUNT' } })).filter((r) => !r.meta?.['ownerType']);
    for (const r of accounts) r.meta = { ...r.meta, kind: /cash/i.test(r.code) ? 'Cash' : 'Bank', ownerType: 'Company', ownerId: '', ownerName: '' };
    if (accounts.length) await this.repo.save(accounts);
    // repayment frequencies made before they had a period
    const freqs = (await this.repo.find({ where: { list: 'REPAY_FREQUENCY' } })).filter((r) => r.meta?.['months'] === undefined);
    for (const r of freqs) r.meta = { ...r.meta, months: FREQUENCY_MONTHS[r.code] ?? '' };
    if (freqs.length) await this.repo.save(freqs);
  }

  list(list?: string) {
    return this.repo.find({ where: list ? { list } : {}, order: { list: 'ASC', sortOrder: 'ASC', code: 'ASC' } });
  }

  async create(dto: { list: LookupList; code: string; description?: string; notes?: string; flags?: Record<string, boolean>; meta?: Record<string, string> }) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('Enter a name.');
    // an investor account added without roles is an investor
    const flags = this.cleanFlags(dto.list, dto.list === 'PERSON' && !dto.flags ? { investor: true } : dto.flags);
    this.checkRoles(dto.list, flags);
    if (await this.repo.findOne({ where: { list: dto.list, code } })) throw new ConflictException('This entry already exists.');
    const meta = await this.checkMeta(dto.list, this.cleanMeta(dto.list, dto.meta));
    const last = await this.repo.find({ where: { list: dto.list }, order: { sortOrder: 'DESC' }, take: 1 });
    const row = await this.repo.save(this.repo.create({
      list: dto.list, code, description: '', ...this.texts(dto.list, dto.description, dto.notes), flags, meta, sortOrder: (last[0]?.sortOrder ?? -1) + 1,
    }));
    await this.attachPicture(row);
    return row;
  }

  /** a rich-text list keeps the text in notes and its plain start as the description shown in lists */
  private texts(list: string, description?: string, notes?: string): { description?: string; notes?: string } {
    if (RICH_LISTS.includes(list) && notes !== undefined) return { notes, description: plainText(notes).slice(0, 250) };
    return { ...(description !== undefined ? { description } : {}), ...(notes !== undefined ? { notes } : {}) };
  }

  /** the certificate picture belongs to its entry */
  private async attachPicture(row: Lookup) {
    const id = row.meta?.['pictureId'];
    if (!id) return;
    await this.repo.manager.update(Attachment, { id }, { ownerType: 'LOOKUP', ownerId: row.id });
  }

  /** checks the extra fields of a list: months, the certificate picture, the owner and bank of an account */
  private async checkMeta(list: LookupList, meta: Record<string, string>) {
    if (list === 'LOAN_TENURE' || list === 'REPAY_FREQUENCY') {
      const m = meta['months'];
      if (m && !(/^\d+$/.test(m) && +m >= 1 && +m <= 600)) throw new BadRequestException('Months must be a whole number from 1 to 600.');
    }
    if (list === 'CERT_TYPE' && meta['pictureId']) {
      const a = await this.repo.manager.findOne(Attachment, { where: { id: meta['pictureId'] } });
      if (!a) throw new BadRequestException('The picture was not found. Upload it again.');
      if (!a.mime.startsWith('image/')) throw new BadRequestException('The certificate picture must be an image (PNG, JPG, GIF or WebP).');
      meta['pictureName'] = a.name.slice(0, 150);
    }
    if (list === 'BANK_ACCOUNT') {
      const kind = meta['kind'] === 'Cash' ? 'Cash' : 'Bank';
      const ownerType = (ACCOUNT_OWNERS as readonly string[]).includes(meta['ownerType']) ? meta['ownerType'] : 'Company';
      meta['kind'] = kind;
      meta['ownerType'] = ownerType;
      if (ownerType === 'Company') {
        meta['ownerId'] = '';
        meta['ownerName'] = '';
      } else {
        const id = meta['ownerId'];
        if (!id) throw new BadRequestException(`Choose the ${ownerType.toLowerCase()} this account belongs to.`);
        const owner = ownerType === 'Investor'
          ? (await this.repo.findOne({ where: { id, list: 'PERSON' } }))?.code
          : ownerType === 'Distributor'
            ? (await this.repo.manager.findOne(Distributor, { where: { id } }))?.name
            : (await this.repo.manager.findOne(Manufacturer, { where: { id } }))?.name;
        if (!owner) throw new BadRequestException(`That ${ownerType.toLowerCase()} was not found.`);
        meta['ownerName'] = owner.slice(0, 150);
      }
      if (kind === 'Cash') {
        meta['bank'] = '';
        meta['account'] = '';
        meta['branch'] = '';
      } else {
        if (!meta['bank']) throw new BadRequestException('Choose the bank.');
        if (!meta['account']) throw new BadRequestException('Enter the account number or IBAN.');
      }
    }
    return meta;
  }

  async update(id: string, patch: { description?: string; notes?: string; flags?: Record<string, boolean>; meta?: Record<string, string>; active?: boolean }) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Entry not found');
    // a list the business picks from needs one active entry; the people list may be emptied
    if (row.list !== 'PERSON' && patch.active === false && (await this.repo.count({ where: { list: row.list, active: true } })) <= 1 && row.active) {
      throw new BadRequestException('Keep at least one active entry in this list.');
    }
    Object.assign(row, this.texts(row.list, patch.description, patch.notes));
    if (patch.flags) {
      row.flags = this.cleanFlags(row.list as LookupList, patch.flags);
      this.checkRoles(row.list as LookupList, row.flags);
    }
    if (patch.meta) row.meta = await this.checkMeta(row.list as LookupList, this.cleanMeta(row.list as LookupList, patch.meta));
    if (patch.active !== undefined) row.active = patch.active;
    const saved = await this.repo.save(row);
    await this.attachPicture(saved);
    return saved;
  }

  /** throws unless the code is an active entry of the list (used to validate documents) */
  async assertActive(list: LookupList, code: string | undefined, em?: EntityManager) {
    if (code === undefined) return;
    const repo = em ? em.getRepository(Lookup) : this.repo;
    const row = await repo.findOne({ where: { list, code } });
    if (!row || !row.active) {
      throw new BadRequestException(`"${code}" is not an active ${LIST_LABEL[list]}. Choose one from Settings & Data.`);
    }
    // money is taken or paid through one of the company's own accounts
    if (list === 'BANK_ACCOUNT' && row.meta?.['ownerType'] && row.meta['ownerType'] !== 'Company') {
      throw new BadRequestException(`"${code}" is the account of a ${row.meta['ownerType'].toLowerCase()}, not one of the company's own accounts.`);
    }
  }

  /** an active person (shareholder or partner) of the People list, by id */
  async activePerson(em: EntityManager, id: string): Promise<Lookup> {
    const row = await em.getRepository(Lookup).findOne({ where: { id, list: 'PERSON' } });
    if (!row || !row.active) throw new BadRequestException('This person is not an active entry of the People list. Add them in Settings & Data.');
    return row;
  }

  /** true when the capital source is a loan or an advance (money to pay back), false for equity */
  async isLiability(em: EntityManager, code: string): Promise<boolean> {
    const row = await em.getRepository(Lookup).findOne({ where: { list: 'CAPITAL_SOURCE', code } });
    return !!row?.flags?.['liability'];
  }

  /** the kind of a capital source: equity, a loan, or an advance */
  async fundingKind(em: EntityManager, code: string): Promise<'equity' | 'loan' | 'advance'> {
    const row = await em.getRepository(Lookup).findOne({ where: { list: 'CAPITAL_SOURCE', code } });
    if (!row?.flags?.['liability']) return 'equity';
    return row.flags['advance'] ? 'advance' : 'loan';
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

  /** an investor account is an investor, a business owner, or both: never neither */
  private checkRoles(list: LookupList, flags: Record<string, boolean>) {
    if (list === 'PERSON' && !flags['investor'] && !flags['owner']) throw new BadRequestException('Tick investor, business owner, or both.');
  }

  /** only the text fields the list knows, trimmed and kept short */
  private cleanMeta(list: LookupList, meta?: Record<string, string>) {
    return Object.fromEntries((LIST_META[list] ?? []).map((k) => [k, String(meta?.[k] ?? '').trim().slice(0, 150)]));
  }

  /** only the flag names the list knows, always as booleans */
  private cleanFlags(list: LookupList, flags?: Record<string, boolean>) {
    return Object.fromEntries(LIST_FLAGS[list].map((f) => [f, !!flags?.[f]]));
  }
}
