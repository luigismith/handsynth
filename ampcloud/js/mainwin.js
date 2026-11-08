// The main player window: LCD time + visualizer, scrolling title, bitrate
// info, volume / balance / seek sliders, transport, shuffle / repeat.
import { h, icon, slider, fmtTime, store, showMenu } from './ui.js?v=1.5.0';
import { BIG, SMALL, drawText, drawDigit, textWidth } from './font.js?v=1.5.0';

const GREEN = '#00e85c';
const GREEN_DIM = '#0b3a1e';
const LCD_OFF = '#0a1a10';
const VIS_COLORS = (() => {
  // 16 rows, bottom green → yellow → red at the top
  const out = [];
  for (let r = 0; r < 16; r++) {
    const t = r / 15;
    const hue = 120 - t * 120;
    out.push(`hsl(${hue} 100% ${45 + t * 5}%)`);
  }
  return out;
})();

function canvas(cls, w, hgt) {
  const c = h('canvas', { class: cls, width: w, height: hgt });
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  return c;
}

export function createMainWindow(app) {
  const lcd = canvas('lcd', 86, 44);
  const marquee = canvas('marquee', 155, 13);
  const info = canvas('info', 155, 12);
  const btn = (cls, label, onClick, content) =>
    h('button', { class: `b ${cls}`, title: label, 'aria-label': label, onclick: onClick }, content);

  const volEl = h('div', { class: 'hslider vol' }, h('div', { class: 'thumb' }));
  const balEl = h('div', { class: 'hslider bal' }, h('div', { class: 'thumb' }));
  const seekEl = h('div', { class: 'seek' }, h('div', { class: 'thumb' }));
  const eqBtn = btn('tgl eqbtn', 'Equalizzatore', () => app.wm.toggle('eq'), 'EQ');
  const plBtn = btn('tgl plbtn', 'Playlist', () => app.wm.toggle('pl'), 'PL');
  const shuffleBtn = btn('shuffle', 'Riproduzione casuale (S)', () => app.setShuffle(!app.shuffle), [
    h('i', { class: 'led' }),
    'SHUFFLE',
  ]);
  const repeatBtn = btn('repeat', 'Ripeti (R)', () => app.setRepeat(!app.repeat), [h('i', { class: 'led' }), 'REP']);

  const clutter = h(
    'div',
    { class: 'clutter' },
    btn('', 'Opzioni (menu)', (e) => app.showOptions(e.currentTarget), 'O'),
    btn('', 'Libreria condivisa', () => app.wm.toggle('lib'), 'L'),
    btn('', 'Info brano', () => app.showTrackInfo(), 'I'),
    btn('', 'Analizzatore: BPM, oscilloscopio, VU (Alt+A)', () => app.wm.toggle('an'), 'A'),
    btn('', 'Modalità visualizzatore', () => cycleVis(), 'V'),
  );

  const el = h(
    'section',
    { class: 'win main', id: 'w-main', 'aria-label': 'Lettore' },
    h(
      'div',
      { class: 'titlebar' },
      btn('tb-menu', 'Menu', (e) => app.showOptions(e.currentTarget)),
      h('span', { class: 'title-text', text: app.appName.toUpperCase() }),
      btn('tb-shade', 'Riduci', () => app.wm.toggleShade('main')),
      btn('tb-close', 'Esci', () => app.logout()),
    ),
    h('div', { class: 'shade-info' }),
    clutter,
    lcd,
    marquee,
    info,
    volEl,
    balEl,
    eqBtn,
    plBtn,
    seekEl,
    h(
      'div',
      { class: 'transport' },
      btn('t-prev', 'Precedente (Z)', () => app.prev(), icon('prev')),
      btn('t-play', 'Play (X)', () => app.play(), icon('play')),
      btn('t-pause', 'Pausa (C)', () => app.pause(), icon('pause')),
      btn('t-stop', 'Stop (V)', () => app.stop(), icon('stop')),
      btn('t-next', 'Successivo (B)', () => app.next(), icon('next')),
    ),
    btn('t-eject', 'Carica brani (L)', (e) => app.showUploadMenu(e.currentTarget), icon('eject')),
    shuffleBtn,
    repeatBtn,
    h('button', {
      class: 'logo',
      title: 'Informazioni',
      'aria-label': 'Informazioni',
      onclick: () => app.showAbout(),
    }),
  );

  // ---------- sliders ----------
  const vol = slider(volEl, {
    value: app.engine.volume,
    wheel: 0.05,
    onInput: (v) => {
      app.setVolume(v);
      app.flash(`VOLUME: ${Math.round(v * 100)}%`);
    },
    onEnd: () => app.flash(null),
    paint: (v) => volEl.style.setProperty('--hue', `${120 - v * 120}`),
  });
  const bal = slider(balEl, {
    value: (app.engine.balance + 1) / 2,
    snapCenter: true,
    onInput: (v) => {
      const b = v * 2 - 1;
      app.setBalance(b);
      const pct = Math.round(Math.abs(b) * 100);
      app.flash(pct === 0 ? 'BILANCIAMENTO: CENTRO' : `BILANCIAMENTO: ${pct}% ${b < 0 ? 'SINISTRA' : 'DESTRA'}`);
    },
    onEnd: () => app.flash(null),
    paint: (v) => balEl.style.setProperty('--amt', `${Math.abs(v * 2 - 1)}`),
  });
  const seek = slider(seekEl, {
    onInput: (v) => {
      const d = app.engine.duration;
      app.flash(`VAI A: ${fmtTime(v * d)}/${fmtTime(d)}`);
    },
    onChange: (v) => app.engine.seek(v * app.engine.duration),
    onEnd: () => app.flash(null),
  });

  // ---------- display state ----------
  let visMode = store.get('visMode', 0); // 0 spectrum, 1 scope, 2 off
  let remaining = store.get('timeRemaining', false);
  const cycleVis = () => {
    visMode = (visMode + 1) % 3;
    store.set('visMode', visMode);
    app.flash(['VISUALIZZATORE: SPETTRO', 'VISUALIZZATORE: OSCILLOSCOPIO', 'VISUALIZZATORE: SPENTO'][visMode], 1500);
  };
  lcd.addEventListener('click', (e) => {
    const r = lcd.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * 44;
    if (y > 24) cycleVis();
    else {
      remaining = !remaining;
      store.set('timeRemaining', remaining);
    }
  });
  marquee.addEventListener('dblclick', () => app.showTrackInfo());

  const bars = new Float32Array(19);
  const peaks = new Float32Array(19);
  const peakVel = new Float32Array(19);
  let scroll = 0;
  let lastScroll = 0;
  let blink = 0;
  const lctx = lcd.getContext('2d');
  const mctx = marquee.getContext('2d');
  const ictx = info.getContext('2d');

  function drawLcd(now) {
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, 86, 44);
    const eng = app.engine;
    const state = eng.playing ? 'play' : eng.loaded && eng.time > 0 ? 'pause' : 'stop';
    // status icon
    lctx.fillStyle = state === 'stop' ? '#b0b0b0' : GREEN;
    if (state === 'play') for (let i = 0; i < 4; i++) lctx.fillRect(4 + i, 6 + i, 1, 9 - 2 * i);
    else if (state === 'pause') lctx.fillRect(4, 6, 2, 9), lctx.fillRect(8, 6, 2, 9);
    else lctx.fillRect(4, 7, 7, 7);
    if (app.buffering && state === 'play') {
      lctx.fillStyle = (now / 250) % 2 < 1 ? GREEN : GREEN_DIM;
      lctx.fillRect(2, 17, 10, 1);
    }
    // time
    let t = eng.time;
    if (remaining && eng.duration) t = eng.duration - t;
    const hide = state === 'pause' && Math.floor(now / 600) % 2 === 1;
    const total = Math.floor(t);
    const mm = String(Math.min(99, Math.floor(total / 60))).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const show = eng.loaded || app.current;
    const digits = show ? `${mm}${ss}` : '    ';
    const x0 = 22;
    drawDigit(lctx, remaining && show ? '-' : ' ', x0 - 11, 3, hide ? LCD_OFF : GREEN, LCD_OFF);
    for (let i = 0; i < 4; i++) {
      drawDigit(lctx, hide ? ' ' : digits[i], x0 + i * 12 + (i > 1 ? 6 : 0), 3, GREEN, LCD_OFF);
    }
    lctx.fillStyle = hide || !show ? LCD_OFF : GREEN;
    lctx.fillRect(x0 + 25, 6, 2, 2);
    lctx.fillRect(x0 + 25, 11, 2, 2);

    // visualizer 76x16 at (5, 25)
    const vx = 5;
    const vy = 25;
    lctx.fillStyle = '#060a08';
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 76; x += 2) lctx.fillRect(vx + x, vy + y, 1, 1);
    if (visMode === 0) {
      const has = eng.spectrum(bars);
      for (let i = 0; i < 19; i++) {
        const v = has ? Math.min(1, bars[i] * 1.15) : 0;
        const hgt = Math.round(v * 16);
        for (let r = 0; r < hgt; r++) {
          lctx.fillStyle = VIS_COLORS[r];
          lctx.fillRect(vx + i * 4, vy + 15 - r, 3, 1);
        }
        if (hgt >= peaks[i]) (peaks[i] = hgt), (peakVel[i] = 0);
        else {
          peakVel[i] += 0.012;
          peaks[i] = Math.max(0, peaks[i] - peakVel[i]);
        }
        if (peaks[i] > 0.5) {
          lctx.fillStyle = '#d6d6d6';
          lctx.fillRect(vx + i * 4, vy + 15 - Math.round(peaks[i]), 3, 1);
        }
      }
    } else if (visMode === 1) {
      const wave = eng.waveform();
      lctx.fillStyle = GREEN;
      for (let x = 0; x < 76; x++) {
        const s = wave ? (wave[Math.floor((x / 76) * wave.length)] - 128) / 128 : 0;
        const y = Math.round(7.5 - s * 8);
        lctx.fillStyle = VIS_COLORS[Math.min(15, Math.abs(Math.round(s * 16)) + 2)];
        lctx.fillRect(vx + x, vy + Math.max(0, Math.min(15, y)), 1, 1);
      }
    }
  }

  function drawMarquee(now) {
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, 155, 13);
    const msg = app.flashText;
    if (msg) {
      drawText(mctx, msg, 2, 3, GREEN);
      return;
    }
    const text = app.marqueeText();
    const w = textWidth(text);
    if (w <= 151) {
      drawText(mctx, text, 2, 3, GREEN);
      return;
    }
    const loop = `${text}  ***  `;
    const lw = textWidth(loop);
    if (now - lastScroll > 40) {
      scroll = (scroll + 1) % lw;
      lastScroll = now;
    }
    drawText(mctx, loop, 2 - scroll, 3, GREEN);
    drawText(mctx, loop, 2 - scroll + lw, 3, GREEN);
  }

  function drawInfo() {
    ictx.fillStyle = 'rgba(0,0,0,0)';
    ictx.clearRect(0, 0, 155, 12);
    const t = app.current;
    const box = (x, w) => {
      ictx.fillStyle = '#000';
      ictx.fillRect(x, 0, w, 11);
    };
    box(0, 21);
    box(46, 15);
    const kbps = t?.bitrate ? String(Math.min(999, t.bitrate)) : '';
    const khz = t?.sampleRate ? String(Math.round(t.sampleRate / 1000)) : '';
    drawText(ictx, kbps.padStart(3, ' '), 2, 2, GREEN);
    drawText(ictx, khz.padStart(2, ' '), 48, 2, GREEN);
    drawText(ictx, 'KBPS', 23, 4, '#c8c8d8', SMALL);
    drawText(ictx, 'KHZ', 63, 4, '#c8c8d8', SMALL);
    const on = app.engine.loaded;
    const mono = on && t?.channels === 1;
    drawText(ictx, 'MONO', 98, 4, mono ? GREEN : '#3a3a4a', SMALL);
    drawText(ictx, 'STEREO', 119, 4, on && !mono ? GREEN : '#3a3a4a', SMALL);
  }

  const shadeInfo = el.querySelector('.shade-info');
  function frame(now) {
    if (!el.classList.contains('shade')) {
      drawLcd(now);
      drawMarquee(now);
      if (now - blink > 250) {
        drawInfo();
        blink = now;
      }
    } else {
      shadeInfo.textContent = `${fmtTime(app.engine.time)}  ${app.current ? `${app.current.artist} - ${app.current.title}` : ''}`;
    }
    const d = app.engine.duration;
    seekEl.classList.toggle('disabled', !d);
    if (d) seek.set(app.engine.time / d);
    else seek.set(0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  app.on('state', () => {
    shuffleBtn.classList.toggle('on', app.shuffle);
    repeatBtn.classList.toggle('on', app.repeat);
    eqBtn.classList.toggle('on', app.wm.isVisible('eq'));
    plBtn.classList.toggle('on', app.wm.isVisible('pl'));
    vol.set(app.engine.volume);
    bal.set((app.engine.balance + 1) / 2);
  });

  // right click on the main window = options menu, like the classic player
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    app.showOptions({ x: e.clientX, y: e.clientY });
  });

  return el;
}

export { showMenu };
