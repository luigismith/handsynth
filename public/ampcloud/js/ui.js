// Window manager (drag, snap, dock, shade, resize, scale), popup menus,
// modal dialogs and small DOM helpers shared by all windows.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`ampcloud:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ampcloud:${key}`, JSON.stringify(value));
    } catch {}
  },
};

/** Pixel-art icons for buttons, drawn as tiny inline SVGs. */
export function icon(name) {
  const paths = {
    prev: 'M2 3h2v10H2zM5 8l7-5v10z',
    play: 'M4 3l9 5-9 5z',
    pause: 'M3 3h3v10H3zM9 3h3v10H9z',
    stop: 'M3 3h9v9H3z',
    next: 'M12 3h2v10h-2zM11 8L4 13V3z',
    eject: 'M7.5 3L13 9H2zM2 10h11v2H2z',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name]);
  svg.append(p);
  return svg;
}

// ---------------------------------------------------------------------------
// Window manager
// ---------------------------------------------------------------------------
const SNAP = 10;

export class WindowManager {
  constructor(desktop) {
    this.desktop = desktop;
    this.windows = new Map(); // id -> {el, opts}
    this.scale = 1;
    this.z = 10;
    window.addEventListener('resize', () => this.fit());
  }

  setScale(mode) {
    this.scaleMode = mode;
    store.set('scale', mode);
    this.fit();
  }

  fit() {
    const mode = this.scaleMode ?? store.get('scale', 'auto');
    this.scaleMode = mode;
    // clientWidth = layout viewport; innerWidth grows on phones when content overflows
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    this.narrow = vw < 600;
    let s;
    if (mode === 'auto') {
      // phone: fill the width; desktop: fit player stack + library side by side
      if (this.narrow) s = Math.max(1, Math.floor(((vw - 8) / 275) * 100) / 100);
      else s = Math.min(3, Math.max(1, Math.floor(Math.min((vw - 24) / 650, (vh - 24) / 464) * 4) / 4));
    } else s = Number(mode);
    this.scale = s;
    document.documentElement.style.setProperty('--scale', s);
    this.desktop.style.zoom = s;
    this.desktop.classList.toggle('narrow', this.narrow);
    this.dispatchLayout();
  }

  dispatchLayout() {
    if (this.narrow) {
      // phone: one column, in a fixed order, no free dragging
      let y = 0;
      for (const id of ['main', 'lib', 'pl', 'eq']) {
        const w = this.windows.get(id);
        if (!w || w.el.hidden) continue;
        w.el.style.left = '0px';
        w.el.style.top = `${y}px`;
        y += w.el.offsetHeight;
      }
      this.desktop.style.height = `${y}px`;
      this.desktop.style.width = '275px';
    } else {
      this.desktop.style.height = '';
      this.desktop.style.width = '';
      for (const w of this.windows.values()) if (!w.el.hidden) this.clampIntoView(w.el);
    }
  }

  /** Register a window element. opts: {id, x, y, resizable, minW, minH} */
  add(el, opts) {
    this.windows.set(opts.id, { el, opts });
    const saved = store.get(`win:${opts.id}`, null);
    const pos = saved || { x: opts.x, y: opts.y, w: opts.w, h: opts.h, hidden: opts.hidden, shade: false };
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    if (opts.resizable) {
      el.style.width = `${Math.max(opts.minW, pos.w || opts.w)}px`;
      el.style.height = `${Math.max(opts.minH, pos.h || opts.h)}px`;
    }
    el.hidden = Boolean(pos.hidden);
    el.classList.toggle('shade', Boolean(pos.shade));
    el.addEventListener('pointerdown', () => this.focus(opts.id), true);

    const title = el.querySelector('.titlebar');
    title.addEventListener('pointerdown', (e) => this.startDrag(e, opts.id));
    title.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      this.toggleShade(opts.id);
    });
    const grip = el.querySelector('.grip');
    if (grip) grip.addEventListener('pointerdown', (e) => this.startResize(e, opts.id));
    this.desktop.append(el);
  }

  save(id) {
    const { el } = this.windows.get(id);
    store.set(`win:${id}`, {
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: el.offsetWidth,
      h: parseFloat(el.style.height) || el.offsetHeight,
      hidden: el.hidden,
      shade: el.classList.contains('shade'),
    });
  }

  focus(id) {
    for (const [wid, w] of this.windows) w.el.classList.toggle('active', wid === id);
    const w = this.windows.get(id);
    if (w) w.el.style.zIndex = ++this.z;
  }

  isVisible(id) {
    return !this.windows.get(id)?.el.hidden;
  }

  toggle(id, force) {
    const w = this.windows.get(id);
    if (!w) return;
    w.el.hidden = force === undefined ? !w.el.hidden : !force;
    if (!w.el.hidden) {
      this.clampIntoView(w.el);
      this.focus(id);
    }
    this.save(id);
    this.dispatchLayout();
    this.onchange?.();
  }

  toggleShade(id) {
    const w = this.windows.get(id);
    w.el.classList.toggle('shade');
    this.save(id);
    this.dispatchLayout();
  }

  resetLayout() {
    for (const [id, w] of this.windows) {
      localStorage.removeItem(`ampcloud:win:${id}`);
      const o = w.opts;
      w.el.style.left = `${o.x}px`;
      w.el.style.top = `${o.y}px`;
      if (o.resizable) {
        w.el.style.width = `${o.w}px`;
        w.el.style.height = `${o.h}px`;
      }
      w.el.hidden = Boolean(o.hidden);
      w.el.classList.remove('shade');
    }
    this.dispatchLayout();
    this.onchange?.();
  }

  rect(el) {
    return {
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
  }

  clampIntoView(el) {
    const r = this.rect(el);
    const maxX = Math.max(0, document.documentElement.clientWidth / this.scale - 40);
    const maxY = Math.max(0, document.documentElement.clientHeight / this.scale - 14);
    el.style.left = `${Math.min(Math.max(r.x, -r.w + 40), maxX)}px`;
    el.style.top = `${Math.min(Math.max(r.y, 0), maxY)}px`;
  }

  /** Windows glued to `id` (touching edges), found transitively. */
  dockedTo(id) {
    const touching = (a, b) => {
      const ra = this.rect(a);
      const rb = this.rect(b);
      const vOverlap = ra.y < rb.y + rb.h && rb.y < ra.y + ra.h;
      const hOverlap = ra.x < rb.x + rb.w && rb.x < ra.x + ra.w;
      return (
        (vOverlap && (Math.abs(ra.x + ra.w - rb.x) <= 1 || Math.abs(rb.x + rb.w - ra.x) <= 1)) ||
        (hOverlap && (Math.abs(ra.y + ra.h - rb.y) <= 1 || Math.abs(rb.y + rb.h - ra.y) <= 1))
      );
    };
    const group = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = this.windows.get(queue.shift()).el;
      for (const [wid, w] of this.windows) {
        if (group.has(wid) || w.el.hidden) continue;
        if (touching(cur, w.el)) group.add(wid), queue.push(wid);
      }
    }
    return group;
  }

  startDrag(e, id) {
    if (this.narrow || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    // dragging the main window drags everything docked to it, like the classic player
    const moving = id === 'main' ? this.dockedTo('main') : new Set([id]);
    const start = { x: e.clientX, y: e.clientY };
    const origin = new Map([...moving].map((wid) => [wid, this.rect(this.windows.get(wid).el)]));
    const lead = origin.get(id);
    const others = [...this.windows].filter(([wid, w]) => !moving.has(wid) && !w.el.hidden).map(([, w]) => this.rect(w.el));
    const vw = document.documentElement.clientWidth / this.scale;
    const vh = document.documentElement.clientHeight / this.scale;

    const move = (ev) => {
      let dx = (ev.clientX - start.x) / this.scale;
      let dy = (ev.clientY - start.y) / this.scale;
      let nx = lead.x + dx;
      let ny = lead.y + dy;
      // magnetic snap to screen edges and other windows' edges
      const xs = [0, vw - lead.w];
      const ys = [0, vh - lead.h];
      for (const o of others) {
        xs.push(o.x, o.x + o.w, o.x - lead.w, o.x + o.w - lead.w);
        ys.push(o.y, o.y + o.h, o.y - lead.h, o.y + o.h - lead.h);
      }
      const snap = (v, list) => list.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), Infinity);
      const sx = snap(nx, xs);
      const sy = snap(ny, ys);
      if (Math.abs(sx - nx) < SNAP) nx = sx;
      if (Math.abs(sy - ny) < SNAP) ny = sy;
      dx = nx - lead.x;
      dy = ny - lead.y;
      for (const [wid, r] of origin) {
        const el = this.windows.get(wid).el;
        el.style.left = `${Math.round(r.x + dx)}px`;
        el.style.top = `${Math.round(Math.max(0, r.y + dy))}px`;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      for (const wid of moving) this.save(wid);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  startResize(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const { el, opts } = this.windows.get(id);
    const start = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight };
    const move = (ev) => {
      // classic players resize in 25 x 29 px steps
      const dw = Math.round((ev.clientX - start.x) / this.scale / 25) * 25;
      const dh = Math.round((ev.clientY - start.y) / this.scale / 29) * 29;
      if (!this.narrow) el.style.width = `${Math.max(opts.minW, start.w + dw)}px`;
      el.style.height = `${Math.max(opts.minH, start.h + dh)}px`;
      this.dispatchLayout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.save(id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

// ---------------------------------------------------------------------------
// Popup menus (classic grey context menus)
// ---------------------------------------------------------------------------
let openMenu = null;

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

/**
 * items: [{label, action, checked, disabled, items (submenu)} | '-']
 * Positioned at a viewport point or under an anchor element.
 */
export function showMenu(items, at) {
  closeMenu();
  const build = (list) => {
    const m = h('div', { class: 'menu', role: 'menu' });
    for (const it of list) {
      if (it === '-') {
        m.append(h('div', { class: 'menu-sep' }));
        continue;
      }
      const row = h(
        'div',
        {
          class: `menu-item${it.disabled ? ' disabled' : ''}${it.items ? ' has-sub' : ''}`,
          role: 'menuitem',
          tabindex: '-1',
        },
        h('span', { class: 'menu-check', text: it.checked ? '✓' : '' }),
        h('span', { class: 'menu-label', text: it.label }),
        it.hint ? h('span', { class: 'menu-hint', text: it.hint }) : null,
      );
      if (it.items) {
        const sub = build(it.items.length ? it.items : [{ label: '(vuoto)', disabled: true }]);
        sub.classList.add('submenu');
        row.append(sub);
      } else if (!it.disabled) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          it.action?.();
        });
      }
      m.append(row);
    }
    return m;
  };
  const menu = build(items);
  document.body.append(menu);
  let x, y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.left;
    y = r.bottom;
  } else ({ x, y } = at);
  const mr = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(2, Math.min(x, window.innerWidth - mr.width - 2))}px`;
  menu.style.top = `${Math.max(2, y + mr.height > window.innerHeight ? y - mr.height : y)}px`;
  openMenu = menu;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
/**
 * Modal window in the player style. `body` is an element; buttons are
 * [{label, value, primary}]. Resolves with the clicked value (or null).
 * `onSubmit(value)` may return false / throw to keep the dialog open.
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onSubmit, dismissable = true }) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'dlg-error', role: 'alert' });
    const btnRow = h('div', { class: 'dlg-buttons' });
    const form = h('form', { class: 'dlg-body', novalidate: true }, body, err, btnRow);
    const win = h(
      'div',
      { class: 'dialog win active', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'titlebar' }, h('span', { class: 'title-text', text: title })),
      form,
    );
    const overlay = h('div', { class: 'overlay' }, win);
    let busy = false;
    const finish = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const submit = async (value) => {
      if (busy) return;
      err.textContent = '';
      if (onSubmit && value !== null) {
        busy = true;
        win.classList.add('busy');
        try {
          const ok = await onSubmit(value);
          if (ok === false) return;
        } catch (e) {
          err.textContent = e.message || String(e);
          return;
        } finally {
          busy = false;
          win.classList.remove('busy');
        }
      }
      finish(value);
    };
    for (const b of buttons) {
      btnRow.append(
        h('button', {
          type: b.primary ? 'submit' : 'button',
          class: `btn${b.primary ? ' primary' : ''}`,
          text: b.label,
          onclick: b.primary ? undefined : () => submit(b.value),
        }),
      );
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(buttons.find((b) => b.primary)?.value ?? true);
    });
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        finish(null);
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (win.querySelector('input:not([type=hidden]), textarea, select') || win.querySelector('.btn.primary'))?.focus();
  });
}

export const field = (label, attrs) =>
  h('label', { class: 'field' }, h('span', { text: label }), h('input', { class: 'inp', ...attrs }));

export async function alertBox(title, message) {
  await dialog({ title, body: h('p', { class: 'dlg-text', text: message }) });
}

export async function confirmBox(title, message, okLabel = 'OK') {
  const v = await dialog({
    title,
    body: h('p', { class: 'dlg-text', text: message }),
    buttons: [
      { label: 'Annulla', value: null },
      { label: okLabel, value: true, primary: true },
    ],
  });
  return v === true;
}

export async function promptBox(title, label, value = '') {
  const input = h('input', { class: 'inp', value, maxlength: '200' });
  const v = await dialog({
    title,
    body: h('label', { class: 'field' }, h('span', { text: label }), input),
    buttons: [
      { label: 'Annulla', value: null },
      { label: 'OK', value: 'ok', primary: true },
    ],
  });
  return v ? input.value.trim() : null;
}

let toastTimer;
export function toast(message) {
  let t = $('#toast');
  if (!t) document.body.append((t = h('div', { id: 'toast', role: 'status' })));
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---------------------------------------------------------------------------
// Sliders (horizontal for volume/balance/seek, vertical for the EQ)
// ---------------------------------------------------------------------------
/**
 * Turn `el` (containing a `.thumb`) into a slider. value is 0..1.
 * opts: {vertical, onInput(v), onChange(v), onStart(), onEnd(), step}
 * Returns {set(v), get(), dragging}.
 */
export function slider(el, opts = {}) {
  const thumb = el.querySelector('.thumb');
  let value = opts.value ?? 0;
  const api = { dragging: false };
  const layout = () => {
    const track = opts.vertical ? el.clientHeight - thumb.offsetHeight : el.clientWidth - thumb.offsetWidth;
    const pos = (opts.vertical ? 1 - value : value) * track;
    if (opts.vertical) thumb.style.top = `${pos}px`;
    else thumb.style.left = `${pos}px`;
    opts.paint?.(value);
  };
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    const scaleX = r.width / el.offsetWidth || 1;
    const scaleY = r.height / el.offsetHeight || 1;
    let v;
    if (opts.vertical) {
      const t = el.clientHeight - thumb.offsetHeight;
      v = 1 - ((e.clientY - r.top) / scaleY - thumb.offsetHeight / 2) / t;
    } else {
      const t = el.clientWidth - thumb.offsetWidth;
      v = ((e.clientX - r.left) / scaleX - thumb.offsetWidth / 2) / t;
    }
    v = Math.max(0, Math.min(1, v));
    if (opts.step) v = Math.round(v / opts.step) * opts.step;
    if (opts.snapCenter && Math.abs(v - 0.5) < 0.04) v = 0.5;
    return v;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.classList.contains('disabled')) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    api.dragging = true;
    el.classList.add('dragging');
    opts.onStart?.();
    value = fromEvent(e);
    layout();
    opts.onInput?.(value);
  });
  el.addEventListener('pointermove', (e) => {
    if (!api.dragging) return;
    value = fromEvent(e);
    layout();
    opts.onInput?.(value);
  });
  const end = () => {
    if (!api.dragging) return;
    api.dragging = false;
    el.classList.remove('dragging');
    opts.onChange?.(value);
    opts.onEnd?.();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    if (!opts.wheel) return;
    e.preventDefault();
    value = Math.max(0, Math.min(1, value + (e.deltaY < 0 ? opts.wheel : -opts.wheel)));
    layout();
    opts.onInput?.(value);
    opts.onChange?.(value);
  }, { passive: false });
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    value = Math.max(0, Math.min(1, value + d * (opts.step || 0.02)));
    layout();
    opts.onInput?.(value);
    opts.onChange?.(value);
  });
  api.set = (v) => {
    if (api.dragging) return;
    value = Math.max(0, Math.min(1, v));
    layout();
  };
  api.get = () => value;
  api.layout = layout;
  requestAnimationFrame(layout);
  return api;
}
