import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { fmtDate, fmtMoney, fmtNumber } from '../../shared/format';
import { Btn, Field, Offcanvas, Tag } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FactoryApi, ORDER_TONE, ProductionOrder, orderState } from './factory.api';

/** "MO-001 · 2 containers of Z10-MAS · PKR 36,720" */
const subjectOf = (o: ProductionOrder | null) =>
  o ? `${o.refNo} · ${fmtNumber(o.containers)} container${o.containers > 1 ? 's' : ''} of ${o.product.sku} · ${fmtMoney(o.value)}` : '';

/** The manufacturer accepts an order, optionally with the date it expects the containers ready. */
@Component({
  selector: 'app-accept-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Accept order" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Ready by" hint="When the containers will be ready" [wide]="true">
          <input type="date" formControlName="readyDate" [min]="order()?.date ?? ''" />
        </app-field>
        <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">Accept order</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class AcceptOrderForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly order = input<ProductionOrder | null>(null);
  readonly formId = 'form-accept-order';
  readonly form = this.fb.nonNullable.group({ readyDate: [''], note: [''] });
  protected subject = computed(() => subjectOf(this.order()));

  protected reset() {
    this.form.reset({ readyDate: this.order()?.dueDate ?? '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.accept(this.order()!.id, { ...(v.readyDate ? { readyDate: v.readyDate } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) });
  }

  protected successMessage() {
    return 'Order accepted. The company is told.';
  }
}

/** Reject (manufacturer) or cancel (company) an order with a reason. */
@Component({
  selector: 'app-order-reason-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="heading()" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Reason" [wide]="true" [hint]="hint()" [required]="true" [error]="invalid('reason') ? 'Say why' : null">
          <textarea formControlName="reason" rows="3" maxlength="500"></textarea>
        </app-field>
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Keep order</button>
        <button appBtn variant="danger" type="submit" [attr.form]="formId" [loading]="busy()">{{ actionLabel() }}</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderReasonForm extends FormModal {
  readonly order = input<ProductionOrder | null>(null);
  readonly heading = input('Reject order');
  readonly actionLabel = input('Reject order');
  readonly hint = input('The other side sees this');
  readonly run = input<(reason: string) => Observable<unknown>>();
  readonly done = input('Done.');
  readonly formId = 'form-order-reason';
  readonly form = this.fb.nonNullable.group({ reason: ['', Validators.required] });
  protected subject = computed(() => subjectOf(this.order()));

  protected reset() {
    this.form.reset({ reason: '' });
  }

  protected request() {
    return this.run()!(this.form.getRawValue().reason.trim());
  }

  protected successMessage() {
    return this.done();
  }
}

/** The manufacturer reports the production step it has reached (only later steps are offered). */
@Component({
  selector: 'app-order-stage-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report progress" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        @if (next().length) {
          <app-field label="Step reached" [wide]="true" [required]="true" [hint]="order()?.stage ? 'Now: ' + order()!.stage : 'No step reported yet'">
            <select formControlName="stage">
              @for (s of next(); track s) {
                <option [value]="s">{{ s }}</option>
              }
            </select>
          </app-field>
          <app-field label="Note" [wide]="true"><textarea formControlName="note" rows="2" maxlength="500"></textarea></app-field>
        } @else {
          <p class="notice">Every production step is reported. Shipping comes next.</p>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()" [disabled]="!next().length">Report step</button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class OrderStageForm extends FormModal {
  private factory = inject(FactoryApi);
  readonly order = input<ProductionOrder | null>(null);
  /** every production step, in order (Settings list) */
  readonly stages = input<string[]>([]);
  readonly formId = 'form-order-stage';
  readonly form = this.fb.nonNullable.group({ stage: ['', Validators.required], note: [''] });
  protected subject = computed(() => subjectOf(this.order()));
  /** only the steps after the current one */
  protected next = computed(() => {
    const all = this.stages();
    const now = this.order()?.stage ? all.indexOf(this.order()!.stage!) : -1;
    return all.slice(now + 1);
  });

  protected reset() {
    this.form.reset({ stage: this.next()[0] ?? '', note: '' });
  }

  protected request() {
    const v = this.form.getRawValue();
    return this.factory.stage(this.order()!.id, { stage: v.stage, ...(v.note.trim() ? { note: v.note.trim() } : {}) });
  }

  protected successMessage() {
    return 'Progress reported.';
  }
}

/** One order in full: what was ordered, where it goes, the money, and its timeline. Read-only. */
@Component({
  selector: 'app-order-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, Tag],
  styles: `
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
      gap: var(--space-3) var(--space-4);
      margin: 0 0 var(--space-5);

      & dt {
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & dd {
        margin: var(--space-1) 0 0;
        font-variant-numeric: tabular-nums;
      }
    }

    .events {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      border-inline-start: 2px solid var(--border);
      padding-inline-start: var(--space-4);

      & li strong {
        display: block;
      }

      & small {
        color: var(--text-3);
      }

      & p {
        margin: var(--space-1) 0 0;
      }
    }

    h3 {
      margin: 0 0 var(--space-3);
      font-size: var(--text-md);
    }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="order() ? 'Order ' + order()!.refNo : 'Order'" [subtitle]="order()?.product?.name ?? ''" size="md">
      @if (order(); as o) {
        <dl class="facts">
          <div><dt>Status</dt><dd><app-tag [tone]="tone(o)">{{ state(o) }}</app-tag></dd></div>
          <div><dt>Product</dt><dd>{{ o.product.sku }} · {{ o.product.name }}</dd></div>
          <div><dt>Containers</dt><dd>{{ num(o.containers) }} · {{ num(o.bundles) }} bundles · {{ num(o.packets) }} packets</dd></div>
          <div><dt>Manufacturer</dt><dd>{{ o.manufacturer.name }}</dd></div>
          <div><dt>Deliver to</dt><dd>{{ o.destination === 'Warehouse' ? 'Zen Foods warehouse' : o.distributor?.name }}</dd></div>
          <div><dt>Rate per packet</dt><dd>{{ money(o.rate) }}</dd></div>
          <div><dt>Order value</dt><dd>{{ money(o.value) }}</dd></div>
          <div><dt>Advance {{ o.advancePct }}%</dt><dd>{{ money(o.advanceAmount) }}</dd></div>
          <div><dt>Ordered</dt><dd>{{ date(o.date) }}</dd></div>
          <div><dt>Deliver by</dt><dd>{{ o.dueDate ? date(o.dueDate) : '-' }}{{ o.overdue ? ' · late' : '' }}</dd></div>
          <div><dt>Ready by</dt><dd>{{ o.readyDate ? date(o.readyDate) : '-' }}</dd></div>
          @if (o.reason) {
            <div><dt>Reason</dt><dd>{{ o.reason }}</dd></div>
          }
          @if (o.notes) {
            <div><dt>Notes</dt><dd>{{ o.notes }}</dd></div>
          }
        </dl>
        <h3>Timeline</h3>
        <ol class="events">
          @for (e of o.events; track e.id) {
            <li>
              <strong>{{ e.event }}</strong>
              <small>{{ when(e.createdAt) }} · {{ e.by }} ({{ e.side.toLowerCase() }})</small>
              @if (e.note) {
                <p>{{ e.note }}</p>
              }
            </li>
          }
        </ol>
      }
    </app-offcanvas>
  `,
})
export class OrderTimeline {
  readonly open = model(false);
  readonly order = input<ProductionOrder | null>(null);
  protected tone = (o: ProductionOrder) => ORDER_TONE[o.status];
  protected state = orderState;
  protected num = fmtNumber;
  protected money = fmtMoney;
  protected date = fmtDate;
  protected when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
