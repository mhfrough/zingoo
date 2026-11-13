import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../shared/errors';
import { Tone } from '../../shared/format';
import { Btn, Offcanvas, Tag, ToastService } from '../../ui';

/** one step of the trail */
interface RegistrationEvent {
  id: string;
  createdAt: string;
  action: string;
  step: string | null;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  by: string;
  role: string;
}

/** a registration as GET /distributors/:id/registration returns it */
interface RegistrationState {
  id: string;
  code: string | null;
  name: string;
  status: string;
  missingToSubmit: string[];
  missingToActivate: string[];
  approvals: Partial<Record<'Sales' | 'Finance' | 'Compliance', { by: string; at: string; note: string | null }>>;
  agreementStatus: string;
  events: RegistrationEvent[];
}

/** which roles may give each sign-off (mirrors the server) */
const STEPS: { step: 'Sales' | 'Finance' | 'Compliance'; roles: string[] }[] = [
  { step: 'Sales', roles: ['Admin', 'Distribution', 'Exports'] },
  { step: 'Finance', roles: ['Admin', 'Finance'] },
  { step: 'Compliance', roles: ['Admin'] },
];

const TONE: Record<string, Tone> = {
  Draft: 'neutral', 'Documents submitted': 'info', 'Under review': 'warning', Approved: 'info', Active: 'success',
  'On hold': 'warning', Suspended: 'danger', Archived: 'neutral',
};

/**
 * The registration of one international distributor: where it stands, what is still missing, the Sales / Finance /
 * Compliance sign-offs, the next step for the user's role, and the full trail (who did what, when, why).
 */
@Component({
  selector: 'app-registration-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Offcanvas, Tag, Btn],
  styles: `
    .head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
      margin-block-end: var(--space-4);
    }

    h3 {
      margin: var(--space-4) 0 var(--space-2);
      font-size: var(--text-md);
    }

    ul.missing {
      margin: 0;
      padding-inline-start: var(--space-5);
      font-size: var(--text-sm);
      color: var(--text-2);
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
      gap: var(--space-2);

      & div {
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: var(--text-sm);
      }

      & strong {
        display: block;
      }

      & small {
        color: var(--text-3);
      }
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-block-start: var(--space-3);
    }

    .reason {
      inline-size: 100%;
      margin-block-start: var(--space-2);
    }

    ol.trail {
      margin: 0;
      padding-inline-start: var(--space-4);
      border-inline-start: 2px solid var(--border);
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font-size: var(--text-sm);

      & small {
        display: block;
        color: var(--text-3);
      }
    }
  `,
  template: `
    <app-offcanvas [(open)]="open" [title]="'Registration · ' + (s()?.name ?? '')" [subtitle]="s()?.code ?? 'International distributor'" size="md">
      @if (s(); as r) {
        <div class="head">
          <app-tag [tone]="tone(r.status)">{{ r.status }}</app-tag>
          <span>Agreement: {{ r.agreementStatus }}</span>
        </div>

        @if (r.status === 'Draft' && r.missingToSubmit.length) {
          <h3>Still needed to submit</h3>
          <ul class="missing">@for (m of r.missingToSubmit; track m) { <li>{{ m }}</li> }</ul>
        }

        <h3>Sign-offs</h3>
        <div class="steps">
          @for (st of steps; track st.step) {
            <div>
              <strong>{{ st.step }}</strong>
              @if (r.approvals[st.step]; as a) {
                <small>Approved by {{ a.by }} · {{ when(a.at) }}</small>
              } @else {
                <small>Waiting</small>
                @if (r.status === 'Under review' && st.roles.includes(role())) {
                  <div class="actions"><button appBtn size="sm" variant="primary" [loading]="busy()" (click)="act('approve', { step: st.step })">Approve as {{ st.step }}</button></div>
                }
              }
            </div>
          }
        </div>

        @if (r.status === 'Approved' && r.missingToActivate.length) {
          <h3>Before activating</h3>
          <ul class="missing">@for (m of r.missingToActivate; track m) { <li>{{ m }}</li> }</ul>
        }

        <h3>Next step</h3>
        <input class="reason" type="text" [value]="reason()" (input)="reason.set($any($event.target).value)" maxlength="500"
               placeholder="Reason (needed to reject, hold, suspend or archive)" aria-label="Reason" />
        <div class="actions">
          @if (r.status === 'Draft' && can(['Admin', 'Distribution', 'Exports'])) {
            <button appBtn variant="primary" [loading]="busy()" [disabled]="r.missingToSubmit.length > 0" (click)="act('submit')">Submit documents</button>
          }
          @if (r.status === 'Documents submitted' && can(['Admin', 'Finance'])) {
            <button appBtn variant="primary" [loading]="busy()" (click)="act('review')">Start review</button>
          }
          @if (r.status === 'Approved' && can(['Admin'])) {
            <button appBtn variant="primary" [loading]="busy()" [disabled]="r.missingToActivate.length > 0" (click)="act('activate')">Activate</button>
          }
          @if (['Documents submitted', 'Under review', 'Approved'].includes(r.status) && can(['Admin', 'Finance', 'Distribution', 'Exports'])) {
            <button appBtn variant="danger" [loading]="busy()" [disabled]="!reason().trim()" (click)="act('reject', { reason: reason() })">Reject (back to draft)</button>
          }
          @if (['On hold', 'Suspended'].includes(r.status) && can(['Admin', 'Finance'])) {
            <button appBtn variant="primary" [loading]="busy()" (click)="act('state', { to: 'Active', reason: reason() || undefined })">Resume</button>
          }
          @if (['Approved', 'Active', 'Suspended'].includes(r.status) && can(['Admin', 'Finance'])) {
            <button appBtn [loading]="busy()" [disabled]="!reason().trim()" (click)="act('state', { to: 'On hold', reason: reason() })">Put on hold</button>
          }
          @if (['Approved', 'Active', 'On hold'].includes(r.status) && can(['Admin', 'Finance'])) {
            <button appBtn variant="danger" [loading]="busy()" [disabled]="!reason().trim()" (click)="act('state', { to: 'Suspended', reason: reason() })">Suspend</button>
          }
          @if (r.status !== 'Archived' && can(['Admin', 'Finance'])) {
            <button appBtn variant="ghost" [loading]="busy()" [disabled]="!reason().trim()" (click)="act('state', { to: 'Archived', reason: reason() })">Archive</button>
          }
          @if (r.status === 'Archived' && can(['Admin'])) {
            <button appBtn [loading]="busy()" (click)="act('reopen')">Reopen as draft</button>
          }
        </div>

        <h3>Trail</h3>
        @if (r.events.length) {
          <ol class="trail">
            @for (e of r.events; track e.id) {
              <li>
                <strong>{{ e.action }}{{ e.step ? ' · ' + e.step : '' }}</strong> {{ e.fromStatus !== e.toStatus ? '(' + e.fromStatus + ' → ' + e.toStatus + ')' : '' }}
                <small>{{ when(e.createdAt) }} · {{ e.by }} ({{ e.role }}){{ e.note ? ' · ' + e.note : '' }}</small>
              </li>
            }
          </ol>
        } @else {
          <p class="muted">Nothing yet.</p>
        }
      }
    </app-offcanvas>
  `,
})
export class RegistrationPanel {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  readonly open = model(false);
  readonly distributorId = input<string | null>(null);
  /** the registration changed */
  readonly changed = output<void>();

  protected s = signal<RegistrationState | null>(null);
  protected busy = signal(false);
  protected reason = signal('');
  protected steps = STEPS;
  protected role = computed(() => this.auth.user()?.role ?? '');
  protected can = (roles: string[]) => roles.includes(this.role());
  protected tone = (status: string) => TONE[status] ?? 'neutral';
  protected when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  constructor() {
    effect(() => {
      const id = this.distributorId();
      if (!this.open() || !id) return;
      untracked(() => {
        this.reason.set('');
        this.load(id).subscribe({ next: (r) => this.s.set(r), error: (err) => this.toast.error(errorText(err)) });
      });
    });
  }

  private load(id: string): Observable<RegistrationState> {
    return this.api.get<RegistrationState>(`distributors/${id}/registration`);
  }

  protected act(step: string, body: Record<string, unknown> = {}) {
    const id = this.distributorId();
    if (!id) return;
    this.busy.set(true);
    this.api.post<RegistrationState>(`distributors/${id}/registration/${step}`, body).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.s.set(r);
        this.reason.set('');
        this.toast.success(`Registration: ${r.status}.`);
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorText(err));
      },
    });
  }
}
