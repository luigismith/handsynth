// Owner: ux-curator
//
// In-app manual. Modal overlay rendering USER_MANUAL.md as styled HTML.
// Toggled by F1, ?, or the bottom-right help icon. Escape (or click-outside)
// closes.
//
// We import the manual at build time via Vite's `?raw` suffix so the markdown
// text is bundled as a string literal (no fetch). A tiny purpose-built
// markdown converter handles headings (#, ##, ###), bullet lists, **bold**,
// `inline code`, paragraphs, and GFM-style pipe tables — every construct
// used in the manual itself. The converter is intentionally minimal: it does
// NOT support nested lists, blockquotes, images, or HTML passthrough — none
// of which are in the manual. We HTML-escape every text segment before
// emitting tags so even if the manual ever picks up a stray `<` it stays safe.

import { injectStyles } from './styles';
// Vite ?raw import — works in build & dev. Tests import the helper directly
// so they don't hit this loader.
import manualText from '../../USER_MANUAL.md?raw';

/**
 * Convert a small subset of GitHub-flavored markdown to HTML.
 *
 * Supported:
 *   - "# H1", "## H2", "### H3"
 *   - "- bullet" lists
 *   - **bold**
 *   - `inline code`
 *   - [label](url) links — opened in a new tab
 *   - GFM-style pipe tables (header row, separator row of ---|---, body)
 *   - Blank-line-separated paragraphs
 *   - "---" horizontal rules
 *
 * Not supported (would need a real parser): nested lists, blockquotes,
 * images, ordered lists, code blocks, raw HTML, ATX-style closing hashes.
 *
 * Exported so the test suite can drive it directly with fixed input.
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Heading.
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = inline(h[2]!);
      out.push('<h' + level + '>' + text + '</h' + level + '>');
      i += 1;
      continue;
    }

    // Pipe table: a line containing | followed by a separator like
    // "---|---|---". Group: header, sep, then any subsequent | lines.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)+\|?\s*$/.test(lines[i + 1] ?? '')
    ) {
      const header = splitRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        body.push(splitRow(lines[i]!));
        i += 1;
      }
      out.push(renderTable(header, body));
      continue;
    }

    // Bullet list. Consume consecutive "- " lines.
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i] ?? '')) {
        const m = /^\s*-\s+(.*)$/.exec(lines[i] ?? '');
        if (m) items.push(inline(m[1] ?? ''));
        i += 1;
      }
      const li = items.map((t) => '<li>' + t + '</li>').join('');
      out.push('<ul>' + li + '</ul>');
      continue;
    }

    // Horizontal rule.
    if (/^---+\s*$/.test(line)) {
      out.push('<hr/>');
      i += 1;
      continue;
    }

    // Paragraph. Consume consecutive non-empty, non-special lines.
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i] ?? '') &&
      !/^\s*-\s+/.test(lines[i] ?? '') &&
      !/^---+\s*$/.test(lines[i] ?? '') &&
      !((lines[i] ?? '').includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)+\|?\s*$/.test(lines[i + 1] ?? ''))
    ) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }

  return out.join('\n');
}

/** HTML-escape used before any inline replacements run. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline pass: HTML-escape, then run code/bold/link replacements via slots.
 * The slot trick avoids two problems: (a) later regex passes seeing emitted
 * tags, and (b) sentinels colliding with body-text digits ("3.5 s") — we use
 * a literal "SLT" prefix that never appears in the manual.
 */
function inline(s: string): string {
  let text = escapeHtml(s);

  const slots: string[] = [];
  const slot = (html: string): string => {
    const id = slots.length;
    slots.push(html);
    return 'SLT' + id + 'TLS';
  };

  // `code`
  text = text.replace(/`([^`]+)`/g, (_m, code: string) =>
    slot('<code>' + code + '</code>'),
  );

  // **bold**
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, b: string) =>
    slot('<strong>' + b + '</strong>'),
  );

  // [label](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, url: string) =>
      slot(
        '<a href="' +
          url +
          '" target="_blank" rel="noopener noreferrer">' +
          label +
          '</a>',
      ),
  );

  // Re-insert slots.
  text = text.replace(
    /SLT(\d+)TLS/g,
    (_m, idx: string) => slots[Number(idx)] ?? '',
  );

  return text;
}

function splitRow(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

function renderTable(header: string[], body: string[][]): string {
  const head =
    '<thead><tr>' +
    header.map((c) => '<th>' + inline(c) + '</th>').join('') +
    '</tr></thead>';
  const rows = body
    .map(
      (row) =>
        '<tr>' +
        row.map((c) => '<td>' + inline(c) + '</td>').join('') +
        '</tr>',
    )
    .join('');
  return '<table>' + head + '<tbody>' + rows + '</tbody></table>';
}

// ---------------------------------------------------------------------------
// HelpPanelImpl
// ---------------------------------------------------------------------------

const TOGGLE_KEYS = new Set(['F1', '?']);

export class HelpPanelImpl {
  private mounted = false;
  private root: HTMLDivElement | null = null;
  private cardEl: HTMLDivElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private lastFocus: Element | null = null;

  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;
    injectStyles();

    const root = document.createElement('div');
    root.className = 'hs-help-overlay hs-collapsed';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'HandSynth manual');

    const card = document.createElement('div');
    card.className = 'hs-help-card';
    card.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'hs-help-header';
    const title = document.createElement('h2');
    title.className = 'hs-help-title';
    title.textContent = 'MANUAL';
    const sub = document.createElement('span');
    sub.className = 'hs-help-sub';
    sub.textContent = 'PRESS ESC OR F1 TO CLOSE';
    header.append(title, sub);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'hs-help-body';
    body.innerHTML = markdownToHtml(manualText);
    card.appendChild(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hs-help-close';
    close.setAttribute('aria-label', 'Close manual');
    close.textContent = '×'; // ×
    close.addEventListener('click', () => this.setVisible(false));
    card.appendChild(close);

    root.appendChild(card);
    parent.appendChild(root);
    this.root = root;
    this.cardEl = card;

    // Click outside the card → close.
    this.clickOutsideHandler = (e: MouseEvent) => {
      if (!this.isVisible()) return;
      if (e.target === this.root) this.setVisible(false);
    };
    root.addEventListener('click', this.clickOutsideHandler);

    // Global Esc / F1 / ? handling. The HudControls help button is the
    // alternate path. F1 / ? toggle visibility; Esc only closes.
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isTypingTarget(e.target)) return;
      if (e.key === 'Escape' && this.isVisible()) {
        this.setVisible(false);
        e.preventDefault();
        return;
      }
      if (TOGGLE_KEYS.has(e.key)) {
        this.setVisible(!this.isVisible());
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.root && this.clickOutsideHandler) {
      this.root.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    if (this.root) this.root.remove();
    this.root = null;
    this.cardEl = null;
  }

  setVisible(visible: boolean): void {
    if (!this.root || !this.cardEl) return;
    if (visible) {
      this.lastFocus = document.activeElement;
      this.root.hidden = false;
      void this.root.offsetWidth;
      this.root.classList.remove('hs-collapsed');
      try {
        this.cardEl.focus({ preventScroll: true });
      } catch {
        /* happy-dom may not support focus opts */
      }
    } else {
      this.root.classList.add('hs-collapsed');
      const root = this.root;
      window.setTimeout(() => {
        if (root.classList.contains('hs-collapsed')) root.hidden = true;
      }, 220);
      if (this.lastFocus instanceof HTMLElement) {
        try {
          this.lastFocus.focus({ preventScroll: true });
        } catch {
          /* noop */
        }
      }
      this.lastFocus = null;
    }
  }

  isVisible(): boolean {
    return (
      this.root !== null &&
      !this.root.hidden &&
      !this.root.classList.contains('hs-collapsed')
    );
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }
}
