import { ChangeDetectionStrategy, Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Select, SelectOption } from './select';

/**
 * Pick several values from a searchable list. The chosen ones show as chips (click one to remove it); the picker
 * below offers only what is not chosen yet. Works as a form control (formControlName / ngModel) whose value is
 * an array of option values.
 *
 *   <app-field label="Provinces">
 *     <app-multi-select formControlName="provinces" [options]="provinces" placeholder="Add a province" />
 *   </app-field>
 *
 * A chosen value that is no longer among the options still shows (and can be removed), so nothing disappears
 * silently when a parent filter narrows the list.
 */
@Component({
  selector: 'app-multi-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Select],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MultiSelect), multi: true }],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: var(--surface-sunken);
      color: var(--text);
      font-size: var(--text-sm);
      cursor: pointer;

      &:hover,
      &:focus-visible {
        border-color: var(--danger, currentColor);
      }

      &:disabled {
        cursor: default;
      }

      & small {
        color: var(--text-3);
      }
    }
  `,
  template: `
    @if (!disabled()) {
      <app-select [options]="remaining()" [ngModel]="null" (ngModelChange)="add($event)" [placeholder]="placeholder()"
        [ariaLabel]="ariaLabel()" [clearable]="false" />
    }
    @if (value().length) {
      <div class="chips">
        @for (v of value(); track v) {
          <button type="button" class="chip" (click)="remove(v)" [disabled]="disabled()" [attr.aria-label]="'Remove ' + labelOf(v)">
            {{ labelOf(v) }} @if (!disabled()) { <span aria-hidden="true">×</span> }
          </button>
        }
      </div>
    }
  `,
})
export class MultiSelect implements ControlValueAccessor {
  readonly options = input.required<SelectOption<string>[]>();
  readonly placeholder = input('Add...');
  readonly ariaLabel = input<string>();

  protected value = signal<string[]>([]);
  protected disabled = signal(false);
  private onChange: (v: string[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  /** the options not chosen yet */
  protected remaining = computed(() => {
    const chosen = new Set(this.value());
    return this.options().filter((o) => !chosen.has(o.value));
  });

  protected labelOf(v: string) {
    return this.options().find((o) => o.value === v)?.label ?? v;
  }

  protected add(v: string | null) {
    if (!v || this.value().includes(v)) return;
    this.set([...this.value(), v]);
  }

  protected remove(v: string) {
    this.set(this.value().filter((x) => x !== v));
  }

  private set(next: string[]) {
    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }

  writeValue(v: unknown) {
    this.value.set(Array.isArray(v) ? v.map(String) : []);
  }

  registerOnChange(fn: (v: string[]) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(d: boolean) {
    this.disabled.set(d);
  }
}
