// Owner: ux-curator
//
// Translucent CRT-style terminal HUD pinned to the bottom of the screen.
// Toggles with the backtick (`) key. Subscribes to MusicBrain note/drum
// events and HandTracker gesture state, and prints a colored compact line
// per event into a circular buffer (cap 60). Status bar at the top of the
// strip shows live intensity / mood / bpm / context state at 4 Hz.
//
// We deliberately re-implement a tiny CSS scanline effect locally rather
// than importing from src/visual — the visualizer's overlay is canvas-based
// and lives inside its own draw loop. Here we just want a static stripe.

import type {
  AudioEngine,
  ChordEvent,
  GestureState,
  HandTracker,
  MusicBrain,
  MusicBrainEvents,
  NoteEvent,
} from '@contracts/contracts';
import { injectStyles } from './styles';

export interface TerminalDeps {
  music: MusicBrain;
  audio: AudioEngine;
  hands: HandTracker;
  /** Returns { intensity, mood, bpm } for the status bar. */
  getMapperState: () => { intensity: number; mood: string; bpm: number };
}

// 't' for terminal — letter keys stay reachable on every international layout
// (backtick `` ` `` was the original choice but moves position on IT/FR/DE
// keyboards or requires a dead-key combo).
const TOGGLE_KEY = 't';
const BUFFER_CAP = 60;
const GESTURE_THROTTLE_MS = 250;

type LineKind =
  | 'lead'
  | 'bass'
  | 'chord'
  | 'kick'
  | 'hat'
  | 'perc'
  | 'gesture'
  | 'beat'
  | 'info';

interface Line {
  el: HTMLDivElement;
  fadeTimer: number | null;
}

function nowStr(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function clampNum(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export class TerminalImpl {
  private mounted = false;
  private deps: TerminalDeps | null = null;
  private root: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private statusEls: { intensity: HTMLElement; mood: HTMLElement; bpm: HTMLElement; ctx: HTMLElement } | null = null;
  private lines: Line[] = [];
  private musicSub: MusicBrainEvents | null = null;
  private gestureCb: ((s: GestureState) => void) | null = null;
  private lastGestureLineMs = 0;
  private statTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  mount(parent: HTMLElement, deps: TerminalDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;
    injectStyles();

    // HMR safety: remove any orphan terminal roots left by a prior module
    // version. Without this an HMR reload can leave the previous tree's
    // DOM (and its accumulated 100+ lines) sitting in the parent.
    const stale = parent.querySelectorAll('.hs-terminal');
    for (const node of Array.from(stale)) {
      try {
        node.remove();
      } catch {
        // ignore detached nodes
      }
    }

    const root = document.createElement('div');
    root.className = 'hs-terminal';
    root.hidden = true;
    root.setAttribute('role', 'log');
    root.setAttribute('aria-label', 'Terminal HUD');
    root.setAttribute('aria-live', 'polite');

    const status = document.createElement('div');
    status.className = 'hs-term-status';
    const rec = document.createElement('span');
    rec.className = 'hs-term-rec';
    rec.setAttribute('aria-hidden', 'true');
    status.appendChild(rec);
    const recLbl = document.createElement('span');
    recLbl.textContent = 'REC';
    recLbl.style.color = 'var(--hs-orange)';
    recLbl.style.letterSpacing = '1.5px';
    status.appendChild(recLbl);

    const intStat = this.makeStat('INT', '—', 'hs-term-stat-int');
    const moodStat = this.makeStat('MOOD', '—', 'hs-term-stat-mood');
    const bpmStat = this.makeStat('BPM', '—', 'hs-term-stat-bpm');
    const ctxStat = this.makeStat('CTX', '—', 'hs-term-stat-ctx');
    status.append(intStat.wrap, moodStat.wrap, bpmStat.wrap, ctxStat.wrap);
    root.appendChild(status);

    const body = document.createElement('div');
    body.className = 'hs-term-body';
    root.appendChild(body);

    parent.appendChild(root);
    this.root = root;
    this.bodyEl = body;
    this.statusEls = {
      intensity: intStat.value,
      mood: moodStat.value,
      bpm: bpmStat.value,
      ctx: ctxStat.value,
    };

    // Subscribe to music events.
    const sub: MusicBrainEvents = {
      onLead: (e: NoteEvent) =>
        this.appendLine('lead', `lead  ${e.pitch.padEnd(4)} v=${e.velocity.toFixed(2)}`),
      onBass: (e: NoteEvent) =>
        this.appendLine('bass', `bass  ${e.pitch.padEnd(4)} v=${e.velocity.toFixed(2)}`),
      onChord: (e: ChordEvent) =>
        this.appendLine('chord', `chord [${e.notes.join(' ')}]`),
      onKick: () => this.appendLine('kick', 'kick'),
      onHat: () => this.appendLine('hat', 'hat'),
      onPerc: () => this.appendLine('perc', 'perc'),
      onBeat: (b: number) => this.appendLine('beat', `beat ${b}`),
    };
    deps.music.on(sub);
    this.musicSub = sub;

    // Subscribe to gestures (throttled).
    this.gestureCb = (s) => this.handleGesture(s);
    deps.hands.on('gesture:update', this.gestureCb);

    // Stat refresh every 250 ms.
    this.statTimer = window.setInterval(() => this.refreshStatus(), 250);

    // Toggle key.
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === TOGGLE_KEY && !this.isTypingTarget(e.target)) {
        this.setVisible(this.root?.hidden ?? false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    this.appendLine(
      'info',
      'handsynth terminal ready · t toggle · esc mute · h help',
    );
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.deps && this.musicSub) this.deps.music.off(this.musicSub);
    if (this.deps && this.gestureCb) this.deps.hands.off('gesture:update', this.gestureCb);
    this.musicSub = null;
    this.gestureCb = null;
    if (this.statTimer !== null) {
      clearInterval(this.statTimer);
      this.statTimer = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    for (const l of this.lines) {
      if (l.fadeTimer !== null) clearTimeout(l.fadeTimer);
    }
    this.lines = [];
    if (this.root) this.root.remove();
    this.root = null;
    this.bodyEl = null;
    this.statusEls = null;
    this.deps = null;
  }

  setVisible(visible: boolean): void {
    if (!this.root) return;
    this.root.hidden = !visible;
    if (visible) {
      // Auto-scroll to bottom on open.
      if (this.bodyEl) this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  // ------------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------------

  private makeStat(label: string, initial: string, modifier?: string): {
    wrap: HTMLElement;
    value: HTMLElement;
  } {
    const wrap = document.createElement('span');
    wrap.className = modifier ? `hs-term-stat ${modifier}` : 'hs-term-stat';
    const lbl = document.createElement('span');
    lbl.className = 'hs-term-stat-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.textContent = initial;
    wrap.append(lbl, val);
    return { wrap, value: val };
  }

  private appendLine(kind: LineKind, text: string): void {
    if (!this.bodyEl) return;
    const div = document.createElement('div');
    div.className = 'hs-term-line hs-fresh';
    div.dataset.kind = kind;
    const prefix = document.createElement('span');
    prefix.className = 'hs-term-prefix';
    prefix.textContent = nowStr();
    div.append(prefix, document.createTextNode(text));
    this.bodyEl.appendChild(div);

    const line: Line = { el: div, fadeTimer: null };
    // Fade after 1.5s.
    line.fadeTimer = window.setTimeout(() => {
      div.classList.remove('hs-fresh');
      div.classList.add('hs-fade');
    }, 1500);
    this.lines.push(line);

    // Trim to BUFFER_CAP via circular buffer behavior. Two passes:
    //   1. Trim our own tracked list — removes lines we know about.
    //   2. Belt-and-suspenders: if the live DOM has MORE lines than the
    //      cap (e.g. HMR re-mount left stale nodes from a previous
    //      instance), prune the leading nodes directly. Without this
    //      backstop, an old instance's lines stick around forever.
    while (this.lines.length > BUFFER_CAP) {
      const old = this.lines.shift();
      if (!old) break;
      if (old.fadeTimer !== null) clearTimeout(old.fadeTimer);
      old.el.remove();
    }
    const liveCount = this.bodyEl.childElementCount;
    if (liveCount > BUFFER_CAP) {
      const excess = liveCount - BUFFER_CAP;
      for (let i = 0; i < excess; i += 1) {
        const first = this.bodyEl.firstElementChild;
        if (!first) break;
        first.remove();
      }
    }

    // Auto-scroll if visible.
    if (this.root && !this.root.hidden) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  private handleGesture(s: GestureState): void {
    const now = performance.now();
    if (now - this.lastGestureLineMs < GESTURE_THROTTLE_MS) return;
    this.lastGestureLineMs = now;
    const handsCount = s.hands.length;
    const dist = clampNum(s.handsDistance, 0, 1).toFixed(2);
    const mh = clampNum(s.meanHeight, 0, 1).toFixed(2);
    const ro = clampNum(s.rightOpenness, 0, 1).toFixed(2);
    const lo = clampNum(s.leftOpenness, 0, 1).toFixed(2);
    const fingers = s.fingerCount;
    const text = `gest hands=${handsCount} dist=${dist} mh=${mh} R/L=${ro}/${lo} fc=${fingers}`;
    this.appendLine('gesture', text);
  }

  private refreshStatus(): void {
    if (!this.statusEls || !this.deps) return;
    const s = this.deps.getMapperState();
    this.statusEls.intensity.textContent = s.intensity.toFixed(2);
    this.statusEls.mood.textContent = s.mood;
    this.statusEls.bpm.textContent = String(Math.round(s.bpm));
    let ctxState = '?';
    try {
      const an = this.deps.audio.getAnalyser();
      // AnalyserNode has a `context` ref; use it to surface running/suspended.
      const ctx = (an as unknown as { context?: AudioContext }).context;
      ctxState = ctx?.state ?? '?';
    } catch {
      ctxState = 'n/a';
    }
    this.statusEls.ctx.textContent = ctxState;
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }
}
