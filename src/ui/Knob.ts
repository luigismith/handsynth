// Owner: ux-curator
//
// Rotary knob — the visual workhorse of the SettingsPanel. A circular div
// with a tick-mark indicator. 240° travel (7 o'clock → 5 o'clock).
//
//  • Vertical drag changes value (up = increase).
//  • Shift / horizontal drag = fine mode (10× slower).
//  • Double-click = reset to default.
//  • ArrowUp/Down = step ±1, PageUp/Down = ±10 steps, Home/End = min/max.
//  • Optional log scale (used for filter cutoff).
//
// A11y: role="slider" with aria-valuemin/max/now and a label. The container
// is focusable.

export interface KnobOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  log?: boolean;
  /** Optional unit suffix shown after the value (e.g. "Hz", "%"). */
  unit?: string;
  /** Number of fixed digits to show; defaults derived from step. */
  digits?: number;
  onChange: (v: number) => void;
}

/** Travel range in degrees (visual). */
const TRAVEL_DEG = 240;
/** Pixel distance to traverse the entire range with a single drag. */
const DRAG_RANGE_PX = 200;

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function snap(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

function formatVal(v: number, digits: number, unit: string | undefined): string {
  const s = digits === 0 ? Math.round(v).toString() : v.toFixed(digits);
  return unit ? `${s} ${unit}` : s;
}

function deriveDigits(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

export class Knob {
  el: HTMLDivElement;

  private value: number;
  private min: number;
  private max: number;
  private step: number;
  private defaultValue: number;
  private log: boolean;
  private digits: number;
  private unit: string | undefined;
  private onChange: (v: number) => void;

  private indicator: HTMLDivElement;
  private valueEl: HTMLDivElement;
  private dial: HTMLDivElement;
  private labelEl: HTMLDivElement;

  // Drag state.
  private dragStartY = 0;
  private dragStartX = 0;
  private dragStartVal = 0;
  private dragging = false;
  private pointerId: number | null = null;
  private boundMove: ((e: PointerEvent) => void) | null = null;
  private boundUp: ((e: PointerEvent) => void) | null = null;

  constructor(opts: KnobOpts) {
    this.min = opts.min;
    this.max = opts.max;
    this.step = opts.step;
    this.defaultValue = opts.defaultValue;
    this.log = opts.log === true;
    this.unit = opts.unit;
    this.digits = opts.digits ?? deriveDigits(opts.step);
    this.onChange = opts.onChange;
    this.value = clamp(opts.value, this.min, this.max);

    const root = document.createElement('div');
    root.className = 'hs-knob';

    const dial = document.createElement('div');
    dial.className = 'hs-knob-dial';
    dial.tabIndex = 0;
    dial.setAttribute('role', 'slider');
    dial.setAttribute('aria-label', opts.label);
    dial.setAttribute('aria-valuemin', String(this.min));
    dial.setAttribute('aria-valuemax', String(this.max));
    dial.setAttribute('aria-valuenow', String(this.value));

    const indicator = document.createElement('div');
    indicator.className = 'hs-knob-indicator';
    dial.appendChild(indicator);

    const lbl = document.createElement('div');
    lbl.className = 'hs-knob-label';
    lbl.textContent = opts.label;

    const val = document.createElement('div');
    val.className = 'hs-knob-value';
    val.textContent = formatVal(this.value, this.digits, this.unit);

    root.append(dial, lbl, val);

    this.el = root;
    this.indicator = indicator;
    this.valueEl = val;
    this.dial = dial;
    this.labelEl = lbl;

    this.refreshVisual();

    dial.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dial.addEventListener('dblclick', () => this.setValue(this.defaultValue, true));
    dial.addEventListener('keydown', (e) => this.onKeyDown(e));
    dial.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  setValue(v: number, fire = true): void {
    const clamped = clamp(snap(v, this.step), this.min, this.max);
    if (clamped === this.value && !fire) return;
    this.value = clamped;
    this.refreshVisual();
    if (fire) this.onChange(this.value);
  }

  /**
   * Update the visible label and aria-label without rebuilding the DOM.
   * Used by the i18n layer when the active language flips.
   */
  setLabel(label: string): void {
    this.labelEl.textContent = label;
    this.dial.setAttribute('aria-label', label);
  }

  destroy(): void {
    this.releasePointer();
    if (this.el.parentElement) this.el.parentElement.removeChild(this.el);
  }

  // ------------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------------

  /** Convert this.value into [0,1] normalized position respecting log scale. */
  private toNorm(v: number): number {
    if (this.log) {
      const lo = Math.log(Math.max(this.min, 1e-6));
      const hi = Math.log(Math.max(this.max, this.min + 1e-6));
      const x = Math.log(Math.max(v, this.min));
      return clamp((x - lo) / (hi - lo), 0, 1);
    }
    if (this.max === this.min) return 0;
    return clamp((v - this.min) / (this.max - this.min), 0, 1);
  }

  /** Inverse of toNorm. */
  private fromNorm(t: number): number {
    const tt = clamp(t, 0, 1);
    if (this.log) {
      const lo = Math.log(Math.max(this.min, 1e-6));
      const hi = Math.log(Math.max(this.max, this.min + 1e-6));
      return Math.exp(lo + (hi - lo) * tt);
    }
    return this.min + (this.max - this.min) * tt;
  }

  private refreshVisual(): void {
    const t = this.toNorm(this.value);
    // Map [0,1] -> [-TRAVEL/2, +TRAVEL/2]
    const deg = -TRAVEL_DEG / 2 + TRAVEL_DEG * t;
    this.indicator.style.transform = `translate(-50%, -100%) rotate(${deg.toFixed(2)}deg)`;
    this.valueEl.textContent = formatVal(this.value, this.digits, this.unit);
    this.dial.setAttribute('aria-valuenow', String(this.value));
  }

  private onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.dragging = true;
    this.dragStartY = e.clientY;
    this.dragStartX = e.clientX;
    this.dragStartVal = this.value;
    this.pointerId = e.pointerId;
    try {
      this.dial.setPointerCapture(e.pointerId);
    } catch {
      /* not all browsers honor pointer capture on divs without setPointerCapture support */
    }
    this.dial.focus();
    this.boundMove = (ev) => this.onPointerMove(ev);
    this.boundUp = (ev) => this.onPointerUp(ev);
    window.addEventListener('pointermove', this.boundMove);
    window.addEventListener('pointerup', this.boundUp);
    window.addEventListener('pointercancel', this.boundUp);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dy = this.dragStartY - e.clientY; // up = positive
    const dx = e.clientX - this.dragStartX;
    // Horizontal motion (or shift held) => fine mode (10× slower).
    const horiz = Math.abs(dx) > Math.abs(dy);
    const fine = horiz || e.shiftKey;
    const scale = fine ? 0.1 : 1;
    const startNorm = this.toNorm(this.dragStartVal);
    const deltaNorm = (dy * scale) / DRAG_RANGE_PX;
    const newVal = this.fromNorm(startNorm + deltaNorm);
    this.setValue(newVal, true);
  }

  private onPointerUp(_e: PointerEvent): void {
    this.releasePointer();
  }

  private releasePointer(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.pointerId !== null) {
      try {
        this.dial.releasePointerCapture(this.pointerId);
      } catch {
        /* noop */
      }
      this.pointerId = null;
    }
    if (this.boundMove) {
      window.removeEventListener('pointermove', this.boundMove);
      this.boundMove = null;
    }
    if (this.boundUp) {
      window.removeEventListener('pointerup', this.boundUp);
      window.removeEventListener('pointercancel', this.boundUp);
      this.boundUp = null;
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    let next = this.value;
    let handled = true;
    const stepCount = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = this.value + this.step * stepCount;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = this.value - this.step * stepCount;
        break;
      case 'PageUp':
        next = this.value + this.step * 10;
        break;
      case 'PageDown':
        next = this.value - this.step * 10;
        break;
      case 'Home':
        next = this.min;
        break;
      case 'End':
        next = this.max;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.setValue(next, true);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (document.activeElement !== this.dial) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const stepCount = e.shiftKey ? 10 : 1;
    this.setValue(this.value + dir * this.step * stepCount, true);
  }
}
