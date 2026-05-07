// Owner: music-brain
//
// Public types for the sequencer module. Kept separate so the implementation
// file stays focused on Tone wiring.

export interface StepInfo {
  /** Monotonic 16th-note step index since start(). */
  stepIndex: number;
  /** Step index modulo bar length (0..15). */
  stepInBar: number;
  /** Quarter-note beat index since start(). */
  beatIndex: number;
  /** Bar index since start(). */
  barIndex: number;
  /** Tone audio-clock time at which this step fires. Pass to triggers. */
  time: number | string;
}

export type StepCallback = (info: StepInfo) => void;

export interface SequencerEvents {
  onStep(info: StepInfo): void;
  /** Fires once per quarter-note. */
  onBeat(beatIndex: number, time: number | string): void;
  /** Fires once per bar (downbeat). */
  onBar(barIndex: number, time: number | string): void;
}

export interface Sequencer {
  start(): void;
  stop(): void;
  setBPM(bpm: number): void;
  /** 0..1, applied to 16ths via Tone.Transport.swing. */
  setSwing(amount: number): void;
  on(events: Partial<SequencerEvents>): void;
}
