import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AttachmentMeta, AttachmentsApi } from '../../core/attachments.api';
import { SettingsStore } from '../../core/settings.store';
import { errorText } from '../../shared/errors';
import { fmtDate, fmtMoney } from '../../shared/format';
import { Btn, Kpi, Offcanvas, Tag, ToastService } from '../../ui';
import { FinanceApi } from './finance.api';
import { FinanceEntry } from './models';

/**
 * A loan or advance as it stands: what was funded, what has been paid back and what is still open, what is
 * allocated to each stream and spent from it, the terms, and every repayment. The "Record payment" button asks
 * the page to open the repayment form.
 */
@Component({
  selector: 'app-funding-position',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, Btn, Kpi, Tag],
  styles: `
    :host {
      display: contents;
    }

    h3 {
      margin: var(--space-6) 0 var(--space-2);
      font-size: var(--text-md);
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
      gap: var(--space-3);
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
      gap: var(--space-3) var(--space-5);
      margin: 0;

      & dt {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & dd {
        margin: 0;
        font-size: var(--text-md);
        overflow-wrap: anywhere;
      }
    }

    .t {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-md);

      & th {
        padding: var(--space-2) var(--space-3);
        text-align: start;
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-3);
        border-block-end: 1px solid var(--border-strong);
      }

      & td {
        padding: var(--space-2) var(--space-3);
        border-block-end: 1px solid var(--border);
        vertical-align: top;
      }

      & .num {
        text-align: end;
        white-space: nowrap;
      }

      & small {
        display: block;
        color: var(--text-3);
      }
    }

    .t-wrap {
      overflow-x: auto;
    }

    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent-text);
      font: inherit;
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="title()" [subtitle]="subtitle()" size="xl">
      @if (pos.error()) {
        <div class="notice" data-tone="danger" role="alert">{{ errorMsg() }}</div>
      }
      @if (e(); as e) {
        <div class="metrics">
          <app-kpi label="Original funding" [value]="money(e.amount)" icon="piggy-bank" tone="accent" [foot]="e.funding" />
          <app-kpi [label]="outstandingLabel()" [value]="money(e.outstanding)" icon="clock" [tone]="e.outstanding ? 'warning' : 'success'"
            [foot]="e.outstanding ? 'Not reduced by spending' : 'Settled'" />
          <app-kpi label="Principal repaid" [value]="money(e.repaid)" icon="wallet" tone="success" />
          @if (e.markupPct || e.markupPaid) {
            <app-kpi label="Markup paid" [value]="money(e.markupPaid)" icon="coins" tone="info"
              [foot]="p()!.projectedMarkup ? 'Projected simple markup ' + money(p()!.projectedMarkup) : ''" />
          }
          <app-kpi label="Used for spending" [value]="money(e.usedAmount)" icon="coins" tone="info" [foot]="'Still available ' + money(available())" />
        </div>

        <h3>Terms</h3>
        <dl class="facts">
          @for (f of facts(); track f[0]) {
            <div><dt>{{ f[0] }}</dt><dd>{{ f[1] }}</dd></div>
          }
          @if (e.agreement) {
            <div><dt>Agreement</dt><dd><button type="button" class="link" (click)="download(e.agreement)">{{ e.agreement.name }}</button></dd></div>
          }
          @if (e.proof) {
            <div><dt>Payment proof</dt><dd><button type="button" class="link" (click)="download(e.proof)">{{ e.proof.name }}</button></dd></div>
          }
        </dl>

        <h3>Streams: allocated, spent and left</h3>
        <div class="t-wrap">
          <table class="t">
            <thead><tr><th scope="col">Stream</th><th scope="col" class="num">Allocated (PKR)</th><th scope="col" class="num">Spent (PKR)</th><th scope="col" class="num">Left (PKR)</th></tr></thead>
            <tbody>
              @for (s of p()!.streams; track s.stream) {
                <tr>
                  <td>{{ s.stream }}<small>{{ s.pct }}% of the funding</small></td>
                  <td class="num mono">{{ money(s.allocated) }}</td>
                  <td class="num mono">{{ money(s.spent) }}</td>
                  <td class="num mono">{{ money(s.available) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="4">Nothing is allocated to a stream.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (p()!.unallocated > 0) {
          <p class="muted">{{ money(p()!.unallocated) }} is not placed on a stream, so it is not tied to any spending.</p>
        }

        @if (p()!.spends.length) {
          <h3>Spending paid from this funding</h3>
          <div class="t-wrap">
            <table class="t">
              <thead><tr><th scope="col">Entry</th><th scope="col">Stream</th><th scope="col">Paid to</th><th scope="col" class="num">Amount (PKR)</th><th scope="col">Status</th></tr></thead>
              <tbody>
                @for (s of p()!.spends; track s.id) {
                  <tr>
                    <td>{{ s.refNo }}<small>{{ date(s.date) }}</small></td>
                    <td>{{ s.category }}</td>
                    <td>{{ s.party || '-' }}</td>
                    <td class="num mono">{{ money(s.amount) }}</td>
                    <td><app-tag [tone]="s.approved ? 'success' : 'warning'">{{ s.approved ? 'Approved' : 'Awaiting approval' }}</app-tag></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <h3>{{ e.direction === 'out' ? 'Repayments received' : 'Repayments' }}</h3>
        <div class="t-wrap">
          <table class="t">
            <thead><tr><th scope="col">Payment</th><th scope="col">Applied against</th><th scope="col" class="num">Amount (PKR)</th><th scope="col">Method</th><th scope="col">Proof</th></tr></thead>
            <tbody>
              @for (r of p()!.repayments; track r.id) {
                <tr>
                  <td>{{ r.refNo }}<small>{{ date(r.date) }}</small></td>
                  <td>{{ r.kind === 'markup' ? 'Markup' : 'Principal' }}@if (r.note) {<small>{{ r.note }}</small>}</td>
                  <td class="num mono">{{ money(r.amount) }}</td>
                  <td>{{ r.method || '-' }}@if (r.reference) {<small>{{ r.reference }}</small>}</td>
                  <td>@if (r.proof) { <button type="button" class="link" (click)="download(r.proof)">Download</button> } @else { - }</td>
                </tr>
              } @empty {
                <tr><td colspan="5">No payments recorded yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (pos.isLoading()) {
        <p class="muted">Loading…</p>
      }
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="open.set(false)">Close</button>
        @if (canWrite() && e()?.liability) {
          <button appBtn variant="primary" icon="plus" (click)="repay.emit(e()!)">Record payment</button>
        }
      </ng-container>
    </app-offcanvas>
  `,
})
export class FundingPositionView {
  readonly open = model(false);
  /** the capital entry (a loan or advance) to show */
  readonly entryId = input<string | null>(null);
  /** whether the user may record payments */
  readonly canWrite = input(false);
  /** changes whenever the page reloaded its data, so the position is read again */
  readonly version = input(0);
  /** the user wants to record a payment against this entry */
  readonly repay = output<FinanceEntry>();

  private fin = inject(FinanceApi);
  private files = inject(AttachmentsApi);
  private toast = inject(ToastService);
  private store = inject(SettingsStore);

  protected pos = rxResource({
    params: () => (this.open() && this.entryId() ? { id: this.entryId()!, v: this.version() } : undefined),
    stream: ({ params }) => this.fin.position(params.id),
  });
  protected p = computed(() => this.pos.value() ?? null);
  protected e = computed(() => this.p()?.entry ?? null);
  protected money = fmtMoney;
  protected date = fmtDate;
  protected errorMsg = computed(() => (this.pos.error() ? errorText(this.pos.error()) : ''));

  protected title = computed(() => (this.e() ? `${this.e()!.refNo} · ${this.e()!.party}` : 'Funding position'));
  protected subtitle = computed(() => {
    const e = this.e();
    return e ? `${e.funding}${e.direction === 'out' ? ' paid out to a partner' : ''} · ${fmtDate(e.date)}` : '';
  });
  protected outstandingLabel = computed(() => {
    const e = this.e();
    if (!e) return 'Outstanding';
    if (e.direction === 'out') return 'Receivable from partner';
    const advance = this.store.lookups().find((l) => l.list === 'CAPITAL_SOURCE' && l.code === e.funding)?.flags['advance'];
    return advance ? 'Advance payable to partner' : 'Outstanding loan principal';
  });
  /** what can still be spent across the streams */
  protected available = computed(() => (this.p()?.streams ?? []).reduce((n, s) => n + s.available, 0));

  /** the terms that were filled in, as label and value */
  protected facts = computed<[string, string][]>(() => {
    const e = this.e();
    if (!e) return [];
    const rows: [string, string | null][] = [
      ['Account', [e.party, e.partyType].filter(Boolean).join(' · ')],
      ['Funding date', fmtDate(e.date)],
      ['Due / expected back', e.expectedReturnDate ? fmtDate(e.expectedReturnDate) : null],
      ['Paid by', e.paymentSource ? [e.paymentSource, e.paymentReference].filter(Boolean).join(' · ') : null],
      [e.direction === 'out' ? 'Paying account' : 'Receiving account', e.bankAccount || null],
      ['Loan tenure', e.tenure || null],
      ['Repayment plan', [e.repaymentPlan, e.repaymentFrequency].filter(Boolean).join(' · ') || null],
      ['Annual markup', e.markupPct ? `${e.markupPct}%` : null],
      ['Advance purpose', e.purpose || null],
      ['Settlement method', e.settlementMethod || null],
      ['Linked invoice / PO', e.linkedReference || null],
      ['Terms', e.note || null],
    ];
    return rows.filter((r): r is [string, string] => !!r[1]);
  });

  protected download(file: AttachmentMeta | null) {
    if (file) this.files.download(file).subscribe({ error: (err) => this.toast.error(errorText(err)) });
  }
}
