// Analyzer window: oscilloscope (L/R traces or XY goniometer), stereo LED
// VU meter with peak hold, and a BPM display with beat LED, TAP, ×2 and ÷2.
import { h, store, toast } from './ui.js?v=1.5.0';
import { BIG, SMALL, drawText, drawDigit } from './font.js?v=1.5.0';

const GREEN = '#00e85c';
const DIM = '#0b3a1e';
const LABEL = '#c8c8d8';
const SCOPE_W = 160;
const SCOPE_H = 58;
const VU_W = 253;
const VU_H = 26;

function canvas(cls, w, hgt) {
  const c = h('canvas', { class: cls, width: w, height: hgt });
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  return c;
}

const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);

export function createAnalyzerWindow(app) {
  const scope = canvas('an-scope', SCOPE_W, SCOPE_H);
  const bpmCv = canvas('an-bpm', 89, 40);
  const vu = canvas('an-vu', VU_W, VU_H);
  const btn = (cls, label, title, onClick) => h('button', { class: `b an-btn ${cls}`, text: label, title, onclick: onClick });
  const notice = h('div', { class: 'an-notice', text: 'Oscilloscopio e VU non disponibili su questo dispositivo' });

  const el = h(
    'section',
    { class: 'win anwin', id: 'w-an', 'aria-label': 'Analizzatore' },
    h(
      'div',
      { class: 'titlebar' },
      h('span', { class: 'title-text', text: `${app.appName.toUpperCase()} ANALIZZATORE` }),
      h('button', { class: 'b tb-shade', title: 'Riduci', onclick: () => app.wm.toggleShade('an') }),
      h('button', { class: 'b tb-close', title: 'Chiudi', onclick: () => app.wm.toggle('an', false) }),
    ),
    scope,
    bpmCv,
    btn('an-tap', 'TAP', 'Batti a tempo (almeno 4 volte) per impostare i BPM a mano', () => tap()),
    btn('an-x2', '×2', 'Raddoppia i BPM', () => scaleBpm(2)),
    btn('an-d2', '÷2', 'Dimezza i BPM', () => scaleBpm(0.5)),
    vu,
    notice,
  );

  // ---------- oscilloscope ----------
  let xy = store.get('scopeXY', false);
  let gain = 1;
  scope.title = 'Clic: tracce L/R oppure XY (immagine stereo)';
  scope.addEventListener('click', () => {
    xy = !xy;
    store.set('scopeXY', xy);
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, SCOPE_W, SCOPE_H);
  });
  const sctx = scope.getContext('2d');
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, SCOPE_W, SCOPE_H);

  function drawGrid() {
    sctx.fillStyle = '#0f2a1a';
    for (let x = 0; x < SCOPE_W; x += 20) for (let y = 1; y < SCOPE_H; y += 2) sctx.fillRect(x, y, 1, 1);
    for (let y = 1; y < SCOPE_H; y += 14) for (let x = 0; x < SCOPE_W; x += 2) sctx.fillRect(x, y, 1, 1);
  }

  function drawScope(data, mono) {
    // phosphor afterglow: fade the previous frame instead of clearing it
    sctx.fillStyle = 'rgba(0,0,0,0.35)';
    sctx.fillRect(0, 0, SCOPE_W, SCOPE_H);
    drawGrid();
    if (!data) return;
    const { l } = data;
    const r = mono ? data.l : data.r;
    const mid = SCOPE_H / 2;
    // auto-scale: quiet passages still fill the screen, loud ones don't clip
    let pk = 0;
    for (let i = 0; i < l.length; i += 4) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
    const target = 0.9 / Math.max(0.08, pk);
    gain += (target - gain) * (target < gain ? 0.5 : 0.05);
    if (xy) {
      // goniometer: mono = vertical line, wide stereo = round cloud
      sctx.fillStyle = 'rgba(80,255,150,0.75)';
      const k = SCOPE_H * 0.45 * gain;
      for (let i = 0; i < l.length; i += 2) {
        const x = SCOPE_W / 2 + (r[i] - l[i]) * k;
        const y = mid - (l[i] + r[i]) * k * 0.7;
        sctx.fillRect(x | 0, y | 0, 1, 1);
      }
      drawText(sctx, 'XY', 2, 2, '#3b6', SMALL);
      return;
    }
    // trigger on a rising zero crossing so the trace stands still
    let start = 0;
    for (let i = 1; i < 1024; i++) {
      if (l[i - 1] < 0 && l[i] >= 0) {
        start = i;
        break;
      }
    }
    const span = 768;
    const trace = (buf, color, dy) => {
      sctx.strokeStyle = color;
      sctx.lineWidth = 1;
      sctx.beginPath();
      for (let x = 0; x < SCOPE_W; x++) {
        const v = buf[start + Math.floor((x / SCOPE_W) * span)] || 0;
        const y = Math.max(1, Math.min(SCOPE_H - 2, mid + dy - v * gain * (SCOPE_H * 0.45)));
        if (x) sctx.lineTo(x + 0.5, y + 0.5);
        else sctx.moveTo(0.5, y + 0.5);
      }
      sctx.stroke();
    };
    if (!mono) trace(r, 'rgba(60,200,255,0.8)', 0);
    trace(l, 'rgba(80,255,150,0.95)', 0);
    drawText(sctx, mono ? 'MONO' : 'L', 2, 2, '#3b6', SMALL);
    if (!mono) drawText(sctx, 'R', 2, SCOPE_H - 7, '#3ac', SMALL);
  }

  // ---------- VU meter ----------
  const vctx = vu.getContext('2d');
  const BAR_X = 9;
  const SEG = 4; // 3 px LED + 1 px gap
  const SEGS = 52;
  const DB_MIN = -45;
  const DB_MAX = 3;
  const segOf = (db) => Math.max(0, Math.min(SEGS, Math.round(((db - DB_MIN) / (DB_MAX - DB_MIN)) * SEGS)));
  const segColor = (i, lit) => {
    const db = DB_MIN + ((i + 0.5) / SEGS) * (DB_MAX - DB_MIN);
    if (db > -3) return lit ? '#ff3b3b' : '#3a1414';
    if (db > -12) return lit ? '#ffd23b' : '#3a3214';
    return lit ? GREEN : DIM;
  };
  const meter = [
    { level: DB_MIN, peak: DB_MIN, peakAt: 0, max: DB_MIN },
    { level: DB_MIN, peak: DB_MIN, peakAt: 0, max: DB_MIN },
  ];
  const scaleMarks = [-40, -30, -20, -10, -6, -3, 0];

  function drawVu(data, mono, now) {
    vctx.fillStyle = '#000';
    vctx.fillRect(0, 0, VU_W, VU_H);
    const bufs = data ? [data.l, mono ? data.l : data.r] : [null, null];
    bufs.forEach((buf, ch) => {
      const m = meter[ch];
      let rmsDb = DB_MIN;
      let pkDb = DB_MIN;
      if (buf && app.engine.playing) {
        let sum = 0;
        let pk = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
          const a = v < 0 ? -v : v;
          if (a > pk) pk = a;
        }
        // +3 dB so a full-scale sine reads 0 dB, like a VU calibrated to peak
        rmsDb = toDb(Math.sqrt(sum / buf.length)) + 3;
        pkDb = toDb(pk);
      }
      // VU ballistics: quick rise, slow fall
      m.level += (rmsDb - m.level) * (rmsDb > m.level ? 0.45 : 0.08);
      if (pkDb >= m.peak) (m.peak = pkDb), (m.peakAt = now);
      else if (now - m.peakAt > 1200) m.peak = Math.max(DB_MIN, m.peak - 0.6);
      if (pkDb > m.max) m.max = pkDb;
      const y = 2 + ch * 9;
      drawText(vctx, ch ? 'R' : 'L', 2, y + 1, LABEL, SMALL);
      const lit = segOf(m.level);
      for (let i = 0; i < SEGS; i++) {
        vctx.fillStyle = segColor(i, i < lit);
        vctx.fillRect(BAR_X + i * SEG, y, SEG - 1, 7);
      }
      const p = segOf(m.peak) - 1;
      if (p >= 0 && m.peak > DB_MIN + 1) {
        vctx.fillStyle = '#ffffff';
        vctx.fillRect(BAR_X + p * SEG, y, SEG - 1, 7);
      }
      // numeric peak hold (dBFS)
      const txt = m.peak <= DB_MIN + 1 ? '-INF' : (m.peak > 0 ? '+' : '') + m.peak.toFixed(1);
      drawText(vctx, txt, VU_W - 30, y + 1, m.peak > -0.5 ? '#ff6b6b' : GREEN, SMALL);
    });
    for (const db of scaleMarks) {
      const x = BAR_X + segOf(db) * SEG - 2;
      const t = String(db);
      drawText(vctx, t, Math.min(x - (t.length * 4) / 2 + 2, BAR_X + SEGS * SEG - t.length * 4), 20, '#8a8aa8', SMALL);
    }
  }
  vu.title = 'Clic: azzera i picchi';
  vu.addEventListener('click', () => meter.forEach((m) => ((m.peak = DB_MIN), (m.max = DB_MIN))));

  // ---------- BPM ----------
  const bctx = bpmCv.getContext('2d');
  function drawBpm(now) {
    bctx.fillStyle = '#000';
    bctx.fillRect(0, 0, 89, 40);
    const t = app.current;
    const st = app.bpmStatus(t);
    const bpm = t?.bpm;
    const ON = GREEN;
    const OFF = '#0a1a10';
    if (bpm) {
      const whole = String(Math.floor(bpm)).padStart(3, ' ');
      for (let i = 0; i < 3; i++) drawDigit(bctx, whole[i], 4 + i * 12, 4, ON, OFF);
      drawText(bctx, `.${Math.round((bpm % 1) * 10) % 10}`, 40, 10, ON, BIG);
    } else {
      for (let i = 0; i < 3; i++) drawDigit(bctx, st === 'analyzing' && Math.floor(now / 300) % 3 === i ? '-' : ' ', 4 + i * 12, 4, ON, OFF);
    }
    drawText(bctx, 'BPM', 4, 22, LABEL, SMALL);
    // beat LED + position in the bar (4/4)
    let lit = false;
    let beatInBar = -1;
    if (bpm && app.engine.playing) {
      const beat = 60 / bpm;
      const pos = (app.engine.time - (t.beatOffset || 0)) / beat;
      lit = pos - Math.floor(pos) < 0.18;
      beatInBar = ((Math.floor(pos) % 4) + 4) % 4;
    }
    bctx.fillStyle = lit ? '#ff5050' : '#3a1414';
    bctx.fillRect(71, 5, 12, 10);
    if (lit) {
      bctx.fillStyle = 'rgba(255,80,80,0.35)';
      bctx.fillRect(69, 3, 16, 14);
      bctx.fillStyle = '#ff7070';
      bctx.fillRect(71, 5, 12, 10);
    }
    for (let i = 0; i < 4; i++) {
      bctx.fillStyle = i === beatInBar ? GREEN : DIM;
      bctx.fillRect(22 + i * 6, 23, 4, 4);
    }
    const label =
      st === 'analyzing' ? 'ANALISI...' : st === 'manual' ? 'MANUALE' : st === 'auto' ? 'AUTO' : st === 'failed' ? 'NON TROVATI' : t ? 'TAP PER IMPOSTARE' : '';
    drawText(bctx, label, 4, 32, '#8a8aa8', SMALL);
    if (taps.length && now - taps[taps.length - 1] < 2000) drawText(bctx, `TAP ${taps.length}`, 60, 22, '#ffd23b', SMALL);
  }

  // TAP tempo: tap on the beat, 4+ taps, gaps under 2 s
  let taps = [];
  function tap() {
    const t = app.current;
    if (!t) return toast('Fai partire un brano, poi batti TAP a tempo');
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length < 4) return;
    const iv = [];
    for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
    iv.sort((a, b) => a - b);
    const median = iv[Math.floor(iv.length / 2)];
    const bpm = Math.round((60000 / median) * 10) / 10;
    if (bpm < 30 || bpm > 300) return;
    const beat = 60 / bpm;
    const offset = ((app.engine.time % beat) + beat) % beat;
    app.setTrackBpm(t, bpm, offset, 'manual');
  }

  function scaleBpm(k) {
    const t = app.current;
    if (!t?.bpm) return toast('Ancora nessun BPM per questo brano');
    const next = Math.round(t.bpm * k * 10) / 10;
    if (next < 30 || next > 300) return;
    app.setTrackBpm(t, next, t.beatOffset || 0, 'manual');
  }

  // ---------- loop ----------
  const hasGraph = () => app.engine.graphOk;
  function frame(now) {
    if (!el.hidden && !el.classList.contains('shade')) {
      const data = app.engine.playing ? app.engine.scope() : null;
      const mono = app.current?.channels === 1;
      el.classList.toggle('nograph', !hasGraph());
      if (hasGraph()) {
        drawScope(data, mono);
        drawVu(data, mono, now);
      }
      drawBpm(now);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return el;
}
