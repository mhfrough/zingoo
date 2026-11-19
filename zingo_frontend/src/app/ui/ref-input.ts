import { ChangeDetectionStrategy, Component, DestroyRef, Injectable, booleanAttribute, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';

/** the document numbers a form can suggest and check: production order, distributor order, SKU, manufacturer invoice */
export type RefKind = 'production' | 'distOrder' | 'product' | 'mfrInvoice';

@Injectable({ providedIn: 'root' })
export class RefsApi {
  private api = inject(ApiService);
  next = (kind: RefKind) => this.api.get<{ next: string }>(`refs/next/${kind}`);
  check = (kind: RefKind, value: string, except?: string | null) =>
    this.api.get<{ taken: boolean }>(`refs/check/${kind}`, { value, except: except ?? undefined });
}

/**
 * A document number the app fills in (the next free one, e.g. MO-027) and the person may change. A changed number is
 * checked as it is typed; a number already used shows "Already used" and makes the control invalid (error `taken`).
 * Saving checks again on the server.
 *
 *   <app-field label="Order no."><app-ref-input formControlName="refNo" kind="production" [except]="order()?.id" /></app-field>
 */
@Component({
  selector: 'app-ref-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ref-input' },
  template: `
    <input type="text" [value]="value()" (input)="typed($any($event.target).value)" (blur)="touched()"
           [disabled]="disabled()" maxlength="30" autocomplete="off" spellcheck="false" [attr.aria-invalid]="taken() ? 'true' : null" />
    <span class="ref-input__note" [attr.data-tone]="taken() ? 'danger' : state() === 'free' ? 'success' : null" aria-live="polite">
      @switch (state()) {
        @case ('taken') { Already used: type another }
        @case ('free') { Free to use }
        @case ('checking') { Checking… }
        @default { @if (suggested() && value() === suggested()) { Next free number. You can change it } }
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    input {
      font-family: var(--font-mono, inherit);
      font-variant-numeric: tabular-nums;
    }

    .ref-input__note {
      min-block-size: 1em;
      font-size: var(--text-2xs);
      color: var(--text-3);

      &[data-tone='danger'] {
        color: var(--tone-danger-fg);
        font-weight: var(--weight-semibold);
      }

      &[data-tone='success'] {
        color: var(--tone-success-fg);
      }
    }
  `,
})
export class RefInput implements ControlValueAccessor {
  readonly kind = input.required<RefKind>();
  /** the record being edited: its own number does not count as used */
  readonly except = input<string | null | undefined>(null);
  /** false: do not fill in the next number when empty */
  readonly suggest = input(true, { transform: booleanAttribute });

  protected value = signal('');
  protected suggested = signal('');
  protected state = signal<'idle' | 'checking' | 'free' | 'taken'>('idle');
  protected taken = () => this.state() === 'taken';
  protected disabled = signal(false);

  private api = inject(RefsApi);
  private ngControl = inject(NgControl, { self: true, optional: true });
  private checks = new Subject<string>();
  private onChange: (v: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  /** the value the record was opened with: unchanged, it needs no check */
  private original = '';

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    const sub = this.checks.pipe(
      debounceTime(350),
      switchMap((v) => this.api.check(this.kind(), v, this.except())),
    ).subscribe({
      next: (r) => this.setState(r.taken ? 'taken' : 'free'),
      error: () => this.setState('idle'),
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  private setState(s: 'idle' | 'checking' | 'free' | 'taken') {
    this.state.set(s);
    const c = this.ngControl?.control;
    if (!c) return;
    const errors = { ...(c.errors ?? {}) };
    if (s === 'taken') errors['taken'] = true;
    else delete errors['taken'];
    c.setErrors(Object.keys(errors).length ? errors : null);
  }

  writeValue(v: string | null | undefined) {
    const text = String(v ?? '');
    this.value.set(text);
    this.original = text;
    this.setState('idle');
    // an empty number: fill in the next free one (unless the person has typed meanwhile)
    if (!text && this.suggest()) {
      this.api.next(this.kind()).subscribe({
        next: (r) => {
          if (this.value()) return;
          this.value.set(r.next);
          this.suggested.set(r.next);
          this.original = r.next;
          // the form takes the suggestion without counting it as a change (closing an untouched form asks nothing)
          const c = this.ngControl?.control;
          if (c) c.setValue(r.next, { emitModelToViewChange: false });
          else this.onChange(r.next);
        },
        error: () => undefined,
      });
    }
  }

  protected typed(v: string) {
    this.value.set(v);
    this.onChange(v);
    const t = v.trim();
    if (!t || t === this.original || t === this.suggested()) {
      this.setState('idle');
      return;
    }
    this.setState('checking');
    this.checks.next(t);
  }

  protected touched() {
    this.onTouched();
  }

  registerOnChange(fn: (v: string) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(d: boolean) {
    this.disabled.set(d);
  }
}
