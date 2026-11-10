import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { Account, Currency } from '../setup/setup.entities';
import { JournalVoucher } from './ledger.entities';
import { PostingService } from './posting.service';
import { CreateVoucherDto } from './vouchers.dto';

/**
 * Manual multi-line journal vouchers (adjustments, corrections, opening balances).
 * A posted voucher is never edited: a mistake is undone by a reversing voucher, so the audit trail stays whole.
 */
@Injectable()
export class VouchersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly posting: PostingService,
  ) {}

  list() {
    return this.db.manager.find(JournalVoucher, { order: { date: 'DESC', refNo: 'DESC' } });
  }

  async create(dto: CreateVoucherDto, opts: { refNo?: string } = {}) {
    return this.db.transaction(async (em) => {
      const currency = dto.currency ?? 'PKR';
      const cur = await em.findOne(Currency, { where: { code: currency } });
      if (!cur) throw new BadRequestException(`Currency ${currency} is not set up.`);
      const fxRate = dto.fxRate ?? Number(cur.rate);
      if (currency === 'PKR' && Math.abs(fxRate - 1) > 0.0001) throw new BadRequestException('A PKR voucher must use exchange rate 1.');

      const lines = dto.lines
        .map((l) => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit) }))
        .filter((l) => l.debit > 0 || l.credit > 0);
      if (lines.length < 2) throw new BadRequestException('A voucher needs at least two lines with an amount.');
      if (lines.some((l) => l.debit > 0 && l.credit > 0)) throw new BadRequestException('Enter either a debit or a credit on each line, not both.');
      const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
      const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
      if (Math.abs(debit - credit) > 0.001) {
        throw new BadRequestException(`Debits (${debit}) and credits (${credit}) must be equal.`);
      }
      const names = [...new Set(lines.map((l) => l.account))];
      const accounts = await em.find(Account, { where: names.map((name) => ({ name })) });
      for (const name of names) {
        const a = accounts.find((x) => x.name === name);
        if (!a) throw new BadRequestException(`Unknown ledger account "${name}".`);
        if (!a.active) throw new BadRequestException(`Account "${name}" is switched off.`);
      }

      const refNo = opts.refNo ?? (await nextRef(em, JournalVoucher, 'JV', 3));
      const v = await em.save(em.create(JournalVoucher, { refNo, date: dto.date, memo: dto.memo, currency, fxRate, status: 'Posted', lines }));
      await this.posting.syncVoucher(em, v.id);
      return v;
    });
  }

  /** post an opposite voucher; the original stays visible and is marked Reversed */
  reverse(id: string) {
    return this.db.transaction(async (em) => {
      const old = await em.findOne(JournalVoucher, { where: { id } });
      if (!old) throw new NotFoundException('Voucher not found');
      if (old.status === 'Reversed') throw new BadRequestException('This voucher has already been reversed.');
      if (old.reverses) throw new BadRequestException('A reversing voucher cannot itself be reversed.');
      const refNo = await nextRef(em, JournalVoucher, 'REV', 3);
      const back = await em.save(em.create(JournalVoucher, {
        refNo,
        date: new Date().toISOString().slice(0, 10),
        memo: `REVERSAL of ${old.refNo} · ${old.memo}`,
        currency: old.currency,
        fxRate: old.fxRate,
        status: 'Posted',
        reverses: old.refNo,
        lines: old.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      }));
      old.status = 'Reversed';
      await em.save(old);
      await this.posting.syncVoucher(em, back.id);
      return back;
    });
  }
}
