import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { errorText } from '../../shared/errors';
import { Tone, containersLabel, dueCountdown, fmtDate, fmtAmount2, fmtDateTime, fmtMoney, fmtNumber } from '../../shared/format';
import { printVoucher } from '../../shared/print';
import { Btn, ConfirmService, Help, IconComponent, PlainPipe, RichPipe, SkeletonText, Tag, ToastService } from '../../ui';
import { AuthService } from '../../core/auth.service';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, AttachmentsApi } from '../../core/attachments.api';
import { OrderInvoiceForm } from './order-invoice-form';
import { FactoryApi, ORDER_TONE, OrderClaim, OrderDetailData, OrderDoc, OrderInvoice, OrderLoad, ProductionOrder, orderState } from './factory.api';
import { dispatchVoucher, orderVoucher } from './vouchers';

const today = () => new Date().toISOString().slice(0, 10);

type StepState = 'done' | 'now' | 'next';

/**
 * One production order in full, for the left pane of an order panel (Accept, Report progress, Collect, View):
 * the step it has reached, what was ordered, who makes it and where it goes, the dates, the money (staff and the
 * manufacturer only: the API leaves it out for a distributor), every load that left with its transport, the claims,
 * the notes and the timeline. What it shows follows the status: loads and claims appear once something has moved.
 *
 *   <app-offcanvas split ...>
 *     <app-order-detail offcanvasAside [orderId]="order()?.id" />
 *     <form>...</form>
 *   </app-offcanvas>
 */
@Component({
  selector: 'app-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, Help, IconComponent, PlainPipe, RichPipe, SkeletonText, Tag, OrderInvoiceForm],
  styles: `
    .formula + .formula,
    .formula + .facts {
      margin-block-start: var(--space-2);
    }

    .formula__sku {
      font-weight: var(--weight-semibold);
      color: var(--text);
    }

    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);

      & h3 {
        margin: 0;
        font-size: var(--text-lg);
      }

      & .head__id {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
    }

    section h4 {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      margin: 0 0 var(--space-2);
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    /* the production steps as a row of chips: done (tick), now (filled), next (outline) */
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;

      & li {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px var(--space-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface-card);
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & li[data-state='done'] {
        color: var(--tone-success-fg);
        border-color: color-mix(in srgb, var(--tone-success-fg) 35%, transparent);
      }

      & li[data-state='now'] {
        background: var(--accent-text);
        border-color: var(--accent-text);
        color: var(--text-inverse);
        font-weight: var(--weight-semibold);
      }
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10.5rem, 100%), 1fr));
      gap: var(--space-3) var(--space-4);
      margin: 0;

      & dt {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & dd {
        margin: 2px 0 0;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }

      & small {
        display: block;
        color: var(--text-3);
        font-size: var(--text-xs);
      }
    }

    .tentative {
      color: var(--tone-warning-fg);
      font-size: var(--text-xs);
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;

      & li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-card);
        font-size: var(--text-sm);
      }

      & .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-1) var(--space-2);
      }

      & small {
        color: var(--text-3);
      }
    }

    .events {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-sm);

      & li {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr);
        gap: var(--space-2);
      }

      & .dot {
        inline-size: 8px;
        block-size: 8px;
        margin-block-start: 5px;
        border-radius: 50%;
        background: var(--border-strong);
      }

      & li:last-child .dot {
        background: var(--accent-text);
      }

      & small {
        display: block;
        color: var(--text-3);
      }

      & p {
        margin: 2px 0 0;
      }
    }

    .movement {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-2);
      margin: 0 0 var(--space-2);

      & div {
        padding: var(--space-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-card);
        text-align: center;
      }

      & strong {
        display: block;
        font-size: var(--text-lg);
        font-variant-numeric: tabular-nums;
      }

      & span {
        font-size: var(--text-xs);
        color: var(--text-3);
      }
    }

    .rich {
      font-size: var(--text-sm);
    }

    .grid-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);
    }

    /* a small read-only table inside the panel */
    .mini {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;

      & th {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        text-align: start;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      & td {
        padding: var(--space-2);
        border-block-end: 1px solid var(--border);
        vertical-align: top;
      }

      & td small {
        display: block;
        color: var(--text-3);
        font-size: var(--text-xs);
      }

      & tfoot td {
        font-weight: var(--weight-semibold);
        border-block-end: 0;
      }

      & th:not(:first-child),
      & td:not(:first-child) {
        text-align: end;
      }
    }

    .row__end {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }

    .docbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin-block-end: var(--space-2);
    }

    /* a file picker that looks like a small button */
    .upload {
      position: relative;
      cursor: pointer;

      & input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
  `,
  template: `
    @if (detail.isLoading() && !detail.value()) {
      <app-skeleton-text [lines]="10" />
    } @else if (detail.error()) {
      <div class="notice" data-tone="danger" role="alert">{{ errorMsg() }}</div>
    } @else if (detail.value(); as d) {
      @let o = d.order;
      <div class="head">
        <div class="head__id">
          <h3>{{ multi(d) ? (o.groupRef ?? o.refNo) : o.refNo }}</h3>
          <app-tag [tone]="tone(o)">{{ state(o) }}</app-tag>
        </div>
        @if (hasMoney(o)) {
          <button appBtn size="sm" icon="download" type="button" (click)="print(o)"
            title="Opens the print dialog: print it, or choose Save as PDF">Voucher / PDF</button>
        }
      </div>

      <section>
        <h4>Progress
          <app-help title="Progress" text="Sent: waiting for the manufacturer. Accepted: in production; each production step is reported as it is reached. The last step means the goods are ready to collect or ship." />
        </h4>
        <ol class="steps">
          @for (s of steps(); track s.label) {
            <li [attr.data-state]="s.state">
              @if (s.state === 'done') { <app-icon name="check" [size]="12" /> }
              {{ s.label }}
            </li>
          }
        </ol>
      </section>

      @if (multi(d)) {
        <section>
          <h4>Products
            <app-help title="Products" text="This order holds several products from one manufacturer. Each product line is answered, made and dispatched together; its production order number is shown under it." />
          </h4>
          <div class="grid-wrap">
            <table class="mini">
              <thead><tr><th>Product</th><th>Containers</th>@if (dispatched(d)) { <th>Ready</th><th>Damaged in production</th> }<th>Bundles</th><th>Packets</th>@if (hasMoney(o)) { <th>Value</th> }</tr></thead>
              <tbody>
                @for (l of d.lines; track l.id) {
                  <tr>
                    <td><strong>{{ l.product.name }}</strong><small>{{ l.product.sku }} · {{ l.refNo }}{{ l.packaging ? ' · ' + l.packaging : '' }}</small></td>
                    <td>{{ unitLabel(l.containers, l.containerUnit ?? l.product.containerUnit) }}</td>
                    @if (dispatched(d)) {
                      <td>{{ l.readyContainers ?? '-' }}</td>
                      <td>{{ l.productionDamaged || '-' }}</td>
                    }
                    <td>{{ num(l.bundles) }}<small>{{ l.bundlesPerContainer }} / container</small></td>
                    <td>{{ num(l.packets) }}<small>{{ l.packetsPerBundle }} / bundle</small></td>
                    @if (hasMoney(o)) { <td>{{ money(lineValue(l)) }}</td> }
                  </tr>
                }
              </tbody>
              <tfoot><tr><td>Total</td><td>{{ num(sumOf(d, 'containers')) }}</td>@if (dispatched(d)) { <td>{{ num(readySum(d)) }}</td><td>{{ num(damagedSum(d)) || '-' }}</td> }<td>{{ num(sumOf(d, 'bundles')) }}</td><td>{{ num(sumOf(d, 'packets')) }}</td>@if (hasMoney(o)) { <td>{{ money(sumOf(d, 'value')) }}</td> }</tr></tfoot>
            </table>
          </div>
        </section>
      }
      <section>
        <h4>Order</h4>
        <dl class="facts">
          @if (!multi(d)) {
          <div><dt>Product</dt><dd>{{ o.product.name }}<small>{{ o.product.sku }}</small></dd></div>
          <div>
            <dt>Quantity</dt>
            <dd>{{ unitLabel(o.containers, o.containerUnit ?? o.product.containerUnit) }}
              <small>{{ num(o.bundles) }} bundles · {{ num(o.packets) }} packets</small></dd>
          </div>
          <div>
            <dt>Packaging
              <app-help title="Packaging" text="How the order is packed: packets in one bundle, bundles in one container. A container is the unit Zen Foods hands to a distributor." />
            </dt>
            <dd>{{ o.packaging || 'Default' }}<small>{{ o.packetsPerBundle }} packets / bundle · {{ o.bundlesPerContainer }} bundles / container</small></dd>
          </div>
          @if (o.readyContainers != null) {
            <div>
              <dt>Ready and loaded
                <app-help title="Ready and loaded" text="What the factory made ready and loaded at dispatch: it may be more or less than ordered, and it is what is paid for. Damaged in production stayed at the factory." />
              </dt>
              <dd>{{ unitLabel(o.readyContainers, o.containerUnit ?? o.product.containerUnit) }}
                <small>{{ o.readyContainers - o.containers > 0 ? '+' : '' }}{{ o.readyContainers - o.containers }} vs ordered{{ o.productionDamaged ? ' · ' + o.productionDamaged + ' damaged in production' : '' }}</small></dd>
            </div>
          }
          }
          @if (role() !== 'Distributor') { <div><dt>Manufacturer</dt><dd>{{ o.manufacturer.name }}</dd></div> }
          <div><dt>Deliver to</dt><dd>{{ o.destination === 'Warehouse' ? 'Zen Foods warehouse' : (o.distributor?.name ?? '-') }}</dd></div>
          @if (o.groupRef) {
            <div>
              <dt>Distributor order
                <app-help title="Distributor order" text="The distributor ordered several products together under this number. Each product is its own production order with the factory that makes it." />
              </dt>
              <dd>{{ o.groupRef }}</dd>
            </div>
          }
        </dl>
      </section>

      @if (o.transport; as t) {
        <section>
          <h4>Planned transport
            <app-help title="Planned transport" text="Given by the distributor when ordering: who will carry the goods and the driver. The actual vehicle of each load is under Loads." />
          </h4>
          <dl class="facts">
            @if (t.transporter) { <div><dt>Transporter</dt><dd>{{ t.transporter }}</dd></div> }
            @if (t.vehicleNo) { <div><dt>Vehicle no.</dt><dd>{{ t.vehicleNo }}</dd></div> }
            @if (t.driverName) { <div><dt>Driver</dt><dd>{{ t.driverName }}</dd></div> }
            @if (t.driverPhone) { <div><dt>Driver phone</dt><dd>{{ t.driverPhone }}</dd></div> }
            @if (t.driverCnic) { <div><dt>Driver CNIC</dt><dd>{{ t.driverCnic }}</dd></div> }
          </dl>
        </section>
      }

      <section>
        <h4>Dates</h4>
        <dl class="facts">
          <div><dt>Ordered</dt><dd>{{ date(o.date) }}</dd></div>
          <div><dt>Wanted by</dt><dd>{{ o.dueDate ? date(o.dueDate) : '-' }}@if (o.overdue) { <small class="tentative">late</small> }</dd></div>
          <div>
            <dt>Ready by
              <app-help title="Ready by" text="The manufacturer's estimate of when the goods will be ready. It stays tentative until the last production step is reported." />
            </dt>
            <dd>{{ o.readyDate ? date(o.readyDate) : '-' }}
              @if (o.readyDate && !d.ready) { <small class="tentative">(tentative)</small> }
              @if (d.ready) { <small>Ready now</small> }
            </dd>
          </div>
          @if (d.expectedDate && o.status === 'Accepted' && o.receivedContainers < o.containers) {
            <div>
              <dt>Expected
                <app-help title="Expected" text="When the goods should reach the distributor: the ready date plus the transit days set on Settings & Data." />
              </dt>
              <dd>{{ date(d.expectedDate) }}<small>ready by + {{ d.transitDays }} day{{ d.transitDays === 1 ? '' : 's' }} on the road</small></dd>
            </div>
          }
        </dl>
      </section>

      @if (hasMoney(o)) {
        <section>
          <h4>Money
            <app-help title="Money" text="The manufacturer's price per packet is its rate plus the packaging and printing it charges. The advance is the share of the order value paid before production; the rest follows its payment terms." />
          </h4>
          @for (l of d.lines?.length ? d.lines : [o]; track l.id) {
            <div class="formula">
              @if (multi(d)) { <span class="formula__sku">{{ l.product.sku }}</span> }
              <span>Rate <strong>{{ amount(l.baseRate ?? l.rate) }}</strong></span>
              <span>+ Packaging <strong>{{ amount(l.packagingFee ?? 0) }}</strong></span>
              <span>+ Printing <strong>{{ amount(l.printingFee ?? 0) }}</strong></span>
              <span>= <strong>{{ amount(l.rate) }}</strong> / packet × {{ num(l.packets) }}</span>
              <span class="formula__total">= <strong>{{ money(l.value) }}</strong></span>
            </div>
          }
          <dl class="facts">
            <div><dt>Order value</dt><dd>{{ money(sumOf(d, 'value')) }}@if (dispatched(d)) { <small>{{ money(payableValue(d)) }} on the ready containers</small> }</dd></div>
            <div><dt>Advance {{ o.advancePct }}%</dt><dd>{{ money(sumOf(d, 'advanceAmount')) }}</dd></div>
          </dl>
        </section>
      }

      @if (d.distAdvance; as a) {
        <section>
          <h4>Advance paid by the distributor
            <app-help title="Advance paid by the distributor" text="What the distributor says it paid with the order, with its proof. Finance checks it against the bank." />
          </h4>
          <dl class="facts">
            <div><dt>Amount</dt><dd><strong class="info-figure">{{ money(a.amount) }}</strong></dd></div>
            <div><dt>Method</dt><dd>{{ a.method }}</dd></div>
            <div><dt>Paid on</dt><dd>{{ date(a.date) }}</dd></div>
            @if (a.reference) { <div><dt>Reference</dt><dd>{{ a.reference }}</dd></div> }
            <div><dt>Proof</dt><dd>
              @if (isStaff()) {
                <button appBtn type="button" size="sm" variant="ghost" icon="download" (click)="downloadProof(a)">{{ a.proofName }}</button>
              } @else { {{ a.proofName }} }
            </dd></div>
          </dl>
        </section>
      }

      @if (o.status === 'Accepted' || d.shipments.length) {
        <section>
          <h4>Loads
            <app-help title="Loads" text="Every load that left the factory on this order: sent by the manufacturer (Delivery) or collected by the distributor (Pickup), with the vehicle and what arrived." />
          </h4>
          <div class="movement">
            <div><strong>{{ num(o.shippedContainers) }}</strong><span>left the factory</span></div>
            <div><strong>{{ num(o.receivedContainers) }}</strong><span>arrived</span></div>
            <div><strong>{{ num(o.containers - o.shippedContainers) }}</strong><span>still at the factory</span></div>
          </div>
          @if (d.shipments.length) {
            <ul class="cards">
              @for (s of d.shipments; track s.id) {
                <li>
                  <div class="row"><strong>{{ s.refNo }} · {{ s.method === 'Pickup' ? 'Collected' : 'Delivered' }}</strong>
                    <span class="row__end">
                      <button appBtn type="button" size="sm" variant="ghost" icon="download" (click)="printChallan(o, s)" title="Dispatch voucher for this load">Voucher</button>
                      <app-tag [tone]="loadTone(s)">{{ s.status }}</app-tag>
                    </span>
                  </div>
                  <span>{{ date(s.shipDate) }} · {{ unitLabel(s.containers, o.containerUnit ?? o.product.containerUnit) }}{{ s.vehicle ? ' · vehicle ' + s.vehicle : '' }}{{ s.waybill ? ' · ' + s.waybill : '' }}</span>
                  @if (s.note) { <small>{{ s.note | plain }}</small> }
                  @if (s.receivedDate) {
                    <small>Arrived {{ date(s.receivedDate) }}: {{ num(s.receivedContainers ?? 0) }} container{{ s.receivedContainers === 1 ? '' : 's' }}{{ s.receivedBy ? ' · ' + s.receivedBy : '' }}</small>
                  }
                </li>
              }
            </ul>
          }
        </section>
      }

      @if (o.status === 'Accepted') {
        <section>
          <h4>Dispatch documents
            <app-help title="Dispatch voucher" text="The delivery challan (gate pass) that travels with the goods: what leaves, for whom, on which vehicle, with boxes for the factory, the driver and the receiver to sign. It opens once the order is ready to ship. Upload the signed copy here so everyone has it." />
          </h4>
          <div class="docbar">
            <button appBtn type="button" size="sm" icon="download" (click)="printChallan(o, null)" [disabled]="!canChallan(d)"
              [title]="canChallan(d) ? 'Print or save as PDF' : 'Available once the order is ready to ship'">Dispatch voucher</button>
            @if (canUpload()) {
              <label class="btn upload" data-size="sm" [attr.aria-disabled]="uploading() ? 'true' : null">
                <app-icon name="upload" [size]="14" /> {{ uploading() ? 'Uploading...' : 'Upload signed copy' }}
                <input type="file" [accept]="accept" (change)="upload($event, o.id, 'CHALLAN')" [disabled]="uploading()" />
              </label>
            }
            @if (!canChallan(d)) { <small class="muted">Opens when the last production step is reported.</small> }
          </div>
          @if (docError()) { <div class="notice" data-tone="danger" role="alert">{{ docError() }}</div> }
          @if (d.documents.length) {
            <ul class="cards">
              @for (f of d.documents; track f.id) {
                <li>
                  <div class="row">
                    <strong>{{ docLabel(f.kind) }}</strong>
                    <span class="row__end">
                      <button appBtn type="button" size="sm" variant="ghost" icon="download" (click)="download(o.id, f)">{{ f.name }}</button>
                      @if (canRemove(f)) {
                        <button appBtn type="button" size="sm" variant="ghost" icon="trash" iconOnly (click)="remove(o.id, f)" [attr.aria-label]="'Remove ' + f.name"></button>
                      }
                    </span>
                  </div>
                  <small>{{ f.uploadedBy }} · {{ when(f.createdAt) }}</small>
                </li>
              }
            </ul>
          }
        </section>
      }

      @if (hasMoney(o) && (o.status === 'Accepted' || d.invoices.length)) {
        <section>
          <h4>Manufacturer invoices
            <app-help title="Manufacturer invoices" text="The manufacturer's invoices to Zen Foods on this order: the advance, and the balance once the goods are ready. Each has a due date; Finance signs and pays it into the accounts printed on it." />
          </h4>
          @if (d.ready && !hasBalance(d) && canInvoice()) {
            <div class="notice" data-tone="info" role="status">
              <span>Ready to ship. Raise the balance invoice so Zen Foods can schedule the payment.</span>
            </div>
          }
          @if (d.invoices.length) {
            <ul class="cards">
              @for (i of d.invoices; track i.id) {
                <li>
                  <div class="row">
                    <strong>{{ i.refNo }} · {{ i.kind }} · {{ money(i.amount) }}</strong>
                    <app-tag [tone]="invoiceTone(i)">{{ invoiceState(i) }}</app-tag>
                  </div>
                  <span>{{ date(i.date) }}{{ i.invoiceNo ? ' · their no. ' + i.invoiceNo : '' }}{{ i.dueDate ? ' · due ' + date(i.dueDate) : '' }}{{ dueIn(i) }}</span>
                  <small>Paid {{ money(i.paid) }} · {{ i.banks.length }} account{{ i.banks.length === 1 ? '' : 's' }}: {{ i.banks[0]?.bank }} {{ i.banks[0]?.account }}{{ i.banks.length > 1 ? ' +' + (i.banks.length - 1) : '' }}</small>
                  @if (i.invoiceFileId) {
                    <div><button appBtn type="button" size="sm" variant="ghost" icon="download" (click)="download(o.id, { id: i.invoiceFileId, name: 'Invoice ' + (i.invoiceNo || i.refNo) })">Their invoice copy</button></div>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="muted">No invoice yet.</p>
          }
          @if (canInvoice() && o.status === 'Accepted') {
            <div><button appBtn type="button" size="sm" icon="plus" (click)="invoiceOpen.set(true)">Raise invoice</button></div>
          }
        </section>
      }

      @if (d.claims.length) {
        @let dm = damage(d);
        <section>
          <h4>Before and after damage
            <app-help title="Before and after damage" text="Claims still open (waiting or on hold) are held out of what is due until the manufacturer decides. An accepted credit lowers the order for good; a replacement is sent again; a rejected claim goes back into what is due." />
          </h4>
          <dl class="facts">
            <div><dt>Bundles ordered</dt><dd>{{ num(dm.bundles) }}</dd></div>
            <div><dt>Under review</dt><dd>{{ num(dm.openBundles) }}<small>waiting or on hold</small></dd></div>
            <div><dt>Accepted damage</dt><dd>{{ num(dm.acceptedBundles) }}<small>credit or replacement</small></dd></div>
            <div><dt>Good bundles</dt><dd>{{ num(dm.bundles - dm.openBundles - dm.creditBundles) }}<small>after damage</small></dd></div>
            @if (hasMoney(o)) {
              <div><dt>Order value</dt><dd>{{ money(payableValue(d)) }}<small>{{ dispatched(d) ? 'ready containers, before damage' : 'before damage' }}</small></dd></div>
              <div><dt>Credit accepted</dt><dd>{{ money(dm.credit) }}</dd></div>
              <div><dt>Held by open claims</dt><dd>{{ money(dm.held) }}</dd></div>
              <div><dt>Payable after damage</dt><dd><strong>{{ money(payableValue(d) - dm.credit - dm.held) }}</strong></dd></div>
              <div><dt>Paid to the manufacturer</dt><dd>{{ money(dm.paid) }}</dd></div>
              <div><dt>Balance</dt><dd><strong>{{ money(payableValue(d) - dm.credit - dm.held - dm.paid) }}</strong></dd></div>
            }
          </dl>
        </section>
        <section>
          <h4>Claims
            <app-help title="Claims" text="Damaged, missing or poor quality bundles reported on a load. The manufacturer accepts (credit or replacement) or rejects each one." />
          </h4>
          <ul class="cards">
            @for (c of d.claims; track c.id) {
              <li>
                <div class="row"><strong>{{ c.refNo }} · {{ c.kind }} · {{ num(c.bundles) }} bundle{{ c.bundles === 1 ? '' : 's' }}</strong><app-tag [tone]="claimTone(c)">{{ c.status === 'Hold' ? 'On hold' : c.status }}{{ c.resolution ? ' · ' + c.resolution : '' }}</app-tag></div>
                <span>{{ date(c.date) }} · {{ c.raisedBy }}{{ c.value !== undefined ? ' · ' + money(c.value) : '' }}{{ c.hasEvidence ? ' · proof attached' : '' }}</span>
                <small>{{ c.note | plain }}</small>
                @if (c.decisionNote) { <small>Answer: {{ c.decisionNote | plain }}</small> }
              </li>
            }
          </ul>
        </section>
      }

      @if (o.notes || o.reason) {
        <section>
          <h4>Notes</h4>
          @if (o.notes) { <div class="rich" [innerHTML]="o.notes | rich"></div> }
          @if (o.reason) { <p class="rich">Reason: {{ o.reason | plain }}</p> }
        </section>
      }

      <app-order-invoice-form [(open)]="invoiceOpen" [detail]="d" (saved)="onInvoiced()" />

      <section>
        <h4>Timeline</h4>
        <ol class="events">
          @for (e of o.events; track e.id) {
            <li>
              <span class="dot" aria-hidden="true"></span>
              <div>
                <strong>{{ e.event }}</strong>
                <small>{{ when(e.createdAt) }} · {{ e.by }} ({{ e.side.toLowerCase() }})</small>
                @if (e.note) { <p>{{ e.note | plain }}</p> }
              </div>
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class OrderDetail {
  private factory = inject(FactoryApi);
  readonly orderId = input<string | null | undefined>(null);
  /** bump to load the order again (after an action changed it) */
  readonly reload = input(0);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  /** reloads after a file or an invoice was added here */
  private tick = signal(0);
  protected invoiceOpen = signal(false);
  protected uploading = signal(false);
  protected docError = signal('');
  protected accept = ATTACHMENT_ACCEPT;

  protected role = computed(() => this.auth.user()?.role ?? '');
  /** both partners and the staff who run orders may attach the signed voucher */
  protected canUpload = computed(() => ['Admin', 'Manufacturing', 'Distribution', 'Manufacturer', 'Distributor'].includes(this.role()));
  /** the manufacturer (or staff for it) raises its invoices */
  protected canInvoice = computed(() => ['Admin', 'Manufacturing', 'Manufacturer'].includes(this.role()));

  protected detail = rxResource({
    params: () => ({ id: this.orderId(), n: this.reload() + this.tick() }),
    stream: ({ params }) => (params.id ? this.factory.detail(params.id) : of(undefined)),
  });

  protected errorMsg = computed(() => errorText(this.detail.error()));

  /** Sent, Accepted, each production step; ticked up to where the order is */
  protected steps = computed<{ label: string; state: StepState }[]>(() => {
    const d = this.detail.value();
    if (!d) return [];
    const o = d.order;
    if (o.status === 'Rejected' || o.status === 'Cancelled' || o.status === 'Draft') return [{ label: o.status, state: 'now' }];
    const at = o.stage ? d.stages.indexOf(o.stage) : -1;
    const accepted = o.status === 'Accepted';
    const done = accepted && o.containers > 0 && o.receivedContainers >= o.containers;
    const list: { label: string; state: StepState }[] = [
      { label: 'Sent', state: accepted ? 'done' : 'now' },
      { label: 'Accepted', state: accepted ? (at < 0 && !o.shippedContainers ? 'now' : 'done') : 'next' },
      ...d.stages.map((label, i): { label: string; state: StepState } => ({
        label, state: !accepted ? 'next' : i < at || (i === at && (o.shippedContainers > 0 || done)) ? 'done' : i === at ? 'now' : 'next',
      })),
      { label: 'Left the factory', state: done ? 'done' : o.shippedContainers > 0 ? 'now' : 'next' },
      { label: 'Arrived', state: done ? 'now' : 'next' },
    ];
    return list;
  });

  protected tone = (o: ProductionOrder) => ORDER_TONE[o.status];
  protected state = orderState;
  protected hasMoney = (o: ProductionOrder) => typeof o.value === 'number';
  private linesOf = (d: OrderDetailData) => (d.lines?.length ? d.lines : [d.order]);
  /** the factory recorded the ready quantities (Ready to Dispatch) */
  protected dispatched = (d: OrderDetailData) => this.linesOf(d).some((l) => l.readyContainers != null);
  protected readySum = (d: OrderDetailData) => this.linesOf(d).reduce((n, l) => n + (l.readyContainers ?? 0), 0);
  protected damagedSum = (d: OrderDetailData) => this.linesOf(d).reduce((n, l) => n + (l.productionDamaged ?? 0), 0);
  /** a line's value on what is paid for: the ready containers once dispatched, else the ordered ones */
  protected lineValue = (l: ProductionOrder) =>
    l.readyContainers != null && l.containers ? (l.value * l.readyContainers) / l.containers : l.value;
  protected payableValue = (d: OrderDetailData) => this.linesOf(d).reduce((n, l) => n + (this.lineValue(l) || 0), 0);
  /** the order holds several products (one combined order) */
  protected multi = (d: OrderDetailData) => (d.lines?.length ?? 1) > 1;
  /** a total over every product of the order */
  protected sumOf = (d: OrderDetailData, k: 'containers' | 'bundles' | 'packets' | 'value' | 'advanceAmount') =>
    (d.lines?.length ? d.lines : [d.order]).reduce((n, l) => n + (Number(l[k]) || 0), 0);
  protected loadTone = (s: OrderLoad): Tone => (s.receivedDate ? 'success' : 'info');
  protected claimTone = (c: OrderClaim): Tone => (c.status === 'Accepted' ? 'success' : c.status === 'Rejected' ? 'danger' : c.status === 'Hold' ? 'info' : 'warning');

  /** the order before and after its claims: bundles, credit, value held by open claims, and what was paid */
  protected damage(d: OrderDetailData) {
    const open = d.claims.filter((c) => c.status === 'Pending' || c.status === 'Hold');
    const accepted = d.claims.filter((c) => c.status === 'Accepted');
    const credits = accepted.filter((c) => c.resolution === 'Credit');
    const sum = (l: OrderClaim[], f: (c: OrderClaim) => number) => l.reduce((n, c) => n + f(c), 0);
    return {
      bundles: this.sumOf(d, 'bundles'),
      openBundles: sum(open, (c) => c.bundles),
      acceptedBundles: sum(accepted, (c) => c.bundles),
      creditBundles: sum(credits, (c) => c.bundles),
      credit: sum(credits, (c) => c.value ?? 0),
      held: sum(open, (c) => c.value ?? 0),
      paid: d.invoices.filter((i) => i.status === 'Submitted').reduce((n, i) => n + i.paid, 0),
    };
  }
  protected num = fmtNumber;
  protected unitLabel = containersLabel;
  protected money = fmtMoney;
  protected amount = fmtAmount2;
  protected date = fmtDate;
  protected when = fmtDateTime;

  protected print(o: ProductionOrder) {
    printVoucher(orderVoucher(o));
  }

  /** the dispatch voucher opens once the goods are ready (or something has already left) */
  protected canChallan = (d: OrderDetailData) => d.ready || d.shipments.length > 0;

  protected printChallan(o: ProductionOrder, load: OrderLoad | null) {
    printVoucher(dispatchVoucher(o, load));
  }

  protected docLabel = (k: OrderDoc['kind']) => (k === 'CHALLAN' ? 'Signed dispatch voucher' : k === 'INVOICE' ? 'Manufacturer invoice copy' : 'Document');
  protected canRemove = (f: OrderDoc) => f.uploadedBy === this.auth.user()?.name || ['Admin', 'Manufacturing'].includes(this.role());

  protected upload(e: Event, orderId: string, kind: OrderDoc['kind']) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      this.docError.set('The file is larger than 5 MB.');
      return;
    }
    this.docError.set('');
    this.uploading.set(true);
    this.factory.addOrderDoc(orderId, file, kind).subscribe({
      next: () => {
        this.uploading.set(false);
        this.toast.success('Signed copy attached. Zen Foods and the other side are told.');
        this.tick.update((n) => n + 1);
      },
      error: (err) => {
        this.uploading.set(false);
        this.docError.set(errorText(err));
      },
    });
  }

  /** staff can open any uploaded file; a partner login cannot */
  protected isStaff = computed(() => !['Distributor', 'Manufacturer'].includes(this.role()));
  private attachments = inject(AttachmentsApi);
  protected downloadProof(a: { proofId: string; proofName: string }) {
    this.attachments.download({ id: a.proofId, name: a.proofName }).subscribe({ error: (err) => this.docError.set(errorText(err)) });
  }

  protected download(orderId: string, f: Pick<OrderDoc, 'id' | 'name'>) {
    this.factory.downloadOrderDoc(orderId, f).subscribe({ error: (err) => this.docError.set(errorText(err)) });
  }

  protected async remove(orderId: string, f: OrderDoc) {
    if (!(await this.confirm.ask({ title: 'Remove this file?', message: `${f.name} is removed from the order.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    this.factory.removeOrderDoc(orderId, f.id).subscribe({
      next: () => this.tick.update((n) => n + 1),
      error: (err) => this.docError.set(errorText(err)),
    });
  }

  protected onInvoiced() {
    this.tick.update((n) => n + 1);
  }

  protected hasBalance = (d: OrderDetailData) => d.invoices.some((i) => i.kind === 'Balance' && i.status === 'Submitted');
  protected invoiceState = (i: OrderInvoice) =>
    i.status !== 'Submitted' ? i.status : i.paid >= i.amount - 0.01 ? 'Paid' : i.paid > 0 ? 'Part paid' : 'Waiting for Zen Foods';
  protected invoiceTone = (i: OrderInvoice): Tone =>
    i.status === 'Rejected' ? 'danger' : i.status === 'Withdrawn' ? 'neutral' : i.paid >= i.amount - 0.01 ? 'success' : i.dueDate && i.dueDate.slice(0, 10) < today() ? 'danger' : 'warning';
  /** " · 5 days left", " · 3 days late" while not fully paid */
  protected dueIn(i: OrderInvoice) {
    if (!i.dueDate || i.status !== 'Submitted' || i.paid >= i.amount - 0.01) return '';
    return ` · ${dueCountdown(i.date, i.dueDate)}`;
  }
}
