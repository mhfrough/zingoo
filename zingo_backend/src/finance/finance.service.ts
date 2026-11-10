import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { PostingService } from '../ledger/posting.service';
import { Currency } from '../setup/setup.entities';
import { SettingsService } from '../setup/setup.service';
import {
  CreateAccountingDto, CreateFinanceDto, SettleDto, UpdateAccountingDto, UpdateFinanceDto,
} from './finance.dto';
import { AccountingDocument, AccountingSettlement, Approval, FinanceEntry } from './finance.entities';

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
  ) {}

  private async view(em: EntityManager, f: FinanceEntry) {
    const st = await this.posting.financeState(em, f);
    return { ...f, signatures: st.signed, requiredSignatures: st.required, needsApproval: st.needs, approved: st.approved };
  }

  async list() {
    const em = this.db.manager;
    const rows = await em.find(FinanceEntry, { order: { date: 'DESC', refNo: 'DESC' } });
    return Promise.all(rows.map((f) => this.view(em, f)));
  }

  async findOne(id: string, em: EntityManager = this.db.manager) {
    const f = await em.findOne(FinanceEntry, { where: { id } });
    if (!f) throw new NotFoundException('Entry not found');
    return this.view(em, f);
  }

  create(dto: CreateFinanceDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      await this.checkCategory(em, dto.category);
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
  ) {}

  private async paidOf(em: EntityManager, id: string): Promise<number> {
    const [r] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM accounting_settlements WHERE "documentId" = $1`, [id]);
    return round2(Number(r.paid));
  }

  private async view(em: EntityManager, a: AccountingDocument) {
    const [st, paid] = await Promise.all([this.posting.accountingState(em, a), this.paidOf(em, a.id)]);
    const due = Math.max(0, round2(Number(a.amount) - paid));
    const noun = a.kind === 'Income' ? ['Collected', 'Receivable'] : ['Paid', 'Payable'];
    const status = !st.approved ? 'Awaiting approval' : due < 0.01 ? noun[0] : due < Number(a.amount) ? 'Partially settled' : noun[1];
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

  /** foreign amount x rate = PKR amount; PKR documents must use rate 1 */
  private async money(em: EntityManager, d: { foreignAmount: number; currency?: string; fxRate?: number }) {
    const currency = d.currency ?? 'PKR';
    const cur = await em.findOne(Currency, { where: { code: currency } });
    if (!cur) throw new BadRequestException(`Currency ${currency} is not set up.`);
    const fxRate = d.fxRate ?? Number(cur.rate);
    if (currency === 'PKR' && Math.abs(fxRate - 1) > 0.0001) throw new BadRequestException('A PKR document must use exchange rate 1.');
    const amount = round2(d.foreignAmount * fxRate);
    if (!(amount > 0)) throw new BadRequestException('Amount and exchange rate must be positive.');
    return { currency, fxRate, foreignAmount: round2(d.foreignAmount), amount };
  }

  create(dto: CreateAccountingDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const s = await this.settings.get(em);
      const refNo = opts.refNo ?? (await nextRef(em, AccountingDocument, s.docPrefixes['accounting'] ?? 'ACC', 3));
      const { foreignAmount: _f, currency: _c, fxRate: _x, ...rest } = dto;
      const a = await em.save(em.create(AccountingDocument, { ...rest, ...(await this.money(em, dto)), refNo, dueDate: dto.dueDate ?? dto.date }));
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
      const { foreignAmount, currency, fxRate, ...rest } = dto;
      const patch: Partial<AccountingDocument> = { ...rest };
      if (foreignAmount !== undefined || currency !== undefined || fxRate !== undefined) {
        Object.assign(patch, await this.money(em, {
          foreignAmount: foreignAmount ?? Number(a.foreignAmount ?? a.amount), currency: currency ?? a.currency, fxRate,
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
