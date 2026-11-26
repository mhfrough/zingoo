import { Transform } from 'class-transformer';

/**
 * Notes are written in the rich-text editor (a little HTML: p, br, strong, em, u, ul, ol, li, a). Where the server
 * builds plain text from them (notification titles and bodies), the markup goes: paragraphs and list items become
 * " · "-separated parts. Plain text passes unchanged.
 */
export function plainText(v: string | null | undefined): string {
  if (!v) return '';
  if (!/<\/?(p|br|strong|em|u|ul|ol|li|a)\b[^>]*>/i.test(v)) return v;
  return v
    .replace(/<\s*br\s*\/?>/gi, ' · ')
    .replace(/<\/(p|li)>\s*/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/(\s*·\s*)+/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();
}

/**
 * A short reference (bank reference, transfer or cheque number) may come from the rich-text editor: keep only its plain
 * text, so ledger lines, notifications and duplicate checks never see markup. Runs before the length check.
 */
export const PlainRef = () => Transform(({ value }) => (typeof value === 'string' ? plainText(value) : value));
