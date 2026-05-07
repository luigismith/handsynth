// Owner: music-brain
//
// Sequencer — thin wrapper around `Tone.getTransport()`. Schedules a
// repeating 16th-note callback, derives bar/beat indices, and wires Tone's
// built-in swing parameter for groove. The MusicBrain sits on top and
// dispatches per-step notes/drums.

import * as Tone from 'tone';
import type {
  Sequencer,
  SequencerEvents,
  StepInfo,
} from './sequencer-types';

const STEPS_PER_BEAT = 4; // 16th-note resolution
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR; // 16

class SequencerImpl implements Sequencer {
  private events: Partial<SequencerEvents> = {};
  private repeatId: number | null = null;
  private stepCount = 0;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stepCount = 0;
    const transport = Tone.getTransport();
    // 16th-note grid. Tone schedules ahead-of-time and passes the audio-clock
    // `time` so subscribers can use it for sample-accurate triggers.
    this.repeatId = transport.scheduleRepeat((time) => this.tick(time), '16n');
    if (transport.state !== 'started') {
      transport.start();
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const transport = Tone.getTransport();
    if (this.repeatId !== null) {
      transport.clear(this.repeatId);
      this.repeatId = null;
    }
    transport.stop();
    this.stepCount = 0;
  }

  setBPM(bpm: number): void {
    const transport = Tone.getTransport();
    // Smooth BPM ramp — half-second glide so changes don't jolt.
    transport.bpm.rampTo(bpm, 0.5);
  }

  setSwing(amount: number): void {
    const a = clamp01(amount);
    const transport = Tone.getTransport();
    transport.swing = a;
    transport.swingSubdivision = '16n';
  }

  on(events: Partial<SequencerEvents>): void {
    this.events = { ...this.events, ...events };
  }

  private tick(time: number | string): void {
    const stepIndex = this.stepCount;
    const stepInBar = stepIndex % STEPS_PER_BAR;
    const beatIndex = Math.floor(stepIndex / STEPS_PER_BEAT);
    const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
    const stepInfo: StepInfo = {
      stepIndex,
      stepInBar,
      beatIndex,
      barIndex,
      time,
    };

    this.events.onStep?.(stepInfo);
    if (stepInBar % STEPS_PER_BEAT === 0) {
      this.events.onBeat?.(beatIndex, time);
    }
    if (stepInBar === 0) {
      this.events.onBar?.(barIndex, time);
    }
    this.stepCount++;
  }
}

export const STEPS_PER_BEAT_VALUE = STEPS_PER_BEAT;
export const STEPS_PER_BAR_VALUE = STEPS_PER_BAR;
export const BEATS_PER_BAR_VALUE = BEATS_PER_BAR;

export function createSequencer(): Sequencer {
  return new SequencerImpl();
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export type {
  Sequencer,
  SequencerEvents,
  StepCallback,
  StepInfo,
} from './sequencer-types';
