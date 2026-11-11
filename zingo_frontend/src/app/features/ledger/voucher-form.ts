import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { fmtAmount2 } from '../../shared/format';
import { Btn, Field, MoneyInput, Offcanvas } from '../../ui';
import { Currency } from '../finance/models';
import { FormModal } from '../ops/form-modal';
import { LedgerApi } from './ledger.api';
import { Account } from './models';

const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

type LineGroup = FormGroup<{ account: FormControl<string>; debit: FormControl<number>; credit: FormControl<number> }>;

/** A voucher is valid when at least two lines carry an amount, each on one side only, and the two sides are equal. */
function balanced(group: AbstractControl): ValidationErrors | null {
  const lines = (group.get('lines') as FormArray).getRawValue() as { account: string; debit: number; credit: number }[];
  const used = lines.filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0);
  if (used.length < 2) return { lines: 'Use at least two lines with an amount.' };
  if (used.some((l) => !l.account)) return { lines: 'Choose an account on every line with an amount.' };
  if (used.some((l) => Number(l.debit) > 0 && Number(l.credit) > 0)) return { lines: 'Enter either a debit or a credit on a line, not both.' };
  const d = r2(used.reduce((n, l) => n + Number(l.debit || 0), 0));
  const c = r2(used.reduce((n, l) => n + Number(l.credit || 0), 0));
  return Math.abs(d - c) > 0.001 ? { lines: `Debits ${fmtAmount2(d)} and credits ${fmtAmount2(c)} must be equal.` } : null;
}

/**
 * Post a manual multi-line journal voucher (an adjustment, a correction, an opening balance).
 * Amounts are typed in the voucher currency; the PKR equivalents are what post. A posted voucher is never edited:
 * it is undone by a reversing voucher, so the audit trail stays whole.
 */
@Component({
  selector: 'app-voucher-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, MoneyInput, Btn],
  styles: `
    /* the grid of voucher lines: account, debit, credit, remove */
    .voucher-lines {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      align-items: flex-start;

      & .voucher-lines__head,
      & .voucher-line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 7rem 7rem var(--btn-h-sm);
        gap: var(--space-2);
        inline-size: 100%;
        align-items: center;
      }

      & .voucher-lines__head {
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
      }

      @media (max-width: 640px) {
        & .voucher-lines__head {
          display: none;
        }

        & .voucher-line {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--btn-h-sm);

          & .line-account {
            grid-column: 1 / -1;
          }
        }
      }
    }
  `,
  template: `
    <app-offcanvas #oc [(open)]="open" title="Post a journal voucher"
               subtitle="Debits and credits must be equal. Use two or more lines to spread a cost over several accounts." size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Voucher date" [required]="true"><input type="date" formControlName="date" /></app-field>
        <app-field label="Description / reason" [required]="true" [error]="invalid('memo') ? 'Say why this is being posted' : null">
          <input type="text" formControlName="memo" />
        </app-field>
        <app-field label="Currency">
          <select formControlName="currency">
            @for (c of currencies(); track c.code) {
              <option [value]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </app-field>
        <app-field label="Exchange rate" hint="PKR per 1 unit of the currency">
          <input type="number" formControlName="fxRate" min="0" step="any" />
        </app-field>

        <div class="voucher-lines" formArrayName="lines">
          <div class="voucher-lines__head" aria-hidden="true"><span>Account</span><span>Debit</span><span>Credit</span><span></span></div>
          @for (g of groups(); track g; let i = $index) {
            <div class="voucher-line" [formGroupName]="i">
              <div class="field line-account"><div class="field__control">
                <select formControlName="account" [attr.aria-label]="'Account, line ' + (i + 1)">
                  <option value="">Choose an account</option>
                  @for (a of accounts(); track a.id) {
                    <option [value]="a.name">{{ a.code }} · {{ a.name }}</option>
                  }
                </select>
              </div></div>
              <div class="field"><div class="field__control">
                <app-money-input formControlName="debit" currency="" placeholder="Debit" [ariaLabel]="'Debit, line ' + (i + 1)" />
              </div></div>
              <div class="field"><div class="field__control">
                <app-money-input formControlName="credit" currency="" placeholder="Credit" [ariaLabel]="'Credit, line ' + (i + 1)" />
              </div></div>
              <button appBtn type="button" size="sm" variant="ghost" icon="x" [disabled]="groups().length <= 2"
                      [attr.aria-label]="'Remove line ' + (i + 1)" (click)="removeLine(i)"></button>
            </div>
          }
          <button appBtn type="button" size="sm" icon="plus" (click)="addLine()">Add a line</button>
        </div>
      </form>
      <div class="notice" [attr.data-tone]="problem() ? 'warning' : null">
        <span>
          Debits <strong>{{ amount(totals().debit) }}</strong> · Credits <strong>{{ amount(totals().credit) }}</strong>
          @if (problem(); as p) { · {{ p }} } @else if (totals().debit) { · Balanced. } @else { · Enter amounts on at least two lines. }
        </span>
      </div>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Post voucher</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class VoucherForm extends FormModal {
  readonly accounts = input<Account[]>([]);
  readonly currencies = input<Currency[]>([]);
  readonly formId = 'form-voucher';
  protected amount = fmtAmount2;
  private ledger = inject(LedgerApi);

  private line = (): LineGroup => this.fb.nonNullable.group({ account: [''], debit: [0, Validators.min(0)], credit: [0, Validators.min(0)] });

  readonly lines = new FormArray<LineGroup>([this.line(), this.line()]);
  readonly form = this.fb.nonNullable.group(
    { date: [today(), Validators.required], memo: ['', Validators.required], currency: ['PKR'], fxRate: [1, Validators.min(0.000001)], lines: this.lines },
    { validators: balanced },
  );

  /** the line groups drawn in the template (kept as a signal so adding and removing lines redraws it) */
  protected groups = signal<LineGroup[]>(this.lines.controls);

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected totals = computed(() => {
    const ls = (this.value().lines ?? []) as { debit: number; credit: number }[];
    return { debit: r2(ls.reduce((n, l) => n + Number(l.debit || 0), 0)), credit: r2(ls.reduce((n, l) => n + Number(l.credit || 0), 0)) };
  });
  /** why the voucher cannot be posted yet, shown once something has been typed */
  protected problem = computed(() => {
    this.value();
    const t = this.totals();
    return t.debit || t.credit ? (this.form.errors?.['lines'] as string | undefined) ?? null : null;
  });

  constructor() {
    super();
    // picking a currency fills its rate
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      const rate = this.currencies().find((c) => c.code === code)?.rate;
      this.form.controls.fxRate.setValue(code === 'PKR' ? 1 : Number(rate ?? 1));
    });
  }

  protected addLine() {
    this.lines.push(this.line());
    this.groups.set([...this.lines.controls]);
  }

  protected removeLine(i: number) {
    if (this.lines.length <= 2) return;
    this.lines.removeAt(i);
    this.groups.set([...this.lines.controls]);
  }

  protected reset() {
    this.lines.clear();
    this.lines.push(this.line());
    this.lines.push(this.line());
    this.groups.set([...this.lines.controls]);
    this.form.reset({ date: today(), memo: '', currency: 'PKR', fxRate: 1 });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.ledger.createVoucher({
      date: v.date, memo: v.memo, currency: v.currency, fxRate: Number(v.fxRate),
      lines: v.lines.filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0),
    });
  }

  protected successMessage() {
    return 'Voucher posted to the journal.';
  }
}
