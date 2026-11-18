import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { containersLabel, fmtMoney } from '../../shared/format';
import { Btn, Field, Offcanvas, RichText } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { FactoryApi, ProductionOrder } from './factory.api';
import { OrderDetail } from './order-detail';

/** "MO-001 · 2 containers of Z10-MAS · PKR 36,720" */
const subjectOf = (o: ProductionOrder | null) =>
  o ? `${o.refNo} · ${containersLabel(o.containers, o.containerUnit ?? o.product.containerUnit)} of ${o.product.sku} · ${fmtMoney(o.value)}` : '';

/** The manufacturer accepts an order, optionally with the date it expects the containers ready. */
@Component({
  selector: 'app-accept-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, OrderDetail],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Accept order" [subtitle]="subject()" split asideLabel="Order details" [dirty]="form.dirty"
      help="Accepting promises the goods by your ready date. Zen Foods and the distributor are told at once.">
      <app-order-detail offcanvasAside [orderId]="open() ? order()?.id : null" />
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Ready by" hint="When the containers will be ready" [wide]="true"
          help="Your best estimate. It shows as tentative until you report the last production step.">
          <input type="date" formControlName="readyDate" [min]="order()?.date ?? ''" />
        </app-field>
        <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
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
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="heading()" [subtitle]="subject()" size="md" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Reason" [wide]="true" [hint]="hint()" [required]="true" [error]="invalid('reason') ? 'Say why' : null">
          <app-rich-text formControlName="reason" [max]="500" [storeMax]="500" />
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
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn, RichText, OrderDetail],
  template: `
    <app-offcanvas #oc [(open)]="open" title="Report progress" [subtitle]="subject()" split asideLabel="Order details" [dirty]="form.dirty"
      help="Tell Zen Foods and the distributor which production step the order has reached. The last step marks it ready to collect or ship.">
      <app-order-detail offcanvasAside [orderId]="open() ? order()?.id : null" />
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        @if (next().length) {
          <app-field label="Step reached" [wide]="true" [required]="true" [hint]="order()?.stage ? 'Now: ' + order()!.stage : 'No step reported yet'"
            help="Only the steps after the current one are offered. The steps are set in Settings (production steps).">
            <select formControlName="stage">
              @for (s of next(); track s) {
                <option [value]="s">{{ s }}</option>
              }
            </select>
          </app-field>
          <app-field label="Note" [wide]="true"><app-rich-text formControlName="note" [max]="500" [storeMax]="500" /></app-field>
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

/** One order in full, read-only: the same details as the left pane of the order panels. */
@Component({
  selector: 'app-order-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, OrderDetail],
  template: `
    <app-offcanvas [(open)]="open" [title]="'Order ' + (refNo() ?? order()?.refNo ?? '')" [subtitle]="order()?.product?.name ?? ''" size="lg">
      <app-order-detail [orderId]="open() ? (orderId() ?? order()?.id) : null" />
    </app-offcanvas>
  `,
})
export class OrderTimeline {
  readonly open = model(false);
  readonly order = input<ProductionOrder | null>(null);
  /** or just the id and number (lists that do not carry the full order) */
  readonly orderId = input<string | null>(null);
  readonly refNo = input<string | null>(null);
}
