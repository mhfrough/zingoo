import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Help } from './help';
import { IconComponent, IconName } from './icon';
import { Select, SelectOption } from './select';

/**
 * The staff "whose portal am I looking at" bar on the partner portals (distributor, manufacturer).
 * A clear band at the top of the page, with a large searchable picker, so staff always see whose data is shown.
 *
 *   <app-view-as kind="Distributor" icon="truck" [options]="opts()" [(value)]="selected" />
 */
@Component({
  selector: 'app-view-as',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, Select, Help],
  host: { class: 'partner-pick' },
  template: `
    <span class="partner-pick__badge" aria-hidden="true"><app-icon [name]="icon()" [size]="20" /></span>
    <div class="partner-pick__text">
      <span class="partner-pick__eyebrow">
        Staff view
        <app-help title="Staff view"
          [text]="'You are signed in as Zen Foods staff. Pick a ' + kind().toLowerCase() + ' to see and act on its portal exactly as it does. Actions you take are recorded under your own name.'" />
      </span>
      <span class="partner-pick__title">Viewing as {{ current()?.label ?? ('a ' + kind().toLowerCase()) }}</span>
      @if (current()?.sub; as sub) {
        <span class="partner-pick__sub">{{ sub }}</span>
      }
    </div>
    <div class="partner-pick__pick">
      <app-select [options]="options()" [ngModel]="value()" (ngModelChange)="value.set($event)" [clearable]="false"
        [ariaLabel]="'Switch ' + kind().toLowerCase()" [placeholder]="'Choose a ' + kind().toLowerCase()" />
      <span class="partner-pick__count">{{ options().length }} {{ kind().toLowerCase() }}{{ options().length === 1 ? '' : 's' }} · switch to see another</span>
    </div>
  `,
})
export class ViewAs {
  /** "Distributor" or "Manufacturer" */
  readonly kind = input.required<string>();
  readonly icon = input<IconName>('eye');
  readonly options = input.required<SelectOption<string>[]>();
  readonly value = model<string | null | undefined>();

  protected current = computed(() => this.options().find((o) => o.value === this.value()));
}
