import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, inject, input, signal, viewChild,
} from '@angular/core';
import { IconComponent } from './icon';

let nextHelpId = 0;

/**
 * A small "?" next to a label or a heading. Hover, focus or tap it to read a short explanation.
 *
 *   <app-help text="Packets in one bundle. A bundle is the pack the shop buys." />
 *   <app-help title="Advance" text="Part of the order value paid before production starts." />
 *
 * Use it only where a word is a trade term or a rule is not obvious (rates, terms, claims, packaging, credit),
 * never on every field. `<app-field help="...">` and `<app-offcanvas help="...">` place one for you.
 *
 * The bubble is a popover in the top layer, so it shows above dialogs and off-canvas panels and is never clipped.
 * It opens above the icon when there is room, otherwise below, and stays inside the screen.
 */
@Component({
  selector: 'app-help',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'help' },
  template: `
    <button #btn type="button" class="help__btn" [attr.aria-label]="'Help: ' + (title() || 'more information')"
            [attr.aria-describedby]="tipId" [attr.aria-expanded]="open()"
            (mouseenter)="show()" (mouseleave)="hideSoon()" (focus)="show()" (blur)="hide()"
            (click)="toggle($event)" (keydown.escape)="onEscape($event)">
      <app-icon name="help" [size]="size()" />
    </button>
    <div #tip class="help__tip" popover="manual" role="tooltip" aria-hidden="true" [id]="tipId"
         (mouseenter)="keep()" (mouseleave)="hideSoon()">
      @if (title()) {
        <strong class="help__title">{{ title() }}</strong>
      }
      <span class="help__text">{{ text() }}</span>
    </div>
  `,
})
export class Help {
  /** the explanation, one or two short sentences */
  readonly text = input.required<string>();
  /** optional bold first line (the term being explained) */
  readonly title = input<string>();
  readonly size = input(14);

  protected readonly tipId = `help-${nextHelpId++}`;
  protected readonly open = signal(false);
  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  private readonly tip = viewChild.required<ElementRef<HTMLElement>>('tip');
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      document.removeEventListener('scroll', this.onScroll, true);
    });
  }

  protected show() {
    this.keep();
    const tip = this.tip().nativeElement;
    if (typeof tip.showPopover !== 'function') return;
    if (!tip.matches(':popover-open')) tip.showPopover();
    this.place(tip);
    if (!this.open()) document.addEventListener('scroll', this.onScroll, true);
    this.open.set(true);
  }

  /**
   * The bubble is fixed to the screen: when anything under it scrolls (focus scrolling the icon into view, the user
   * scrolling a panel) it follows the icon, and closes once the icon has left the screen.
   */
  private readonly onScroll = () => {
    const r = this.btn().nativeElement.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) this.hide();
    else this.place(this.tip().nativeElement);
  };

  protected hide() {
    this.keep();
    const tip = this.tip().nativeElement;
    if (typeof tip.hidePopover === 'function' && tip.matches(':popover-open')) tip.hidePopover();
    document.removeEventListener('scroll', this.onScroll, true);
    this.open.set(false);
  }

  /** a short delay lets the pointer travel from the icon onto the bubble (to select or read long text) */
  protected hideSoon() {
    this.keep();
    this.timer = setTimeout(() => this.hide(), 120);
  }

  protected keep() {
    clearTimeout(this.timer);
  }

  /** Esc closes the bubble first; the panel or dialog behind it closes on the next Esc */
  protected onEscape(event: Event) {
    if (!this.open()) return;
    event.preventDefault();
    event.stopPropagation();
    this.hide();
  }

  /** tap on touch screens; a click must never submit or toggle the label's control */
  protected toggle(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.open()) this.hide();
    else this.show();
  }

  private place(tip: HTMLElement) {
    const r = this.btn().nativeElement.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), window.innerWidth - w - edge);
    const above = r.top - h - gap >= edge;
    const top = above ? r.top - h - gap : Math.min(r.bottom + gap, window.innerHeight - h - edge);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.toggleAttribute('data-below', !above);
  }
}
