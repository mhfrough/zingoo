/**
 * select.ts - the searchable dropdown (app-select). Owned by the design-system session.
 * A form control (formControlName, formControl, ngModel) built on the combobox + listbox pattern.
 */
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, ViewEncapsulation, booleanAttribute,
  computed, inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { IconComponent } from './icon';
import { tokenMs } from './motion';

/** One choice in an app-select. `sub` is a small second line (a province under a city). */
export interface SelectOption<T = unknown> {
  value: T;
  label: string;
  /** small second line; searched too */
  sub?: string;
  /** older name of `sub`, still accepted */
  hint?: string;
  disabled?: boolean;
  /** options with the same group value sit under one heading (keep them next to each other) */
  group?: string;
}

let nextSelectId = 0;
/** options rendered at first; more are added while the list is scrolled (keeps 500+ options fast) */
const PAGE = 60;

/** lower-case without accents or extra spaces, so "Karāchi" and "karachi" match */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Accessible searchable dropdown. Works with formControlName, formControl and ngModel.
 *
 *   <app-field label="City">
 *     <app-select formControlName="city" [options]="cities" placeholder="Choose a city" />
 *   </app-field>
 *
 * - Search box inside the list (on by default, `[searchable]="false"` for short lists); it matches label and `sub`,
 *   accents ignored, best matches first. "No match" when nothing fits.
 * - Keyboard: Arrow keys move, Enter picks, Esc closes (a dialog around it stays open), Tab leaves. On the closed
 *   control, arrows / Enter / Space open it and typing a letter opens it with that letter searched.
 * - Clear (x) button resets the value to null (`[clearable]="false"` for required fields).
 * - The list is a popover: it floats above dialogs and the off-canvas panel (never clipped), flips upward when there
 *   is no room below and stays inside the viewport. Long lists render 60 rows at a time and add more while scrolling.
 */
@Component({
  selector: 'app-select',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'select',
    '(document:pointerdown)': 'onOutside($event)',
    '(window:resize)': 'onResize()',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      class="select__trigger"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="open() && !searchable() && active() >= 0 ? optId(active()) : null"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [attr.data-clearable]="showClear() ? '' : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      <span class="select__value" [class.is-placeholder]="!selected()">{{ selected()?.label ?? placeholder() }}</span>
      @if (selected()?.sub || selected()?.hint) {
        <span class="select__value-sub">{{ selected()!.sub ?? selected()!.hint }}</span>
      }
      <app-icon class="select__chev" name="chevron-down" [size]="16" />
    </button>

    @if (showClear()) {
      <button type="button" class="select__clear" aria-label="Clear selection" tabindex="-1" (click)="clear()">
        <app-icon name="x" [size]="14" />
      </button>
    }

    <div #list class="select__list" popover="manual" [attr.data-searchable]="searchable() ? '' : null"
         (mousedown)="onListMouseDown($event)">
      @if (searchable()) {
        <div class="select__search">
          <app-icon name="search" [size]="16" />
          <input
            #search
            type="search"
            class="select__search-input"
            data-field-skip
            autocomplete="off"
            spellcheck="false"
            placeholder="Search..."
            aria-label="Search options"
            [attr.aria-controls]="listId"
            [attr.aria-activedescendant]="open() && active() >= 0 ? optId(active()) : null"
            [value]="query()"
            (input)="onQuery($event)"
            (keydown)="onKey($event)"
          />
        </div>
      }
      <div #opts class="select__opts" role="listbox" tabindex="-1" [id]="listId" [attr.aria-label]="ariaLabel() || null"
           (scroll)="onScroll()">
        @for (item of visible(); track $index; let i = $index) {
          @if (item.group && !query() && item.group !== visible()[i - 1]?.group) {
            <div class="select__group" role="presentation">{{ item.group }}</div>
          }
          <div
            role="option"
            class="select__opt"
            [id]="optId(i)"
            [class.is-active]="i === active()"
            [attr.aria-selected]="isSelected(item)"
            [attr.aria-disabled]="item.disabled ? 'true' : null"
            (click)="choose(item)"
            (mousemove)="item.disabled ? null : active.set(i)"
          >
            <span class="select__opt-text">
              <span>{{ item.label }}</span>
              @if (item.sub || item.hint) {
                <span class="select__opt-hint">{{ item.sub ?? item.hint }}</span>
              }
            </span>
            @if (isSelected(item)) {
              <app-icon name="check" [size]="16" />
            }
          </div>
        } @empty {
          <div class="select__empty">{{ options().length ? 'No match' : 'No options' }}</div>
        }
      </div>
    </div>
  `,
})
export class Select implements ControlValueAccessor {
  /** the choices: { value, label, sub?, disabled?, group? } */
  readonly options = input.required<SelectOption[]>();
  /** text shown while nothing is selected */
  readonly placeholder = input('Select...');
  /** use when the select is not inside an <app-field> that labels it */
  readonly ariaLabel = input<string>();
  /** show the invalid look regardless of the form control state */
  readonly forceInvalid = input(false, { transform: booleanAttribute });
  /** search box inside the list (on by default) */
  readonly searchable = input(true, { transform: booleanAttribute });
  /** show the clear (x) button while a value is selected */
  readonly clearable = input(true, { transform: booleanAttribute });

  protected open = signal(false);
  protected active = signal(-1);
  protected query = signal('');
  protected limit = signal(PAGE);
  protected value = signal<unknown>(undefined);
  protected disabled = signal(false);
  protected selected = computed(() => this.options().find((o) => Object.is(o.value, this.value())));
  protected showClear = computed(() => this.clearable() && !this.disabled() && !!this.selected());

  /** options that match the search, best matches first (label start, then label, then the second line) */
  protected filtered = computed(() => {
    const opts = this.options();
    const q = norm(this.query());
    if (!q) return opts;
    const scored: { o: SelectOption; s: number }[] = [];
    for (const o of opts) {
      const label = norm(o.label);
      const sub = norm(o.sub ?? o.hint ?? '');
      const s = label.startsWith(q) ? 0 : label.includes(q) ? 1 : sub.includes(q) ? 2 : -1;
      if (s >= 0) scored.push({ o, s });
    }
    return scored.sort((a, b) => a.s - b.s).map((x) => x.o);
  });
  /** the slice that is actually in the DOM */
  protected visible = computed(() => this.filtered().slice(0, this.limit()));

  private uid = nextSelectId++;
  protected listId = `select-${this.uid}-list`;
  protected optId = (i: number) => `select-${this.uid}-opt-${i}`;

  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private list = viewChild.required<ElementRef<HTMLElement>>('list');
  private opts = viewChild.required<ElementRef<HTMLElement>>('opts');
  private searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
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

  /** move focus to the control */
  focus() {
    this.trigger().nativeElement.focus();
  }

  // ── open / close ──
  protected toggle() {
    if (this.open()) this.closeList();
    else this.openList();
  }

  /** open the list; `seed` pre-fills the search box (a letter typed on the closed control) */
  protected openList(seed = '') {
    if (this.disabled() || this.open()) return;
    clearTimeout(this.closeTimer);
    const list = this.list().nativeElement;
    list.removeAttribute('data-closing');
    this.query.set(seed);
    const sel = this.filtered().findIndex((o) => this.isSelected(o));
    this.limit.set(Math.max(PAGE, sel + PAGE / 2));
    this.active.set(sel >= 0 ? sel : this.step(-1, 1));
    this.open.set(true);
    if (typeof list.showPopover === 'function' && !list.matches(':popover-open')) list.showPopover();
    this.cdr.detectChanges();
    this.place();
    window.addEventListener('scroll', this.scrollListener, true);
    this.scrollToActive();
    if (this.searchable()) this.searchEl()?.nativeElement.focus();
  }

  /** close the list with its exit animation */
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

  /** put the fixed-position list under (or over, when short of room) the trigger, inside the viewport */
  private place() {
    const list = this.list().nativeElement;
    const t = this.trigger().nativeElement.getBoundingClientRect();
    const below = innerHeight - t.bottom - 12;
    const above = t.top - 12;
    const cap = this.searchable() ? 336 : 256;
    list.style.setProperty('--select-w', `${Math.max(t.width, 220)}px`);
    list.style.setProperty('--select-max-h', `${cap}px`);
    const natural = Math.min(list.scrollHeight + 2, cap);
    const flip = natural > below && above > below;
    const room = Math.max(160, Math.min(cap, flip ? above : below));
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

  /** the window changed size (a phone keyboard opening counts): keep the list attached instead of closing it */
  protected onResize() {
    if (this.open()) this.place();
  }

  protected onOutside(event: Event) {
    if (!this.open()) return;
    const target = event.target as Node;
    if (this.host.contains(target)) return;
    this.closeList();
  }

  /** leaving the control (trigger and list) for good: close and mark touched */
  protected onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.contains(next)) return;
    if (!next && this.open() && this.searchable()) return; // a click inside the list can report no target
    this.closeList();
    this.onTouched();
    this.cdr.markForCheck();
  }

  /** keep focus where it is when the list is clicked, except in the search box */
  protected onListMouseDown(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.select__search')) event.preventDefault();
  }

  // ── choosing ──
  protected choose(o: SelectOption) {
    if (o.disabled) return;
    this.value.set(o.value);
    this.onChange(o.value);
    this.closeList();
    this.focus();
  }

  /** clear the selection (the x button) */
  protected clear() {
    this.value.set(null);
    this.onChange(null);
    this.focus();
    this.cdr.markForCheck();
  }

  /** next enabled option index from `from` going `dir`; stays at `from` when there is none */
  private step(from: number, dir: 1 | -1): number {
    const opts = this.filtered();
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i;
    return from;
  }

  private scrollToActive() {
    const i = this.active();
    if (i < 0) return;
    if (i >= this.limit()) {
      this.limit.set(i + PAGE / 2);
      this.cdr.detectChanges();
    }
    this.opts().nativeElement.querySelector(`#${this.optId(i)}`)?.scrollIntoView({ block: 'nearest' });
  }

  /** add the next 60 rows while the list is scrolled near its end */
  protected onScroll() {
    const el = this.opts().nativeElement;
    if (this.limit() < this.filtered().length && el.scrollTop + el.clientHeight > el.scrollHeight - 160) {
      this.limit.update((n) => n + PAGE);
    }
  }

  protected onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.limit.set(PAGE);
    this.active.set(this.step(-1, 1));
    this.opts().nativeElement.scrollTop = 0;
  }

  protected onKey(event: KeyboardEvent) {
    const open = this.open();
    const opts = this.filtered();
    const inSearch = (event.target as HTMLElement).classList.contains('select__search-input');
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
        if (!open || inSearch) return; // in the search box these move the caret
        event.preventDefault();
        this.active.set(event.key === 'Home' ? this.step(-1, 1) : this.step(opts.length, -1));
        this.scrollToActive();
        return;
      case 'Enter':
      case ' ':
        if (inSearch && event.key === ' ') return; // a space is part of the search text
        if (!open) return; // the button's own click opens it
        event.preventDefault();
        if (opts[this.active()]) this.choose(opts[this.active()]);
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        event.stopPropagation(); // do not also close the dialog or panel this select lives in
        this.closeList();
        this.focus();
        return;
      case 'Tab':
        this.closeList();
        return;
    }
    if (inSearch || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    // a printable key on the control itself
    if (this.searchable()) {
      event.preventDefault();
      if (!open) this.openList(event.key);
      return;
    }
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
