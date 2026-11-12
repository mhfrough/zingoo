import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import {
  AccountingDoc, Budget, CashBookRow, CashFlows, CategoryRow, Currency, FinanceEntry, IncomeStatement,
  FundingPosition, InvestorAccount, JournalLine, OpenItems, Settlement,
} from './models';

/** Every call the Investment & Finance and Income & Expenses pages make. */
@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private api = inject(ApiService);

  // ── reads ──
  entries = () => this.api.get<FinanceEntry[]>('finance');
  /** the accounts that can put money in: people, manufacturers and distributors */
  investorAccounts = () => this.api.get<InvestorAccount[]>('finance/accounts');
  docs = () => this.api.get<AccountingDoc[]>('accounting-documents');
  settlements = () => this.api.get<Settlement[]>('accounting-settlements');
  budgets = () => this.api.get<Budget[]>('reports/budgets');
  categories = (kind?: string) => this.api.get<CategoryRow[]>('categories', { kind });
  currencies = () => this.api.get<Currency[]>('currencies');
  cashFlows = () => this.api.get<CashFlows>('reports/cash-flows');
  periods = () => this.api.get<string[]>('reports/periods');
  incomeStatement = (period: string) => this.api.get<IncomeStatement>('reports/income-statement', { period });
  journal = (period: string) => this.api.get<JournalLine[]>('reports/journal', { period });
  cashBook = (period: string) => this.api.get<CashBookRow[]>('reports/cash-book', { period });
  receivables = () => this.api.get<OpenItems>('reports/receivables');
  payables = () => this.api.get<OpenItems>('reports/payables');

  // ── finance entries ──
  saveEntry = (id: string | null, body: unknown) =>
    id ? this.api.patch<FinanceEntry>(`finance/${id}`, body) : this.api.post<FinanceEntry>('finance', body);
  deleteEntry = (id: string) => this.api.delete(`finance/${id}`);
  /** a capital injection by one investor or several: one entry comes back per investor */
  saveCapital = (body: unknown) => this.api.post<FinanceEntry[]>('finance/capital-injection', body);
  /** a loan or advance now: terms, repayments, spending per stream */
  position = (id: string) => this.api.get<FundingPosition>(`finance/${id}/position`);
  /** record a repayment of a loan or advance (or the markup paid on it); the new position comes back */
  repay = (id: string, body: unknown) => this.api.post<FundingPosition>(`finance/${id}/repayments`, body);
  /** a cheque cleared (cash posts on the clearing date) or bounced */
  markCheque = (id: string, status: 'Cleared' | 'Bounced', date?: string) =>
    this.api.post<FinanceEntry>(`finance/${id}/cheque`, { status, date });
  signEntry = (id: string, seat: 'A' | 'B') => this.api.post<FinanceEntry>(`finance/${id}/sign`, { seat });

  // ── accounting documents ──
  saveDoc = (id: string | null, body: unknown) =>
    id
      ? this.api.patch<AccountingDoc>(`accounting-documents/${id}`, body)
      : this.api.post<AccountingDoc>('accounting-documents', body);
  deleteDoc = (id: string) => this.api.delete(`accounting-documents/${id}`);
  signDoc = (id: string, seat: 'A' | 'B') => this.api.post<AccountingDoc>(`accounting-documents/${id}/sign`, { seat });
  rejectDoc = (id: string, reason: string) => this.api.post<AccountingDoc>(`accounting-documents/${id}/reject`, { reason });
  settleDoc = (id: string, body: unknown) => this.api.post<AccountingDoc>(`accounting-documents/${id}/settle`, body);

  // ── budgets, cost centers, settings ──
  setBudget = (categoryId: string, budget: number) => this.api.patch(`categories/${categoryId}/budget`, { budget });
  createCostCenter = (name: string, budget: number, streamType = '', depreciationRate = 0) =>
    this.api.post('categories/cost-center', { name, budget, streamType, depreciationRate });
  /** set the type of an investment stream (and its depreciation rate when the type is depreciable) */
  setStream = (categoryId: string, streamType: string, depreciationRate = 0) =>
    this.api.patch(`categories/${categoryId}/stream`, { streamType, depreciationRate });
  updateSettings = (body: unknown) => this.api.patch('settings', body);
}
