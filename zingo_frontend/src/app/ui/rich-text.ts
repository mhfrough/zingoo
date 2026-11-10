import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, ViewEncapsulation, computed,
  inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { TEXT_LIMITS } from './field';
import { IconComponent, IconName } from './icon';

/* ───────────── sanitising: the only HTML the editor can produce or accept ───────────── */

const BLOCK = new Set(['P', 'UL', 'OL']);
const TAGS: Record<string, string> = {
  B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', P: 'p', DIV: 'p', UL: 'ul', OL: 'ol', LI: 'li',
  BR: 'br', A: 'a',
};
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

/** http, https and mailto links only; a bare "example.com" becomes https://example.com */
export function safeHref(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || /[\s<>"]/.test(v)) return null;
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // javascript:, data:, ...
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : null;
}

/**
 * Reduce any HTML to: p, br, strong, em, u, ul, ol, li and a (safe href, opens in a new tab). Everything else is
 * unwrapped to its text. Returns '' for an editor that holds no text.
 */
export function sanitizeRich(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = document.createElement('div');

  const walk = (src: Node, dst: Node) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(n.textContent ?? ''));
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      if (DROP.has(el.tagName)) return;
      const to = TAGS[el.tagName];
      if (!to) {
        walk(el, dst); // unknown tag: keep its content
        return;
      }
      if (to === 'br') {
        dst.appendChild(document.createElement('br'));
        return;
      }
      const copy = document.createElement(to);
      if (to === 'a') {
        const href = safeHref(el.getAttribute('href'));
        if (!href) {
          walk(el, dst);
          return;
        }
        copy.setAttribute('href', href);
        copy.setAttribute('target', '_blank');
        copy.setAttribute('rel', 'noopener noreferrer');
      }
      walk(el, copy);
      dst.appendChild(copy);
    });
  };
  walk(doc.body, out);

  // wrap loose inline runs at the top level in <p>
  const result = document.createElement('div');
  let run: HTMLParagraphElement | null = null;
  out.childNodes.forEach((n) => {
    const isBlock = n.nodeType === Node.ELEMENT_NODE && BLOCK.has((n as Element).tagName);
    if (isBlock) {
      run = null;
      result.appendChild(n.cloneNode(true));
    } else {
      run ??= result.appendChild(document.createElement('p'));
      run.appendChild(n.cloneNode(true));
    }
  });
  const text = (result.textContent ?? '').replace(/ /g, ' ').trim();
  return text ? result.innerHTML : '';
}

/** characters of visible text in an HTML string (what the counter shows) */
export function richTextLength(html: string | null | undefined): number {
  if (!html) return 0;
  const div = document.createElement('div');
  div.innerHTML = sanitizeRich(html);
  return (div.textContent ?? '').length;
}

/* ───────────── the editor ───────────── */

interface Tool {
  id: string;
  label: string;
  icon: IconName;
  command?: string;
}

const TOOLS: Tool[] = [
  { id: 'bold', label: 'Bold', icon: 'bold', command: 'bold' },
  { id: 'italic', label: 'Italic', icon: 'italic', command: 'italic' },
  { id: 'underline', label: 'Underline', icon: 'underline', command: 'underline' },
  { id: 'ul', label: 'Bulleted list', icon: 'list', command: 'insertUnorderedList' },
  { id: 'ol', label: 'Numbered list', icon: 'list-ordered', command: 'insertOrderedList' },
  { id: 'link', label: 'Add link', icon: 'link' },
  { id: 'clear', label: 'Clear formatting', icon: 'eraser', command: 'removeFormat' },
];

const STATE_COMMANDS: Record<string, string> = {
  bold: 'bold', italic: 'italic', underline: 'underline', ul: 'insertUnorderedList', ol: 'insertOrderedList',
};

let nextRteId = 0;

/**
 * Rich text editor for notes and descriptions: bold, italic, underline, bullet and numbered lists, links, clear.
 * Value is a small, sanitised HTML string (see sanitizeRich); show it with <div class="rich" [innerHTML]="v">.
 * Works with formControlName, formControl and ngModel. Counts visible characters against `max` (standard 500;
 * TEXT_LIMITS.description is 1000): grey, orange from 80%, red from 95%; typing and pasting stop at the limit.
 *
 *   <app-field label="Notes"><app-rich-text formControlName="notes" placeholder="Anything the team should know" /></app-field>
 *
 * Keyboard: Ctrl/Cmd+B, I, U, K (link). The toolbar is one tab stop; arrow keys move along it.
 */
@Component({
  selector: 'app-rich-text',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'rte',
    '[attr.data-empty]': 'empty() ? "" : null',
    '[attr.data-disabled]': 'disabled() ? "" : null',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '(document:selectionchange)': 'refreshTools()',
  },
  template: `
    <div class="rte__bar" role="toolbar" aria-label="Text formatting" [attr.aria-controls]="editorId" (keydown)="onBarKey($event)">
      @for (t of tools; track t.id; let i = $index) {
        @if (t.id === 'ul' || t.id === 'link') {
          <span class="rte__sep" aria-hidden="true"></span>
        }
        <button
          type="button"
          class="rte__btn"
          [attr.data-tool]="t.id"
          [title]="t.label"
          [attr.aria-label]="t.label"
          [attr.aria-pressed]="t.id === 'clear' ? null : !!pressed()[t.id]"
          [attr.aria-expanded]="t.id === 'link' ? linkOpen() : null"
          [attr.tabindex]="i === roving() ? 0 : -1"
          [disabled]="disabled()"
          (mousedown)="$event.preventDefault()"
          (focus)="roving.set(i)"
          (click)="run(t)"
        >
          <app-icon [name]="t.icon" [size]="16" />
        </button>
      }
    </div>

    @if (linkOpen()) {
      <div class="rte__link" role="group" aria-label="Link address">
        <input
          #linkInput
          class="control"
          data-field-skip
          type="url"
          inputmode="url"
          placeholder="https://example.com"
          aria-label="Link address"
          [value]="linkUrl()"
          (input)="linkUrl.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); applyLink()"
          (keydown.escape)="$event.stopPropagation(); closeLink(true)"
        />
        <button type="button" class="btn" data-variant="primary" data-size="sm" (click)="applyLink()">Apply link</button>
        <button type="button" class="btn" data-variant="ghost" data-size="sm" (click)="removeLink()">Remove link</button>
      </div>
    }

    <div
      #editor
      class="rte__editor rich"
      role="textbox"
      aria-multiline="true"
      [id]="editorId"
      [attr.contenteditable]="disabled() ? 'false' : 'true'"
      [attr.aria-disabled]="disabled() ? 'true' : null"
      [attr.aria-describedby]="countId"
      [attr.aria-label]="ariaLabel() || null"
      [attr.data-placeholder]="placeholder()"
      [attr.data-empty]="empty() ? '' : null"
      spellcheck="true"
      (input)="onInput()"
      (beforeinput)="onBeforeInput($event)"
      (paste)="onPaste($event)"
      (blur)="onBlur()"
      (keydown)="onEditorKey($event)"
    ></div>

    <span class="char-count" [id]="countId" [attr.data-level]="level()">{{ length() }} / {{ max() }}</span>
  `,
})
export class RichText implements ControlValueAccessor, AfterViewInit {
  readonly placeholder = input('');
  /** most visible characters allowed; standard is 500 for notes, 1000 for descriptions */
  readonly max = input<number>(TEXT_LIMITS.note);
  readonly ariaLabel = input<string>();
  readonly forceInvalid = input(false);

  protected tools = TOOLS;
  protected pressed = signal<Record<string, boolean>>({});
  protected roving = signal(0);
  protected empty = signal(true);
  protected length = signal(0);
  protected disabled = signal(false);
  protected linkOpen = signal(false);
  protected linkUrl = signal('');

  protected level = computed(() => {
    const n = this.length();
    const max = this.max();
    return n >= max ? 'full' : n / max >= 0.95 ? 'danger' : n / max >= 0.8 ? 'warn' : 'ok';
  });

  private uid = nextRteId++;
  protected editorId = `rte-${this.uid}-editor`;
  protected countId = `rte-${this.uid}-count`;

  private ngControl = inject(NgControl, { self: true, optional: true });
  private cdr = inject(ChangeDetectorRef);
  private editorEl = viewChild.required<ElementRef<HTMLElement>>('editor');
  private linkInputEl = viewChild<ElementRef<HTMLInputElement>>('linkInput');
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  private lastEmitted = '';
  private pending = '';
  private viewReady = false;
  private savedRange: Range | null = null;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* older engines: the editor then uses div, which sanitizeRich turns into p */
    }
  }

  protected invalid() {
    const c = this.ngControl;
    return this.forceInvalid() || !!(c && c.invalid && c.touched);
  }

  focus() {
    this.editorEl().nativeElement.focus();
  }

  // ── editing ──
  protected run(tool: Tool) {
    if (tool.id === 'link') {
      this.linkOpen() ? this.closeLink(true) : this.openLink();
      return;
    }
    this.focus();
    document.execCommand(tool.command!, false);
    this.afterEdit();
  }

  protected onInput() {
    this.afterEdit();
  }

  private afterEdit() {
    const clean = sanitizeRich(this.editorEl().nativeElement.innerHTML);
    this.syncState();
    if (clean !== this.lastEmitted) {
      this.lastEmitted = clean;
      this.onChange(clean);
    }
    this.refreshTools();
    this.cdr.markForCheck();
  }

  private syncState() {
    const el = this.editorEl().nativeElement;
    const text = el.textContent ?? '';
    this.length.set(text.length);
    this.empty.set(!text.trim() && !el.querySelector('li'));
  }

  protected onBlur() {
    this.onTouched();
    this.cdr.markForCheck();
  }

  /** stop typing at the limit (a replaced selection frees its characters first) */
  protected onBeforeInput(event: InputEvent) {
    if (!event.inputType.startsWith('insert') || event.isComposing) return;
    const incoming = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    if (!incoming) return;
    const selected = window.getSelection()?.toString().length ?? 0;
    if (this.length() - selected + incoming.length > this.max()) event.preventDefault();
  }

  protected onPaste(event: ClipboardEvent) {
    event.preventDefault();
    if (this.disabled()) return;
    const selected = window.getSelection()?.toString().length ?? 0;
    const room = this.max() - (this.length() - selected);
    if (room <= 0) return;
    const html = event.clipboardData?.getData('text/html') ?? '';
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const clean = html ? sanitizeRich(html) : '';
    if (clean && richTextLength(clean) <= room) document.execCommand('insertHTML', false, clean);
    else document.execCommand('insertText', false, text.slice(0, room));
    this.afterEdit();
  }

  protected onEditorKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openLink();
    }
  }

  // ── toolbar state + keyboard ──
  protected refreshTools() {
    const el = this.editorEl().nativeElement;
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
    const next: Record<string, boolean> = {};
    for (const [id, cmd] of Object.entries(STATE_COMMANDS)) {
      try {
        next[id] = document.queryCommandState(cmd);
      } catch {
        next[id] = false;
      }
    }
    next['link'] = !!this.anchorOf(sel.anchorNode);
    const prev = this.pressed();
    if (Object.keys(next).some((k) => next[k] !== prev[k])) {
      this.pressed.set(next);
      this.cdr.markForCheck();
    }
  }

  private anchorOf(node: Node | null): HTMLAnchorElement | null {
    const el = node instanceof Element ? node : node?.parentElement;
    return (el?.closest('a') as HTMLAnchorElement | null) ?? null;
  }

  protected onBarKey(event: KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const n = this.tools.length;
    let i = this.roving();
    if (event.key === 'ArrowRight') i = (i + 1) % n;
    else if (event.key === 'ArrowLeft') i = (i - 1 + n) % n;
    else i = event.key === 'Home' ? 0 : n - 1;
    this.roving.set(i);
    this.cdr.detectChanges();
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.rte__btn')[i]?.focus();
  }

  // ── link bar ──
  protected openLink() {
    const sel = window.getSelection();
    const el = this.editorEl().nativeElement;
    this.savedRange = sel && sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    const existing = sel ? this.anchorOf(sel.anchorNode) : null;
    this.linkUrl.set(existing?.getAttribute('href') ?? '');
    this.linkOpen.set(true);
    this.cdr.detectChanges();
    this.linkInputEl()?.nativeElement.focus();
  }

  protected closeLink(refocus: boolean) {
    this.linkOpen.set(false);
    this.cdr.markForCheck();
    if (refocus) {
      this.focus();
      this.restoreRange();
    }
  }

  private restoreRange() {
    const sel = window.getSelection();
    if (this.savedRange && sel) {
      sel.removeAllRanges();
      sel.addRange(this.savedRange);
    }
  }

  protected applyLink() {
    const href = safeHref(this.linkUrl());
    if (!href) {
      this.linkInputEl()?.nativeElement.setCustomValidity('Enter a web address such as https://example.com');
      this.linkInputEl()?.nativeElement.reportValidity();
      this.linkInputEl()?.nativeElement.setCustomValidity('');
      return;
    }
    this.focus();
    this.restoreRange();
    const collapsed = window.getSelection()?.isCollapsed ?? true;
    if (collapsed) {
      const label = href.replace(/^(https?:\/\/|mailto:)/i, '');
      if (this.length() + label.length <= this.max()) {
        document.execCommand('insertHTML', false, `<a href="${href}">${label}</a>`);
      }
    } else {
      document.execCommand('createLink', false, href);
    }
    this.linkOpen.set(false);
    this.afterEdit();
  }

  protected removeLink() {
    this.focus();
    this.restoreRange();
    document.execCommand('unlink', false);
    this.linkOpen.set(false);
    this.afterEdit();
  }

  // ── ControlValueAccessor ──
  writeValue(value: string | null) {
    this.pending = sanitizeRich(value);
    this.lastEmitted = this.pending;
    if (this.viewReady) this.paint();
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.paint();
  }

  /** put the model value into the editor (the view may not exist yet when forms first write) */
  private paint() {
    const el = this.editorEl().nativeElement;
    if (el.innerHTML !== this.pending) el.innerHTML = this.pending;
    this.syncState();
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: string) => void) {
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
