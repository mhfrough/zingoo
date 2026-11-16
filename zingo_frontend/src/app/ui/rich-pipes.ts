import { Pipe, PipeTransform } from '@angular/core';
import { plainToRich, richToPlain, sanitizeRich } from './rich-text';

/** a note as one line of plain text (inside a sentence or a table cell): {{ note | plain }} */
@Pipe({ name: 'plain' })
export class PlainPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    return richToPlain(v).replace(/\s*\n\s*/g, ' · ').replace(/(\s*·\s*){2,}/g, ' · ');
  }
}

/** a note with its formatting, for [innerHTML] (older plain-text notes keep their lines): <div class="rich" [innerHTML]="note | rich"></div> */
@Pipe({ name: 'rich' })
export class RichPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    return sanitizeRich(plainToRich(v));
  }
}
