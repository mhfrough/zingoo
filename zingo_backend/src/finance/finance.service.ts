import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AttachmentsService } from '../attachments/attachments.service';
import { round2 } from '../common/numeric.transformer';
import { isChequeMethod } from '../common/payments';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { Distributor, Manufacturer, Product } from '../catalog/catalog.entities';
import { LookupsService } from '../setup/lookups.service';
import { Currency, Lookup } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import {
  CapitalLineDto, ChequeDto, CreateAccountingDto, CreateCapitalDto, CreateFinanceDto, RepaymentDto, SettleDto,
  UpdateAccountingDto, UpdateFinanceDto, InvoiceLineDto,
} from './finance.dto';
import {
  AccountingDocument, InvoiceLine, AccountingSettlement, Approval, ChequeStatus, FinanceEntry, FinanceEntryStream, FundingRepayment,
  InvestorType,
} from './finance.entities';

const today = () => new Date().toISOString().slice(0, 10);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Signer {
  id?: string | null;
  seat: string;
}

/** A user may sign as seat A, seat B, or either when their seat is "Both". */
function canSign(user: Signer, seat: 'A' | 'B') {
  return user.seat === 'Both' || user.seat === seat;
}

@Injectable()
export class FinanceService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
    private readonly files: AttachmentsService,
  ) {}

  /** entries with their signature state, stream split, files and (for a shared injection) the other investors */
  private async decorate(em: EntityManager, rows: FinanceEntry[]) {
    if (!rows.length) return [];
    const shares = await em.find(FinanceEntryStream, { where: { entryId: In(rows.map((r) => r.id)) }, order: { amount: 'DESC' } });
    const files = await this.files.metasOf(rows.flatMap((r) => [r.proofId, r.agreementId]).filter((x): x is string => !!x));
    const groups = [...new Set(rows.map((r) => r.groupId).filter((x): x is string => !!x))];
    const mates = groups.length ? await em.find(FinanceEntry, { where: { groupId: In(groups) }, order: { refNo: 'ASC' } }) : [];
    // loans and advances: what has been paid back so far, and what is spent against their streams
    const capitalIds = rows.filter((r) => r.type === 'Capital Injection').map((r) => r.id);
    const paid: { entryId: string; kind: string; total: number }[] = capitalIds.length
      ? await em.query(`SELECT "entryId", kind, SUM(amount)::float8 AS total FROM funding_repayments WHERE "entryId" = ANY($1) GROUP BY 1, 2`, [capitalIds])
      : [];
    const used: { fundedById: string; total: number }[] = capitalIds.length
      ? await em.query(`SELECT "fundedById", SUM(amount)::float8 AS total FROM finance_entries WHERE "fundedById" = ANY($1) GROUP BY 1`, [capitalIds])
      : [];
    const liabilities = new Set((await em.find(Lookup, { where: { list: 'CAPITAL_SOURCE' } })).filter((l) => l.flags?.['liability']).map((l) => l.code));
    return Promise.all(rows.map(async (f) => {
      const st = await this.posting.financeState(em, f);
      const cleared = f.type !== 'Capital Injection' || f.chequeStatus === '' || f.chequeStatus === 'Cleared';
      const liability = f.type === 'Capital Injection' && liabilities.has(f.funding);
      const repaid = round2(paid.filter((p) => p.entryId === f.id && p.kind === 'principal').reduce((n, p) => n + p.total, 0));
      return {
        ...f,
        signatures: st.signed, requiredSignatures: st.required, needsApproval: st.needs, approved: st.approved,
        /** capital only: the money is in the bank (not a cheque that is still waiting, or bounced) */
        cleared,
        /** capital only: a loan or an advance (money to pay back, or to get back for an advance paid out) */
        liability,
        /** loans and advances: principal paid back so far, markup paid, and what is still open */
        repaid,
        markupPaid: round2(paid.filter((p) => p.entryId === f.id && p.kind === 'markup').reduce((n, p) => n + p.total, 0)),
        outstanding: liability && cleared ? Math.max(0, round2(Number(f.amount) - repaid)) : 0,
        /** spent against this funding's streams (spend entries tagged "funded from" it) */
        usedAmount: round2(used.find((u) => u.fundedById === f.id)?.total ?? 0),
        streams: shares.filter((x) => x.entryId === f.id).map((x) => ({ stream: x.stream, amount: x.amount, pct: x.pct })),
        proof: (f.proofId && files.get(f.proofId)) || null,
        agreement: (f.agreementId && files.get(f.agreementId)) || null,
        coInvestors: f.groupId ? mates.filter((m) => m.groupId === f.groupId && m.id !== f.id).map((m) => m.party) : [],
      };
    }));
  }

  async list() {
    const em = this.db.manager;
    return this.decorate(em, await em.find(FinanceEntry, { order: { date: 'DESC', refNo: 'DESC' } }));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const f = await em.findOne(FinanceEntry, { where: { id } });
    if (!f) throw new NotFoundException('Entry not found');
    return (await this.decorate(em, [f]))[0];
  }

  /** every account that can put money in: contract manufacturers, distributors and the people of Settings, by kind then name */
  async investorAccounts() {
    const em = this.db.manager;
    const [manufacturers, distributors, people] = await Promise.all([
      em.find(Manufacturer, { order: { name: 'ASC' } }),
      em.find(Distributor, { order: { name: 'ASC' } }),
      em.find(Lookup, { where: { list: 'PERSON', active: true }, order: { sortOrder: 'ASC', code: 'ASC' } }),
    ]);
    return [
      ...people.map((p) => ({ type: 'Person' as const, id: p.id, name: p.code, note: p.description })),
      ...manufacturers.map((m) => ({ type: 'Manufacturer' as const, id: m.id, name: m.name, note: m.contact ?? '' })),
      ...distributors.map((d) => ({ type: 'Distributor' as const, id: d.id, name: d.name, note: d.region })),
    ];
  }

  /** the name of an investor account; throws when it does not exist (or a person is switched off) */
  private async investorName(em: EntityManager, type: InvestorType, id: string): Promise<string> {
    if (type === 'Person') return (await this.lookups.activePerson(em, id)).code;
    const row = type === 'Manufacturer' ? await em.findOne(Manufacturer, { where: { id } }) : await em.findOne(Distributor, { where: { id } });
    if (!row) throw new BadRequestException(`This ${type.toLowerCase()} does not exist. Choose an account from the list.`);
    return row.name;
  }

  /**
   * The loan or advance terms of an injection. Equity has none; a loan has tenure, repayment plan, frequency and
   * markup; an advance has a direction, purpose, settlement method and a linked reference. The options are Settings lists.
   */
  private async terms(em: EntityManager, dto: CreateCapitalDto, funding: string) {
    const kind = await this.lookups.fundingKind(em, funding);
    const blank = { direction: 'in' as 'in' | 'out', tenure: '', repaymentPlan: '', repaymentFrequency: '', markupPct: 0, purpose: '', settlementMethod: '', linkedReference: '', bankAccount: '' };
    const pick = async (list: 'LOAN_TENURE' | 'REPAY_PLAN' | 'REPAY_FREQUENCY' | 'ADVANCE_PURPOSE' | 'SETTLEMENT_METHOD' | 'BANK_ACCOUNT', v?: string) => {
      const s = (v ?? '').trim();
      if (s) await this.lookups.assertActive(list, s, em);
      return s;
    };
    const t = { ...blank, bankAccount: await pick('BANK_ACCOUNT', dto.bankAccount) };
    if (kind === 'loan') {
      t.tenure = await pick('LOAN_TENURE', dto.tenure);
      t.repaymentPlan = await pick('REPAY_PLAN', dto.repaymentPlan);
      t.repaymentFrequency = await pick('REPAY_FREQUENCY', dto.repaymentFrequency);
      t.markupPct = round2(dto.markupPct ?? 0);
    }
    if (kind === 'advance') {
      t.purpose = await pick('ADVANCE_PURPOSE', dto.purpose);
      t.settlementMethod = await pick('SETTLEMENT_METHOD', dto.settlementMethod);
      t.linkedReference = (dto.linkedReference ?? '').trim();
      t.direction = dto.direction ?? 'in';
    } else if (dto.direction === 'out') {
      throw new BadRequestException('Only an advance can be paid out to a partner.');
    }
    return t;
  }

  /** checks one investor line and works out its stream split */
  private async capitalLine(em: EntityManager, l: CapitalLineDto, funding: string) {
    const party = await this.investorName(em, l.partyType, l.partyId);
    const amount = round2(l.amount);
    const source = (l.paymentSource ?? '').trim();
    if (source) await this.lookups.assertActive('PAY_METHOD', source, em);
    const bank = (l.bankAccount ?? '').trim();
    if (bank) await this.lookups.assertActive('BANK_ACCOUNT', bank, em);

    // a cheque is not cash until it clears
    let chequeNo = '';
    let clearanceDate: string | null = null;
    let chequeStatus: ChequeStatus = '';
    if (isChequeMethod(source)) {
      chequeNo = (l.chequeNo ?? '').trim();
      if (!chequeNo) throw new BadRequestException(`Enter the cheque number for ${party}.`);
      if (!l.clearanceDate) throw new BadRequestException(`Enter the clearance date of ${party}'s cheque.`);
      if (l.clearanceDate < l.date) throw new BadRequestException(`${party}'s cheque cannot clear before the investment date.`);
      clearanceDate = l.clearanceDate;
      chequeStatus = 'Pending';
    }
    if (l.expectedReturnDate && l.expectedReturnDate < l.date) {
      throw new BadRequestException(`The expected return date for ${party} cannot be before the investment date.`);
    }

    // invested against: each part by amount or by percent of this investor's amount; together they equal the amount
    const seen = new Set<string>();
    const parts: { stream: string; amount: number }[] = [];
    for (const sh of l.streams) {
      if (seen.has(sh.stream)) throw new BadRequestException(`Stream "${sh.stream}" is listed twice for ${party}.`);
      seen.add(sh.stream);
      await this.checkCategory(em, sh.stream);
      if (sh.amount === undefined && sh.pct === undefined) throw new BadRequestException(`Enter an amount or a percent for ${sh.stream}.`);
      parts.push({ stream: sh.stream, amount: sh.amount !== undefined ? round2(sh.amount) : round2((amount * sh.pct!) / 100) });
    }
    const sum = round2(parts.reduce((n, p) => n + p.amount, 0));
    const diff = round2(amount - sum);
    if (Math.abs(diff) > 0.05) {
      throw new BadRequestException(`${party}'s streams add up to PKR ${sum}, but the investment is PKR ${amount}. Make them equal.`);
    }
    parts[parts.length - 1].amount = round2(parts[parts.length - 1].amount + diff); // absorb rounding
    const streams = parts.map((p) => ({ stream: p.stream, amount: p.amount, pct: round3((p.amount / amount) * 100) }));
    const category = parts.reduce((best, p) => (p.amount > best.amount ? p : best)).stream;

    return {
      streams,
      entry: {
        date: l.date, category, amount, party, partyType: l.partyType, partyId: l.partyId, funding,
        paymentSource: source, paymentReference: (l.paymentReference ?? '').trim(), paymentAgainst: (l.paymentAgainst ?? '').trim(),
        paidBy: (l.paidBy ?? '').trim(), receivedBy: (l.receivedBy ?? '').trim(),
        issueDate: l.issueDate ?? null, expectedReturnDate: l.expectedReturnDate ?? null,
        chequeNo, clearanceDate, chequeStatus, proofId: l.proofId ?? null, agreementId: l.agreementId ?? null,
        ...(bank ? { bankAccount: bank } : {}),
      },
    };
  }

  /** a capital injection: one investor, or several (a shared investment) sharing one group; one entry per investor */
  createCapital(dto: CreateCapitalDto) {
    return this.db.transaction(async (em) => {
      const s = await this.settings.get(em);
      const prefix = s.docPrefixes['finance'] ?? 'FIN';
      const groupId = dto.investors.length > 1 ? randomUUID() : null;
      const note = dto.note?.trim() || null;
      // the type of funding is one choice for the whole injection
      const funding = dto.funding ?? 'Equity';
      await this.lookups.assertActive('CAPITAL_SOURCE', funding, em);
      const terms = await this.terms(em, dto, funding);
      const accounts = new Set<string>();
      const attached = new Set<string>(); // one agreement can serve every investor
      const ids: string[] = [];
      for (const line of dto.investors) {
        const key = `${line.partyType}:${line.partyId}`;
        if (accounts.has(key)) throw new BadRequestException('The same account is listed twice. Combine them into one amount.');
        accounts.add(key);
        const { entry, streams } = await this.capitalLine(em, line, funding);
        const refNo = await nextRef(em, FinanceEntry, prefix, 3);
        const f = await em.save(em.create(FinanceEntry, { ...terms, ...entry, refNo, type: 'Capital Injection', groupId, note }));
        await em.save(streams.map((x) => em.create(FinanceEntryStream, { ...x, entryId: f.id })));
        for (const fileId of [entry.proofId, entry.agreementId]) {
          if (!fileId || attached.has(fileId)) continue;
          attached.add(fileId);
          await this.files.attach(fileId, 'FINANCE', f.id, em);
        }
        await this.posting.syncFinance(em, f.id); // posts at once, unless it is a cheque that has not cleared
        ids.push(f.id);
      }
      return this.decorate(em, await em.find(FinanceEntry, { where: { id: In(ids) }, order: { refNo: 'ASC' } }));
    });
  }

  /** a cheque cleared (the money is now in the bank, on the clearing date) or bounced (it never counts) */
  markCheque(id: string, dto: ChequeDto) {
    return this.db.transaction(async (em) => {
      const f = await em.findOne(FinanceEntry, { where: { id } });
      if (!f) throw new NotFoundException('Entry not found');
      if (f.type !== 'Capital Injection' || f.chequeStatus !== 'Pending') {
        throw new BadRequestException('Only a cheque that is waiting to clear can be updated.');
      }
      if (dto.status === 'Cleared') {
        const now = today();
        const date = dto.date ?? (f.clearanceDate && f.clearanceDate < now ? f.clearanceDate : now);
        if (date > now) throw new BadRequestException('A cheque cannot clear in the future.');
        if (date < f.date) throw new BadRequestException('The clearance date cannot be before the cheque date.');
        f.clearanceDate = date;
      }
      f.chequeStatus = dto.status;
      await em.save(f);
      await this.posting.syncFinance(em, id);
      return this.findOne(id, em);
    });
  }

  /** a spend that says which funding it is paid from must fit what is left of that funding on its stream */
  private async checkFunded(em: EntityManager, f: { type: string; category: string; amount: number; fundedById?: string | null }, selfId?: string) {
    if (!f.fundedById) return;
    if (f.type !== 'Operating Expense' && f.type !== 'Asset Purchase') throw new BadRequestException('Only a spend can be paid from a funding.');
    const cap = await em.findOne(FinanceEntry, { where: { id: f.fundedById } });
    if (!cap || cap.type !== 'Capital Injection') throw new BadRequestException('Choose a capital injection to pay this from.');
    if (cap.direction === 'out') throw new BadRequestException('An advance paid out to a partner has no money to spend.');
    if (cap.chequeStatus === 'Pending' || cap.chequeStatus === 'Bounced') throw new BadRequestException(`${cap.refNo} is not in the bank yet.`);
    const alloc = await em.findOne(FinanceEntryStream, { where: { entryId: cap.id, stream: f.category } });
    if (!alloc) throw new BadRequestException(`${cap.refNo} has nothing set aside for ${f.category}.`);
    const [{ spent }] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS spent FROM finance_entries WHERE "fundedById" = $1 AND category = $2 AND ($3::uuid IS NULL OR id <> $3)`,
      [cap.id, f.category, selfId ?? null],
    );
    const left = round2(Number(alloc.amount) - Number(spent));
    if (Number(f.amount) > left + 0.005) throw new BadRequestException(`${cap.refNo} has only PKR ${left} left for ${f.category}.`);
  }

  /** what a loan or advance looks like now: terms, repayments, what is spent per stream and what is left */
  async position(id: string, em: EntityManager = this.db.manager) {
    const f = await em.findOne(FinanceEntry, { where: { id } });
    if (!f) throw new NotFoundException('Entry not found');
    if (f.type !== 'Capital Injection') throw new BadRequestException('Only capital has a position.');
    const [entry] = await this.decorate(em, [f]);
    const repayments = await em.find(FundingRepayment, { where: { entryId: id }, order: { date: 'ASC', refNo: 'ASC' } });
    const files = await this.files.metasOf(repayments.map((r) => r.proofId).filter((x): x is string => !!x));
    const alloc = await em.find(FinanceEntryStream, { where: { entryId: id }, order: { amount: 'DESC' } });
    const spends = await this.decorate(em, await em.find(FinanceEntry, { where: { fundedById: id }, order: { date: 'DESC', refNo: 'DESC' } }));
    const streams = alloc.map((a) => {
      const spent = round2(spends.filter((s) => s.category === a.stream).reduce((n, s) => n + Number(s.amount), 0));
      return { stream: a.stream, allocated: Number(a.amount), pct: Number(a.pct), spent, available: Math.max(0, round2(Number(a.amount) - spent)) };
    });
    // simple (not compounded) markup from the day the money arrived to the due date; informational only
    const from = f.chequeStatus === 'Cleared' ? f.clearanceDate ?? f.date : f.date;
    const days = f.expectedReturnDate ? Math.max(0, Math.round((Date.parse(f.expectedReturnDate) - Date.parse(from)) / 86400000)) : 0;
    return {
      entry,
      repayments: repayments.map((r) => ({ ...r, proof: (r.proofId && files.get(r.proofId)) || null })),
      streams,
      spends,
      unallocated: Math.max(0, round2(Number(f.amount) - alloc.reduce((n, a) => n + Number(a.amount), 0))),
      projectedMarkup: round2((Number(f.amount) * Number(f.markupPct) * days) / 36500),
    };
  }

  /** a repayment of a loan or advance, or the markup paid on it: cash moves against the investor's own account */
  repay(id: string, dto: RepaymentDto) {
    return this.db.transaction(async (em) => {
      const f = await em.findOne(FinanceEntry, { where: { id } });
      if (!f) throw new NotFoundException('Entry not found');
      if (f.type !== 'Capital Injection' || !(await this.lookups.isLiability(em, f.funding))) {
        throw new BadRequestException('Only a loan or an advance can be repaid. Equity stays in the business.');
      }
      if (f.chequeStatus === 'Pending' || f.chequeStatus === 'Bounced') throw new BadRequestException('The money has not reached the bank yet.');
      const since = f.chequeStatus === 'Cleared' ? f.clearanceDate ?? f.date : f.date;
      if (dto.date < since) throw new BadRequestException('A repayment cannot be dated before the money arrived.');
      if (dto.date > today()) throw new BadRequestException('A repayment cannot be in the future. Record it when it is paid.');
      const method = (dto.method ?? '').trim();
      if (method) await this.lookups.assertActive('PAY_METHOD', method, em);
      const amount = round2(dto.amount);
      if (dto.kind === 'principal') {
        const [{ paid }] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM funding_repayments WHERE "entryId" = $1 AND kind = 'principal'`, [id]);
        const open = round2(Number(f.amount) - Number(paid));
        if (amount > open + 0.005) throw new BadRequestException(`PKR ${amount} is more than the PKR ${open} still outstanding.`);
      }
      const s = await this.settings.get(em);
      const refNo = await nextRef(em, FundingRepayment, s.docPrefixes['repayment'] ?? 'RPY', 3);
      const r = await em.save(em.create(FundingRepayment, {
        refNo, entryId: id, date: dto.date, amount, kind: dto.kind, method, reference: (dto.reference ?? '').trim(),
        note: dto.note?.trim() || null, proofId: dto.proofId ?? null,
      }));
      if (dto.proofId) await this.files.attach(dto.proofId, 'REPAYMENT', r.id, em);
      await this.posting.syncRepayment(em, r.id);
      return this.position(id, em);
    });
  }

  create(dto: CreateFinanceDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      await this.checkCategory(em, dto.category);
      await this.checkFunded(em, dto);
      if (dto.type === 'Capital Injection') await this.lookups.assertActive('CAPITAL_SOURCE', dto.funding ?? 'Equity', em);
      const s = await this.settings.get(em);
      const refNo = opts.refNo ?? (await nextRef(em, FinanceEntry, s.docPrefixes['finance'] ?? 'FIN', 3));
      const f = await em.save(em.create(FinanceEntry, {
        ...dto, refNo, party: dto.party ?? '', funding: dto.type === 'Capital Injection' ? dto.funding ?? 'Equity' : '',
      }));
      await this.posting.syncFinance(em, f.id); // capital and other receipts post at once; spend waits for signatures
      return this.findOne(f.id, em);
    });
  }

  update(id: string, dto: UpdateFinanceDto) {
    return this.db.transaction(async (em) => {
      const f = await em.findOne(FinanceEntry, { where: { id } });
      if (!f) throw new NotFoundException('Entry not found');
      const st = await this.posting.financeState(em, f);
      if (st.approved) throw new BadRequestException('Posted finance entries are locked to keep the cash trail.');
      if (dto.category) await this.checkCategory(em, dto.category);
      await this.checkFunded(em, { ...f, ...dto }, id);
      await em.save(em.merge(FinanceEntry, f, dto));
      await em.delete(Approval, { docType: 'FINANCE', docId: id }); // editing starts the approval again
      await this.posting.syncFinance(em, id);
      return this.findOne(id, em);
    });
  }

  remove(id: string) {
    return this.db.transaction(async (em) => {
      const f = await em.findOne(FinanceEntry, { where: { id } });
      if (!f) throw new NotFoundException('Entry not found');
      const st = await this.posting.financeState(em, f);
      if (st.approved) throw new BadRequestException('Posted finance entries cannot be deleted.');
      await em.delete(Approval, { docType: 'FINANCE', docId: id });
      await em.remove(f);
      return { deleted: true };
    });
  }

  /** Adds one signature. `bypassSeat` is for the seed only. */
  sign(id: string, seat: 'A' | 'B', user: Signer, bypassSeat = false) {
    return this.db.transaction(async (em) => {
      const f = await em.findOne(FinanceEntry, { where: { id } });
      if (!f) throw new NotFoundException('Entry not found');
      const st = await this.posting.financeState(em, f);
      if (!st.needs || st.approved) throw new BadRequestException('Nothing is waiting for a signature.');
      if (!bypassSeat && !canSign(user, seat)) throw new ForbiddenException(`Your account cannot sign as seat ${seat}.`);
      if (!st.signed.includes(seat)) await em.save(em.create(Approval, { docType: 'FINANCE', docId: id, seat, userId: user.id ?? null }));
      await this.posting.syncFinance(em, id);
      return this.findOne(id, em);
    });
  }

  private async checkCategory(em: EntityManager, name: string) {
    const [row] = await em.query(`SELECT 1 FROM categories WHERE kind = 'COST_CENTER' AND name = $1`, [name]);
    if (!row) throw new BadRequestException(`Unknown cost center "${name}".`);
  }
}

@Injectable()
export class AccountingService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
    private readonly settings: SettingsService,
    private readonly lookups: LookupsService,
  ) {}

  private async paidOf(em: EntityManager, id: string): Promise<number> {
    const [r] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM accounting_settlements WHERE "documentId" = $1`, [id]);
    return round2(Number(r.paid));
  }

  private async view(em: EntityManager, a: AccountingDocument) {
    const [st, paid] = await Promise.all([this.posting.accountingState(em, a), this.paidOf(em, a.id)]);
    const due = Math.max(0, round2(Number(a.amount) - paid));
    const noun = a.kind === 'Income' ? ['Collected', 'Receivable'] : ['Paid', 'Payable'];
    const status = a.status === 'Draft' ? 'Draft' : !st.approved ? 'Awaiting approval' : due < 0.01 ? noun[0] : due < Number(a.amount) ? 'Partially settled' : noun[1];
    return { ...a, paid, due, status, signatures: st.signed, requiredSignatures: st.required, needsApproval: st.needs, approved: st.approved };
  }

  async list() {
    const em = this.db.manager;
    const rows = await em.find(AccountingDocument, { order: { date: 'DESC', refNo: 'DESC' } });
    return Promise.all(rows.map((a) => this.view(em, a)));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const a = await em.findOne(AccountingDocument, { where: { id } });
    if (!a) throw new NotFoundException('Document not found');
    return this.view(em, a);
  }

  settlements() {
    return this.db.manager.find(AccountingSettlement, { relations: ['document'], order: { date: 'DESC', refNo: 'DESC' } });
  }

  /** foreign amount x rate = PKR amount; PKR documents must use rate 1. A draft may still be empty. */
  private async money(em: EntityManager, d: { foreignAmount: number; currency?: string; fxRate?: number }, draft = false) {
    const currency = d.currency ?? 'PKR';
    const cur = await em.findOne(Currency, { where: { code: currency } });
    if (!cur) throw new BadRequestException(`Currency ${currency} is not set up.`);
    const fxRate = d.fxRate ?? Number(cur.rate);
    if (currency === 'PKR' && Math.abs(fxRate - 1) > 0.0001) throw new BadRequestException('A PKR document must use exchange rate 1.');
    if (!(fxRate > 0)) throw new BadRequestException('The exchange rate must be positive.');
    const amount = round2(d.foreignAmount * fxRate);
    if (!(amount > 0) && !draft) throw new BadRequestException('Amount and exchange rate must be positive.');
    return { currency, fxRate, foreignAmount: round2(d.foreignAmount), amount };
  }

  private static readonly COST_KEYS = ['freight', 'insurance', 'customs', 'packaging', 'other'] as const;

  /**
   * The money of a document. An income invoice with SKU lines works its amount out: lines minus discount plus sales
   * tax, in the invoice currency; the sales tax and the cost of the goods are kept in PKR. Without lines the typed
   * amount is used, as before.
   */
  private async amounts(em: EntityManager, v: {
    kind: string; foreignAmount?: number; currency?: string; fxRate?: number; lines?: InvoiceLineDto[]; discount?: number;
    salesTaxPct?: number; sellerCosts?: Record<string, number>; status?: string;
  }) {
    const draft = v.status === 'Draft';
    const costs = Object.fromEntries(AccountingService.COST_KEYS.map((k) => [k, round2(Math.max(0, Number(v.sellerCosts?.[k]) || 0))]));
    if (v.kind !== 'Income' || !v.lines?.length) {
      if (v.foreignAmount === undefined) throw new BadRequestException('Enter the amount, or add the SKU lines.');
      return { ...(await this.money(em, { foreignAmount: v.foreignAmount, currency: v.currency, fxRate: v.fxRate }, draft)), lines: [], discount: 0, taxAmount: 0, costOfGoods: 0, sellerCosts: costs };
    }
    const s = await this.settings.get(em);
    const products = await em.find(Product, { where: { id: In(v.lines.map((l) => l.productId)) } });
    const lines: InvoiceLine[] = v.lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) throw new BadRequestException('A SKU on the invoice does not exist. Choose it again.');
      const per = l.uom === 'Cartons' ? p.packsPerCarton || s.packsPerCarton : l.uom === 'Dozens' ? 12 : 1;
      const packs = round2(l.qty * per);
      return { productId: p.id, sku: p.sku, name: p.name, qty: l.qty, uom: l.uom, packs, sellPrice: l.sellPrice, unitCost: round2(l.unitCost ?? 0), lineSales: round2(packs * l.sellPrice) };
    });
    const subtotal = round2(lines.reduce((n, l) => n + l.lineSales, 0));
    const discount = round2(v.discount ?? 0);
    if (discount > subtotal) throw new BadRequestException('The discount cannot be more than the invoice lines.');
    const net = round2(subtotal - discount);
    const tax = round2((net * (v.salesTaxPct ?? 0)) / 100);
    const m = await this.money(em, { foreignAmount: round2(net + tax), currency: v.currency, fxRate: v.fxRate }, draft);
    return {
      ...m, lines, discount, taxAmount: round2(tax * m.fxRate),
      costOfGoods: round2(lines.reduce((n, l) => n + l.packs * l.unitCost, 0)), sellerCosts: costs,
    };
  }

  /** the Settings lists an invoice picks from */
  private async checkLists(em: EntityManager, d: { receivingAccount?: string; deliveryStatus?: string }) {
    if (d.receivingAccount) await this.lookups.assertActive('BANK_ACCOUNT', d.receivingAccount, em);
    if (d.deliveryStatus) await this.lookups.assertActive('DELIVERY_STATUS', d.deliveryStatus, em);
  }

  create(dto: CreateAccountingDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const s = await this.settings.get(em);
      await this.checkLists(em, dto);
      const refNo = opts.refNo ?? (await nextRef(em, AccountingDocument, s.docPrefixes['accounting'] ?? 'ACC', 3));
      const { foreignAmount: _f, currency: _c, fxRate: _x, lines: _l, discount: _d, sellerCosts: _s, ...rest } = dto;
      const a = await em.save(em.create(AccountingDocument, {
        ...rest, ...(await this.amounts(em, dto)), refNo, invoiceNo: dto.invoiceNo?.trim() || refNo, dueDate: dto.dueDate ?? dto.date,
      }));
      await this.posting.syncAccountingDoc(em, a.id);
      return this.findOne(a.id, em);
    });
  }

  update(id: string, dto: UpdateAccountingDto) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(AccountingDocument, { where: { id } });
      if (!a) throw new NotFoundException('Document not found');
      if ((await this.paidOf(em, id)) > 0) throw new BadRequestException('A document with payments is locked to keep the audit trail.');
      const st = await this.posting.accountingState(em, a);
      if (a.kind === 'Expense' && st.approved) throw new BadRequestException('Approved expense bills are locked.');
      if (a.status === 'Issued' && dto.status === 'Draft') throw new BadRequestException('An issued invoice cannot go back to draft.');
      await this.checkLists(em, dto);
      const { foreignAmount, currency, fxRate, lines, discount, sellerCosts, ...rest } = dto;
      const patch: Partial<AccountingDocument> = { ...rest };
      if (dto.invoiceNo !== undefined) patch.invoiceNo = dto.invoiceNo.trim() || a.refNo;
      const money = [foreignAmount, currency, fxRate, lines, discount, dto.salesTaxPct, sellerCosts, dto.status].some((x) => x !== undefined);
      if (money) {
        Object.assign(patch, await this.amounts(em, {
          kind: a.kind, status: dto.status ?? a.status,
          foreignAmount: foreignAmount ?? Number(a.foreignAmount ?? a.amount), currency: currency ?? a.currency, fxRate: fxRate ?? (currency ? undefined : Number(a.fxRate)),
          lines: lines ?? (a.lines as InvoiceLineDto[]), discount: discount ?? Number(a.discount), salesTaxPct: dto.salesTaxPct ?? Number(a.salesTaxPct),
          sellerCosts: sellerCosts ?? a.sellerCosts,
        }));
      }
      await em.save(em.merge(AccountingDocument, a, patch));
      await em.delete(Approval, { docType: 'ACCOUNTING', docId: id });
      await this.posting.syncAccountingDoc(em, id);
      return this.findOne(id, em);
    });
  }

  remove(id: string) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(AccountingDocument, { where: { id } });
      if (!a) throw new NotFoundException('Document not found');
      if ((await this.paidOf(em, id)) > 0) throw new BadRequestException('A document with payments cannot be deleted.');
      const st = await this.posting.accountingState(em, a);
      if (a.kind === 'Expense' && st.approved) throw new BadRequestException('Approved expense bills cannot be deleted.');
      await em.query(`DELETE FROM ledger_entries WHERE "refType" = 'ACC_DOC' AND "refId" = $1`, [id]);
      await em.delete(Approval, { docType: 'ACCOUNTING', docId: id });
      await em.remove(a);
      return { deleted: true };
    });
  }

  sign(id: string, seat: 'A' | 'B', user: Signer, bypassSeat = false) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(AccountingDocument, { where: { id } });
      if (!a) throw new NotFoundException('Document not found');
      const st = await this.posting.accountingState(em, a);
      if (!st.needs || st.approved) throw new BadRequestException('Nothing is waiting for a signature.');
      if (!bypassSeat && !canSign(user, seat)) throw new ForbiddenException(`Your account cannot sign as seat ${seat}.`);
      if (!st.signed.includes(seat)) await em.save(em.create(Approval, { docType: 'ACCOUNTING', docId: id, seat, userId: user.id ?? null }));
      await this.posting.syncAccountingDoc(em, id);
      return this.findOne(id, em);
    });
  }

  /** collect an income invoice or pay an expense bill (fully or partly) */
  settle(id: string, dto: SettleDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const a = await em.findOne(AccountingDocument, { where: { id } });
      if (!a) throw new NotFoundException('Document not found');
      await this.lookups.assertActive('PAY_METHOD', dto.method, em);
      if (a.status === 'Draft') throw new BadRequestException('Issue the invoice before collecting it.');
      const st = await this.posting.accountingState(em, a);
      if (!st.approved) throw new BadRequestException('Approve the expense bill before posting a payment.');
      const due = round2(Number(a.amount) - (await this.paidOf(em, id)));
      if (due <= 0) throw new BadRequestException('This document has nothing left to settle.');
      if (dto.amount > due + 0.001) throw new BadRequestException(`Enter an amount within the open balance of PKR ${due}.`);
      const refNo = opts.refNo ?? (await nextRef(em, AccountingSettlement, 'PAY', 3));
      const s = await em.save(em.create(AccountingSettlement, { ...dto, refNo, documentId: id, method: dto.method ?? 'Bank Transfer' }));
      await this.posting.syncSettlement(em, s.id);
      return this.findOne(id, em);
    });
  }
}
