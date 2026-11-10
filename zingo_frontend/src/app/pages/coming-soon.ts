import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EmptyState, PageHeader } from '../ui';

/** Placeholder for pages that are built in a later phase. Route data fills the inputs. */
@Component({
  selector: 'app-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, EmptyState],
  template: `
    <app-page-header [title]="label()" [description]="description()" eyebrow="Planned" />

    <div class="card">
      <app-empty-state icon="clock" [title]="'Built in phase ' + phase()"
        text="The layout, forms and tables for this page come with that phase. This is what it will contain." />
      <div class="card__body">
        <div class="grid-auto" style="--grid-min: 18rem">
          <section>
            <h3>Forms</h3>
            <ul class="stack" style="--stack-gap: var(--space-2); margin-block-start: var(--space-3)">
              @for (f of forms(); track f) {
                <li>{{ f }}</li>
              }
            </ul>
          </section>
          <section>
            <h3>Tables</h3>
            <ul class="stack" style="--stack-gap: var(--space-2); margin-block-start: var(--space-3)">
              @for (t of tables(); track t) {
                <li>{{ t }}</li>
              }
            </ul>
          </section>
        </div>
      </div>
    </div>
  `,
})
export class ComingSoon {
  readonly label = input.required<string>();
  readonly description = input<string>();
  readonly phase = input.required<number>();
  readonly forms = input<string[]>([]);
  readonly tables = input<string[]>([]);
}
