import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JournalSource, RefType } from '../common/enums';
import { AccountsService } from '../setup/setup.service';
import { LedgerEntry } from './ledger.entities';

export interface LedgerRow {
  date: string;
  source: JournalSource;
  reference: string;
  description: string;
  /** account NAME, e.g. 'Cash & Bank' or 'Expense · Marketing' */
  account: string;
  debit: number;
  credit: number;
  currency?: string | null;
  fxRate?: number | null;
}

@Injectable()
export class LedgerService {
  constructor(private readonly accounts: AccountsService) {}

  /** Replaces every line written by one document with `rows` (pass [] to remove them). */
  async replace(em: EntityManager, refType: RefType, refId: string, rows: LedgerRow[]) {
    await em.delete(LedgerEntry, { refType, refId });
    for (const r of rows) {
      const accountCode = await this.accounts.codeFor(em, r.account);
      await em.insert(LedgerEntry, {
        entryDate: r.date,
        source: r.source,
        reference: r.reference,
        description: r.description,
        accountCode,
        debit: r.debit,
        credit: r.credit,
        refType,
        refId,
        currency: r.currency ?? null,
        fxRate: r.fxRate ?? null,
      });
    }
  }
}
