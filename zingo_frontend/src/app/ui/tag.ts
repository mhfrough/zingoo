import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { Tone } from '../shared/format';

/** <app-tag tone="success">Released</app-tag> */
@Component({
  selector: 'app-tag',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tag', '[attr.data-tone]': 'tone()' },
  template: '<ng-content />',
})
export class Tag {
  readonly tone = input<Tone>('neutral');
}
