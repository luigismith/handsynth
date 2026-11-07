// 10-band graphic equalizer window with preamp, ON/AUTO and presets.
import { h, slider, showMenu, store, promptBox, toast } from './ui.js';
import { SMALL, drawText } from './font.js';
import { EQ_LABELS } from './engine.js';

// Original preset curves (dB, -12..+12), 10 bands 60 Hz → 16 kHz.
export const PRESETS = {
  Piatto: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bassi potenti': [8, 7, 5, 2, 0, -1, -1, 0, 0, 0],
  'Alti brillanti': [-2, -1, 0, 0, 1, 3, 5, 7, 8, 8],
  Rock: [6, 4, -2, -4, -1, 3, 6, 7, 7, 7],
  Pop: [-1, 3, 5, 6, 4, 0, -1, -1, -1, -1],
  Elettronica: [7, 6, 2, 0, -2, 1, 2, 5, 6, 6],
  'Hip hop': [8, 7, 3, 0, -1, -1, 1, 2, 3, 3],
  Jazz: [3, 2, 0, 2, -1, -1, 0, 2, 3, 3],
  Classica: [0, 0, 0, 0, 0, 0, -4, -4, -4, -6],
  Voce: [-3, -2, 0, 3, 5, 5, 3, 1, 0, -2],
  Radio: [-8, -6, -2, 3, 6, 6, 3, -2, -6, -8],
  Cuffie: [4, 6, 3, -2, -1, 1, 4, 6, 7, 8],
  'Notte (piano)': [-4, -2, 0, 1, 2, 2, 1, 0, -2, -4],
};

const dbToV = (db) => (db + 12) / 24;
const vToDb = (v) => Math.round((v * 24 - 12) * 2) / 2;

export function createEqWindow(app) {
  const graph = h('canvas', { class: 'eq-graph', width: 113, height: 19 });
  const labels = h('canvas', { class: 'eq-labels', width: 275, height: 8 });
  const dbl = h('canvas', { class: 'eq-db', width: 30, height: 63 });
  const onBtn = h('button', { class: 'b eq-on', title: 'Attiva equalizzatore', onclick: () => setOn(!eq.on) }, [
    h('i', { class: 'led' }),
    'ON',
  ]);
  const autoBtn = h(
    'button',
    { class: 'b eq-auto', title: 'AUTO: ricorda le impostazioni EQ per ogni brano', onclick: () => setAuto(!auto) },
    [h('i', { class: 'led' }), 'AUTO'],
  );
  const presetBtn = h('button', { class: 'b eq-presets', title: 'Preset', onclick: (e) => presetsMenu(e.currentTarget) }, 'PRESET');

  let eq = store.get('eq', { on: false, preamp: 0, bands: Array(10).fill(0) });
  let auto = store.get('eqAuto', false);
  app.engine.setEq(eq);

  const pre = h('div', { class: 'vslider preamp', title: 'Preamplificazione' }, h('div', { class: 'thumb' }));
  const bandEls = EQ_LABELS.map((l, i) =>
    h('div', { class: 'vslider band', title: `${l} Hz`, style: { left: `${78 + i * 18}px` } }, h('div', { class: 'thumb' })),
  );

  const el = h(
    'section',
    { class: 'win eqwin', id: 'w-eq', 'aria-label': 'Equalizzatore' },
    h(
      'div',
      { class: 'titlebar' },
      h('span', { class: 'title-text', text: `${app.appName.toUpperCase()} EQUALIZZATORE` }),
      h('button', { class: 'b tb-shade', title: 'Riduci', onclick: () => app.wm.toggleShade('eq') }),
      h('button', { class: 'b tb-close', title: 'Chiudi', onclick: () => app.wm.toggle('eq', false) }),
    ),
    onBtn,
    autoBtn,
    graph,
    presetBtn,
    pre,
    dbl,
    ...bandEls,
    labels,
  );

  const paintThumb = (sliderEl) => (v) => sliderEl.style.setProperty('--hue', `${120 - v * 120}`);
  const preS = slider(pre, {
    vertical: true,
    value: dbToV(eq.preamp),
    snapCenter: true,
    wheel: 1 / 24,
    paint: paintThumb(pre),
    onInput: (v) => {
      eq.preamp = vToDb(v);
      apply(`PREAMP: ${eq.preamp > 0 ? '+' : ''}${eq.preamp} DB`);
    },
    onEnd: () => app.flash(null),
  });
  const bandS = bandEls.map((bEl, i) =>
    slider(bEl, {
      vertical: true,
      value: dbToV(eq.bands[i]),
      snapCenter: true,
      wheel: 1 / 24,
      paint: paintThumb(bEl),
      onInput: (v) => {
        eq.bands[i] = vToDb(v);
        apply(`EQ ${EQ_LABELS[i]}HZ: ${eq.bands[i] > 0 ? '+' : ''}${eq.bands[i]} DB`);
      },
      onEnd: () => app.flash(null),
    }),
  );

  function apply(msg) {
    if (msg) app.flash(msg);
    app.engine.setEq(eq);
    store.set('eq', eq);
    if (auto && app.current) {
      const map = store.get('eqPerTrack', {});
      map[app.current.id] = { preamp: eq.preamp, bands: eq.bands };
      store.set('eqPerTrack', map);
    }
    render();
  }

  function setOn(on) {
    eq.on = on;
    apply();
    toast(on ? 'Equalizzatore attivo' : 'Equalizzatore spento');
  }

  function setAuto(on) {
    auto = on;
    store.set('eqAuto', on);
    render();
  }

  function load(values, preamp = 0) {
    eq.bands = [...values];
    eq.preamp = preamp;
    eq.on = true;
    preS.set(dbToV(eq.preamp));
    bandS.forEach((s, i) => s.set(dbToV(eq.bands[i])));
    apply();
  }

  function presetsMenu(anchor) {
    const custom = store.get('eqCustom', {});
    showMenu(
      [
        { label: 'Carica', items: Object.entries(PRESETS).map(([name, v]) => ({ label: name, action: () => load(v) })) },
        {
          label: 'I miei preset',
          items: Object.entries(custom).map(([name, p]) => ({ label: name, action: () => load(p.bands, p.preamp) })),
        },
        '-',
        {
          label: 'Salva come preset…',
          action: async () => {
            const name = await promptBox('Salva preset', 'Nome del preset');
            if (!name) return;
            custom[name] = { bands: eq.bands, preamp: eq.preamp };
            store.set('eqCustom', custom);
            toast(`Preset “${name}” salvato`);
          },
        },
        {
          label: 'Elimina preset',
          items: Object.keys(custom).map((name) => ({
            label: name,
            action: () => {
              delete custom[name];
              store.set('eqCustom', custom);
            },
          })),
        },
        '-',
        { label: 'Azzera (0 dB)', action: () => load(PRESETS.Piatto) },
      ],
      anchor,
    );
  }

  const gctx = graph.getContext('2d');
  const lctx = labels.getContext('2d');
  const dctx = dbl.getContext('2d');

  function render() {
    onBtn.classList.toggle('on', eq.on);
    autoBtn.classList.toggle('on', auto);
    // response curve preview
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, 113, 19);
    gctx.fillStyle = '#1b2a22';
    gctx.fillRect(0, 9, 113, 1);
    const pts = eq.bands.map((db, i) => ({ x: 2 + (i * 108) / 9, y: 9 - (db / 12) * 8 }));
    for (let x = 0; x < 113; x++) {
      // Catmull-Rom between the band points
      const fx = Math.max(0, Math.min(8.999, ((x - 2) / 108) * 9));
      const i = Math.floor(fx);
      const t = fx - i;
      const p0 = pts[Math.max(0, i - 1)].y;
      const p1 = pts[i].y;
      const p2 = pts[i + 1].y;
      const p3 = pts[Math.min(9, i + 2)].y;
      const y =
        0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      const yy = Math.round(Math.max(0, Math.min(18, y)));
      const hue = 120 - ((18 - yy) / 18) * 120;
      gctx.fillStyle = eq.on ? `hsl(${hue} 100% 50%)` : '#4a4a5a';
      gctx.fillRect(x, yy, 1, 1);
    }
    // preamp line
    gctx.fillStyle = eq.on ? '#c8c8d8' : '#3a3a48';
    gctx.fillRect(0, Math.round(9 - (eq.preamp / 12) * 8), 2, 1);

    lctx.clearRect(0, 0, 275, 8);
    drawText(lctx, 'PREAMP', 14, 1, '#c8c8d8', SMALL);
    EQ_LABELS.forEach((l, i) => {
      const cx = 78 + i * 18 + 7;
      drawText(lctx, l, Math.round(cx - (l.length * 4 - 1) / 2), 1, '#c8c8d8', SMALL);
    });
    dctx.clearRect(0, 0, 30, 63);
    drawText(dctx, '+12DB', 4, 1, '#c8c8d8', SMALL);
    drawText(dctx, '+0DB', 8, 29, '#c8c8d8', SMALL);
    drawText(dctx, '-12DB', 4, 57, '#c8c8d8', SMALL);
  }

  // AUTO: when a new track starts, recall its EQ
  app.on('track', () => {
    if (!auto || !app.current) return;
    const saved = store.get('eqPerTrack', {})[app.current.id];
    if (saved) {
      load(saved.bands, saved.preamp);
      app.flash('EQ AUTO: IMPOSTAZIONI DEL BRANO', 1500);
    }
  });

  app.engine.addEventListener('nograph', () => el.classList.add('nograph'));
  render();
  return el;
}
