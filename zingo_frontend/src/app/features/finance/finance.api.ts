import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import {
  AccountingDoc, Budget, CashBookRow, CashFlows, CategoryRow, Currency, FinanceEntry, IncomeStatement,
  JournalLine, OpenItems, Settlement,
} from './models';

/** Every call the Investment & Finance and Income & Expenses pages make. */
@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private api = inject(ApiService);

  // ── reads ──
  entries = () => this.api.get<FinanceEntry[]>('finance');
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
  signEntry = (id: string, seat: 'A' | 'B') => this.api.post<FinanceEntry>(`finance/${id}/sign`, { seat });

  // ── accounting documents ──
  saveDoc = (id: string | null, body: unknown) =>
    id
      ? this.api.patch<AccountingDoc>(`accounting-documents/${id}`, body)
      : this.api.post<AccountingDoc>('accounting-documents', body);
  deleteDoc = (id: string) => this.api.delete(`accounting-documents/${id}`);
  signDoc = (id: string, seat: 'A' | 'B') => this.api.post<AccountingDoc>(`accounting-documents/${id}/sign`, { seat });
  settleDoc = (id: string, body: unknown) => this.api.post<AccountingDoc>(`accounting-documents/${id}/settle`, body);

  // ── budgets, cost centers, settings ──
  setBudget = (categoryId: string, budget: number) => this.api.patch(`categories/${categoryId}/budget`, { budget });
  createCostCenter = (name: string, budget: number) => this.api.post('categories/cost-center', { name, budget });
  updateSettings = (body: unknown) => this.api.patch('settings', body);
}
