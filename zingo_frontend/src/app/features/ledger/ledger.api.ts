import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Account, Aged, BalanceSheet, LedgerLine, TrialBalance, Voucher } from './models';

/** Every call the General Ledger page makes (periods, income statement and cash flows come from FinanceApi). */
@Injectable({ providedIn: 'root' })
export class LedgerApi {
  private api = inject(ApiService);

  trialBalance = () => this.api.get<TrialBalance>('reports/trial-balance');
  /** one account (by code) or 'all', oldest first, with the running balance */
  accountLedger = (code: string, period: string) => this.api.get<LedgerLine[]>('reports/account-ledger', { code, period });
  balanceSheet = () => this.api.get<BalanceSheet>('reports/balance-sheet');
  aged = () => this.api.get<Aged>('reports/aged-receivables');
  vouchers = () => this.api.get<Voucher[]>('journal-vouchers');
  accounts = () => this.api.get<Account[]>('accounts');

  createVoucher = (body: unknown) => this.api.post<Voucher>('journal-vouchers', body);
  reverseVoucher = (id: string) => this.api.post<Voucher>(`journal-vouchers/${id}/reverse`, {});
  createAccount = (body: unknown) => this.api.post<Account>('accounts', body);
  updateAccount = (id: string, body: unknown) => this.api.patch<Account>(`accounts/${id}`, body);
}
