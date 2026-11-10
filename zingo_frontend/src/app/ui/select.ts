import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, ViewEncapsulation, computed,
  inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { IconComponent } from './icon';
import { tokenMs } from './motion';

export interface SelectOption<T = unknown> {
  value: T;
  label: string;
  /** small second line */
  hint?: string;
  disabled?: boolean;
  /** options with the same group value sit under one heading (keep them next to each other) */
  group?: string;
}

let nextSelectId = 0;

/**
 * Accessible custom dropdown (combobox + listbox pattern). Works with formControlName, formControl and ngModel.
 *
 *   <app-field label="Method">
 *     <app-select formControlName="method" [options]="methods" placeholder="Choose a method" />
 *   </app-field>
 *
 * Keyboard: Arrow keys / Home / End move, Enter or Space picks, Esc closes (the dialog around it stays open),
 * letters jump to a match. The list is a popover, so it floats above dialogs and is not clipped by scroll areas.
 */
@Component({
  selector: 'app-select',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'select', '(document:pointerdown)': 'onOutside($event)', '(window:resize)': 'closeList()' },
  template: `
    <button
      #trigger
      type="button"
      class="select__trigger"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="open() && active() >= 0 ? optId(active()) : null"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onKey($event)"
      (blur)="onBlur()"
    >
      <span class="select__value" [class.is-placeholder]="!selected()">{{ selected()?.label ?? placeholder() }}</span>
      <app-icon class="select__chev" name="chevron-down" [size]="16" />
    </button>

    <div
      #list
      class="select__list"
      popover="manual"
      role="listbox"
      tabindex="-1"
      [id]="listId"
      [attr.aria-label]="ariaLabel() || null"
      (mousedown)="$event.preventDefault()"
    >
      @for (o of options(); track $index; let i = $index) {
        @if (o.group && o.group !== options()[i - 1]?.group) {
          <div class="select__group" role="presentation">{{ o.group }}</div>
        }
        <div
          role="option"
          class="select__opt"
          [id]="optId(i)"
          [class.is-active]="i === active()"
          [attr.aria-selected]="isSelected(o)"
          [attr.aria-disabled]="o.disabled ? 'true' : null"
          (click)="choose(o)"
          (mousemove)="o.disabled ? null : active.set(i)"
        >
          <span class="select__opt-text">
            <span>{{ o.label }}</span>
            @if (o.hint) {
              <span class="select__opt-hint">{{ o.hint }}</span>
            }
          </span>
          @if (isSelected(o)) {
            <app-icon name="check" [size]="16" />
          }
        </div>
      } @empty {
        <div class="select__empty">No options</div>
      }
    </div>
  `,
})
export class Select implements ControlValueAccessor {
  readonly options = input.required<SelectOption[]>();
  readonly placeholder = input('Select...');
  /** use when the select is not inside an <app-field> that labels it */
  readonly ariaLabel = input<string>();
  readonly forceInvalid = input(false);

  protected open = signal(false);
  protected active = signal(-1);
  protected value = signal<unknown>(undefined);
  protected disabled = signal(false);
  protected selected = computed(() => this.options().find((o) => Object.is(o.value, this.value())));

  private uid = nextSelectId++;
  protected listId = `select-${this.uid}-list`;
  protected optId = (i: number) => `select-${this.uid}-opt-${i}`;

  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private list = viewChild.required<ElementRef<HTMLElement>>('list');
  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};
  private typed = '';
  private typedTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private raf = 0;
  private scrollListener = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.place());
  };

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', this.scrollListener, true);
      clearTimeout(this.typedTimer);
      clearTimeout(this.closeTimer);
    });
  }

  protected invalid() {
    const c = this.ngControl;
    return this.forceInvalid() || !!(c && c.invalid && c.touched);
  }

  protected isSelected(o: SelectOption) {
    return Object.is(o.value, this.value());
  }

  focus() {
    this.trigger().nativeElement.focus();
  }

  // ── open / close ──
  protected toggle() {
    if (this.open()) this.closeList();
    else this.openList();
  }

  protected openList() {
    if (this.disabled() || this.open()) return;
    clearTimeout(this.closeTimer);
    const list = this.list().nativeElement;
    list.removeAttribute('data-closing');
    const sel = this.options().findIndex((o) => this.isSelected(o));
    this.active.set(sel >= 0 ? sel : this.step(-1, 1));
    this.open.set(true);
    if (typeof list.showPopover === 'function' && !list.matches(':popover-open')) list.showPopover();
    this.place();
    window.addEventListener('scroll', this.scrollListener, true);
    this.cdr.detectChanges();
    this.scrollToActive();
  }

  closeList() {
    if (!this.open()) return;
    const list = this.list().nativeElement;
    this.open.set(false);
    window.removeEventListener('scroll', this.scrollListener, true);
    list.setAttribute('data-closing', '');
    this.closeTimer = setTimeout(() => {
      if (typeof list.hidePopover === 'function' && list.matches(':popover-open')) list.hidePopover();
      list.removeAttribute('data-closing');
    }, tokenMs(list, '--dur-fast'));
    this.cdr.markForCheck();
  }

  /** put the fixed-position list under (or over, when short of room) the trigger */
  private place() {
    const list = this.list().nativeElement;
    const t = this.trigger().nativeElement.getBoundingClientRect();
    const below = innerHeight - t.bottom - 12;
    const above = t.top - 12;
    list.style.setProperty('--select-w', `${t.width}px`);
    list.style.setProperty('--select-max-h', '16rem');
    const natural = Math.min(list.scrollHeight + 2, 256);
    const flip = natural > below && above > below;
    const room = Math.max(120, Math.min(256, flip ? above : below));
    list.style.setProperty('--select-max-h', `${room}px`);
    const w = list.offsetWidth;
    list.style.left = `${Math.max(8, Math.min(t.left, innerWidth - w - 8))}px`;
    if (flip) {
      list.style.top = 'auto';
      list.style.bottom = `${innerHeight - t.top + 4}px`;
      list.setAttribute('data-flip', '');
    } else {
      list.style.bottom = 'auto';
      list.style.top = `${t.bottom + 4}px`;
      list.removeAttribute('data-flip');
    }
  }

  protected onOutside(event: Event) {
    if (!this.open()) return;
    const target = event.target as Node;
    if (this.trigger().nativeElement.contains(target) || this.list().nativeElement.contains(target)) return;
    this.closeList();
  }

  protected onBlur() {
    this.closeList();
    this.onTouched();
    this.cdr.markForCheck();
  }

  // ── choosing ──
  protected choose(o: SelectOption) {
    if (o.disabled) return;
    this.value.set(o.value);
    this.onChange(o.value);
    this.closeList();
    this.focus();
  }

  /** next enabled option from `from` going `dir`; -1 when there is none */
  private step(from: number, dir: 1 | -1): number {
    const opts = this.options();
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i;
    return from;
  }

  private scrollToActive() {
    const id = this.optId(this.active());
    this.list().nativeElement.querySelector(`#${id}`)?.scrollIntoView({ block: 'nearest' });
  }

  protected onKey(event: KeyboardEvent) {
    const open = this.open();
    const opts = this.options();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) return this.openList();
        this.active.set(this.step(this.active(), event.key === 'ArrowDown' ? 1 : -1));
        this.scrollToActive();
        return;
      }
      case 'Home':
      case 'End':
        if (!open) return;
        event.preventDefault();
        this.active.set(event.key === 'Home' ? this.step(-1, 1) : this.step(opts.length, -1));
        this.scrollToActive();
        return;
      case 'Enter':
      case ' ':
        if (!open) return; // the button's own click opens it
        event.preventDefault();
        if (opts[this.active()]) this.choose(opts[this.active()]);
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        event.stopPropagation(); // do not also close the dialog this select lives in
        this.closeList();
        return;
      case 'Tab':
        this.closeList();
        return;
    }
    // type-ahead
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      clearTimeout(this.typedTimer);
      this.typed += event.key.toLowerCase();
      this.typedTimer = setTimeout(() => (this.typed = ''), 600);
      const hit = opts.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(this.typed));
      if (hit >= 0) {
        if (!open) this.openList();
        this.active.set(hit);
        this.scrollToActive();
      }
    }
  }

  // ── ControlValueAccessor ──
  writeValue(v: unknown) {
    this.value.set(v);
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: unknown) => void) {
    this.onChange = (v) => {
      fn(v);
      this.cdr.markForCheck();
    };
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.disabled.set(disabled);
    this.cdr.markForCheck();
  }
}
