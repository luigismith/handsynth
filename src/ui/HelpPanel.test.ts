// Owner: ux-curator
//
// Smoke tests for the HelpPanel: markdown converter and mount/visibility.
// happy-dom is enough — we only assert DOM wiring + markdown output shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HelpPanelImpl, markdownToHtml } from './HelpPanel';

describe('markdownToHtml', () => {
  it('renders top-level headings', () => {
    expect(markdownToHtml('# Hello')).toContain('<h1>Hello</h1>');
    expect(markdownToHtml('## Section')).toContain('<h2>Section</h2>');
    expect(markdownToHtml('### Sub')).toContain('<h3>Sub</h3>');
  });

  it('renders bullet lists', () => {
    const html = markdownToHtml('- one\n- two\n- three');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
    expect(html).toContain('<li>three</li>');
    expect(html).toContain('</ul>');
  });

  it('renders bold and inline code', () => {
    const html = markdownToHtml('**bold** and `code` together');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders links with target=_blank', () => {
    const html = markdownToHtml('See [docs](https://example.com) here');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>docs<');
  });

  it('renders pipe tables with header / body rows', () => {
    const md = `| Key | Action |\n|---|---|\n| Esc | mute |\n| F1 | help |`;
    const html = markdownToHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>Key</th>');
    expect(html).toContain('<th>Action</th>');
    expect(html).toContain('<td>Esc</td>');
    expect(html).toContain('<td>mute</td>');
    expect(html).toContain('<td>F1</td>');
  });

  it('renders blank-line-separated paragraphs', () => {
    const html = markdownToHtml('First.\n\nSecond.');
    expect(html).toContain('<p>First.</p>');
    expect(html).toContain('<p>Second.</p>');
  });

  it('escapes raw HTML in body text', () => {
    const html = markdownToHtml('A <script>tag</script> in text');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('preserves digits in body text (no slot collision)', () => {
    // The slot trick uses an "SLT<n>TLS" sentinel so plain numbers in the
    // body must come out untouched.
    const html = markdownToHtml('Took 3 seconds at 1.5 s mark');
    expect(html).toContain('Took 3 seconds at 1.5 s mark');
  });

  it('renders horizontal rules', () => {
    const html = markdownToHtml('Above\n\n---\n\nBelow');
    expect(html).toContain('<hr/>');
  });
});

describe('HelpPanelImpl', () => {
  let parent: HTMLDivElement;
  let panel: HelpPanelImpl;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    panel = new HelpPanelImpl();
  });

  afterEach(() => {
    panel.unmount();
    parent.remove();
  });

  it('mounts a hidden overlay with a card containing the manual title', () => {
    panel.mount(parent);
    const overlay = parent.querySelector('.hs-help-overlay');
    expect(overlay).toBeTruthy();
    // Hidden by default (mount does not auto-show).
    expect(overlay?.hasAttribute('hidden')).toBe(true);
    const title = parent.querySelector('.hs-help-title');
    expect(title?.textContent).toBe('MANUAL');
  });

  it('setVisible(true) reveals the panel and setVisible(false) hides it', async () => {
    panel.mount(parent);
    panel.setVisible(true);
    expect(panel.isVisible()).toBe(true);

    panel.setVisible(false);
    // The panel uses a 220 ms timeout to apply hidden — wait it out.
    await new Promise((r) => setTimeout(r, 260));
    expect(panel.isVisible()).toBe(false);
  });

  it('responds to F1 by toggling visibility', () => {
    panel.mount(parent);
    expect(panel.isVisible()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }));
    expect(panel.isVisible()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }));
    // Still visible until the timer fires; the call IS made though — assert
    // the class flipped.
    const overlay = parent.querySelector('.hs-help-overlay');
    expect(overlay?.classList.contains('hs-collapsed')).toBe(true);
  });

  it('Escape closes the panel when visible (no-op when hidden)', () => {
    panel.mount(parent);
    panel.setVisible(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const overlay = parent.querySelector('.hs-help-overlay');
    expect(overlay?.classList.contains('hs-collapsed')).toBe(true);
  });

  it('unmount removes the overlay from the DOM', () => {
    panel.mount(parent);
    expect(parent.querySelector('.hs-help-overlay')).toBeTruthy();
    panel.unmount();
    expect(parent.querySelector('.hs-help-overlay')).toBeFalsy();
  });
});
