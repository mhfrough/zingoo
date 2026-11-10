import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, input, model, viewChild } from '@angular/core';
import { IconComponent } from './icon';

/**
 * Search box with a leading magnifier and a clear (x) button that appears while there is text.
 * Works in every browser (the native clear glyph of type="search" is hidden).
 *
 *   <app-search [(value)]="query" placeholder="Search orders" ariaLabel="Search orders" />
 *
 * Esc clears the text first.
 */
@Component({
  selector: 'app-search',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'search', '[attr.data-has-value]': 'value() ? "" : null' },
  template: `
    <app-icon name="search" [size]="16" />
    <input
      #input
      class="control"
      type="search"
      autocomplete="off"
      [value]="value()"
      [attr.placeholder]="placeholder()"
      [attr.aria-label]="ariaLabel()"
      (input)="value.set($any($event.target).value)"
      (keydown.escape)="onEscape($event)"
    />
    <button type="button" class="search__clear" aria-label="Clear search" tabindex="-1" (click)="clear()">
      <app-icon name="x" [size]="16" />
    </button>
  `,
})
export class SearchBox {
  readonly value = model('');
  readonly placeholder = input('Search...');
  readonly ariaLabel = input('Search');

  private inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected clear() {
    this.value.set('');
    this.inputEl().nativeElement.focus();
  }

  protected onEscape(event: Event) {
    if (this.value()) {
      event.stopPropagation();
      this.clear();
    }
  }
}
