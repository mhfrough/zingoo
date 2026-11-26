import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, AttachmentsApi } from '../../core/attachments.api';
import { errorText } from '../../shared/errors';
import { fmtNumber } from '../../shared/format';
import { Btn, Help, IconComponent, Select } from '../../ui';

/** one damage line: becomes a claim on the load when the form is saved */
export interface DamageLine {
  kind: 'Damaged' | 'Missing' | 'Quality';
  bundles: number;
  note: string;
  /** uploaded proof files (ids) and their names for the list */
  proofs: { id: string; name: string }[];
}

export const DAMAGE_KINDS: { value: DamageLine['kind']; label: string }[] = [
  { value: 'Damaged', label: 'Damaged bundles' },
  { value: 'Missing', label: 'Missing bundles' },
  { value: 'Quality', label: 'Poor quality' },
];

/** the lines as the API takes them (`damages` on pickup / receipt), empty lines left out */
export const damagesBody = (lines: DamageLine[]) =>
  lines.filter((l) => l.bundles > 0).map((l) => ({ kind: l.kind, bundles: Number(l.bundles), note: l.note.trim(), proofIds: l.proofs.map((p) => p.id) }));

/** a line is complete when it has bundles and says what happened */
export const damagesValid = (lines: DamageLine[]) => lines.every((l) => l.bundles >= 1 && l.note.trim().length > 0);

/**
 * Damage found on a load: kind, bundles, what happened and several photos / PDFs per line. Each line becomes a
 * claim on the load the manufacturer must answer (accept, reject or hold); the photos stay with the claim.
 *
 *   <app-damage-lines [(lines)]="damages" [maxBundles]="20" />
 */
@Component({
  selector: 'app-damage-lines',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Btn, Help, IconComponent, Select],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      grid-column: 1 / -1;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);

      & h4 {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        margin: 0;
        font-size: var(--text-sm);
      }

      & small {
        color: var(--text-3);
      }
    }

    .line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(5.5rem, 7rem) auto;
      align-items: end;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-card);

      & .fl {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-1);
        min-inline-size: 0;
        text-align: start;
        font-size: var(--text-xs);
        font-weight: var(--weight-semibold);
        color: var(--text-2);
      }

      & .note,
      & .files {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-3);
      }

      & .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px var(--space-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--text-2);

        & button {
          padding: 0;
          border: 0;
          background: none;
          color: inherit;
          cursor: pointer;
        }
      }

      & .upload {
        position: relative;
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        gap: var(--space-1);
        cursor: pointer;

        & input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
      }
    }

    .line .fl > input,
    .line .fl > :is(select, app-select) {
      inline-size: 100%;
    }

    .sum {
      font-size: var(--text-xs);
      color: var(--text-3);
    }
  `,
  template: `
    <div class="head">
      <h4>{{ title() }}
        <app-help title="Damage" text="Damaged, missing or poor quality bundles. Each line becomes a claim the manufacturer answers: accept (credit or replacement), reject or hold. Add photos or PDFs as proof; the claim's value stays out of what is due until it is decided." />
      </h4>
      <button appBtn type="button" size="sm" icon="plus" (click)="add()">Add damage</button>
    </div>
    @for (l of lines(); track $index; let i = $index) {
      <div class="line">
        <label class="fl">What is wrong
          <app-select [value]="l.kind" (valueChange)="set(i, { kind: $any($event) })">
            @for (k of kinds; track k.value) { <option [value]="k.value">{{ k.label }}</option> }
          </app-select>
        </label>
        <label class="fl">Bundles
          <input type="number" min="1" step="1" [max]="maxBundles() || null" [value]="l.bundles" (input)="set(i, { bundles: +$any($event.target).value })" />
        </label>
        <button appBtn type="button" variant="ghost" icon="trash" iconOnly (click)="remove(i)" [attr.aria-label]="'Remove damage line ' + (i + 1)"></button>
        <label class="fl note">What happened
          <input type="text" maxlength="500" [value]="l.note" (input)="set(i, { note: $any($event.target).value })" placeholder="e.g. 3 bundles wet, packets torn" />
        </label>
        <div class="files">
          @for (p of l.proofs; track p.id) {
            <span class="chip">{{ p.name }} <button type="button" (click)="dropProof(i, p.id)" [attr.aria-label]="'Remove ' + p.name"><app-icon name="x" [size]="12" /></button></span>
          }
          <label class="btn upload" data-size="sm">
            <app-icon name="upload" [size]="14" /> {{ busy() === i ? 'Uploading...' : 'Add photos / PDF' }}
            <input type="file" multiple [accept]="accept" (change)="upload(i, $event)" [disabled]="busy() !== null" />
          </label>
          @if (!l.proofs.length) { <span>No proof yet</span> }
        </div>
      </div>
    } @empty {
      <small class="sum">No damage. Add a line if bundles are damaged, missing or poor quality.</small>
    }
    @if (error()) { <div class="notice" data-tone="danger" role="alert">{{ error() }}</div> }
    @if (lines().length) {
      <small class="sum">{{ num(total()) }} bundle{{ total() === 1 ? '' : 's' }} claimed{{ maxBundles() ? ' of ' + num(maxBundles()) : '' }}</small>
    }
  `,
})
export class DamageLines {
  private files = inject(AttachmentsApi);
  readonly lines = model<DamageLine[]>([]);
  /** bundles on the load (the lines cannot claim more) */
  readonly maxBundles = input(0);
  readonly title = input('Damage found');
  protected kinds = DAMAGE_KINDS;
  protected accept = ATTACHMENT_ACCEPT;
  protected busy = signal<number | null>(null);
  protected error = signal('');
  protected num = fmtNumber;
  protected total = computed(() => this.lines().reduce((n, l) => n + (Number(l.bundles) || 0), 0));

  protected add() {
    this.lines.update((ls) => [...ls, { kind: 'Damaged', bundles: 1, note: '', proofs: [] }]);
  }

  protected remove(i: number) {
    this.lines.update((ls) => ls.filter((_, j) => j !== i));
  }

  protected set(i: number, patch: Partial<DamageLine>) {
    this.lines.update((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  protected dropProof(i: number, id: string) {
    this.set(i, { proofs: this.lines()[i].proofs.filter((p) => p.id !== id) });
    this.files.remove(id).subscribe({ error: () => undefined });
  }

  /** each file goes up at once (5 MB at most); the ids are sent with the form */
  protected upload(i: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    const big = picked.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (big) {
      this.error.set(`${big.name} is larger than 5 MB.`);
      return;
    }
    this.error.set('');
    const next = (k: number) => {
      if (k >= picked.length) {
        this.busy.set(null);
        return;
      }
      this.busy.set(i);
      this.files.upload(picked[k]).subscribe({
        next: (m) => {
          this.set(i, { proofs: [...this.lines()[i].proofs, { id: m.id, name: m.name }] });
          next(k + 1);
        },
        error: (err) => {
          this.busy.set(null);
          this.error.set(errorText(err));
        },
      });
    };
    next(0);
  }
}
