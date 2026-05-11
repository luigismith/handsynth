#!/usr/bin/env tsx
// Owner: qa-listener / synthetic-player harness
//
// CLI entry point: `pnpm exec tsx scripts/simulate.ts --profile=chaos
// --duration=30 --seed=42 --fast`
//
// Mounts the same harness the bug-hunt suite uses, runs a profile, and
// prints a human-readable summary. Useful for spot-checking changes:
// before/after a code change, you can compare summaries side-by-side and
// see which metrics shifted.

import { InteractionMapperImpl } from '@interaction/InteractionMapper';
import { MusicBrainImpl } from '@music/MusicBrain';
import { VIBES, DEFAULT_VIBE } from '@presets/vibes';
import { FakeFaceTracker, FakeHandTracker } from '../src/test-tools/fake-trackers';
import { Observer } from '../src/test-tools/observer';
import { RecordingAudioEngine } from '../src/test-tools/recording-audio';
import { SyntheticPlayer } from '../src/test-tools/synthetic-player';
import { PROFILES, PROFILE_NAMES } from '../src/test-tools/profiles';

interface CliArgs {
  profile: string;
  durationSec: number;
  seed: number;
  fast: boolean;
  report: 'json' | 'text';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    profile: 'ambient',
    durationSec: 30,
    seed: 42,
    fast: true,
    report: 'text',
  };
  for (const a of argv.slice(2)) {
    const [k, v] = a.split('=');
    if (k === '--profile' && v) args.profile = v;
    else if (k === '--duration' && v) args.durationSec = parseFloat(v);
    else if (k === '--seed' && v) args.seed = parseInt(v, 10);
    else if (k === '--fast') args.fast = true;
    else if (k === '--live') args.fast = false;
    else if (k === '--report' && (v === 'json' || v === 'text'))
      args.report = v;
    else if (k === '--help' || k === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`HandSynth synthetic performer CLI

Usage: pnpm exec tsx scripts/simulate.ts [options]

Options:
  --profile=<name>     One of: ${PROFILE_NAMES.join(', ')}
  --duration=<sec>     Simulated seconds (default 30)
  --seed=<int>         RNG seed (default 42)
  --fast               Fast mode — no wall-clock pacing (default)
  --live               Live mode — pace to wall clock
  --report=text|json   Output format (default text)
  --help               This message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const profile = PROFILES[args.profile];
  if (!profile) {
    console.error(
      `[simulate] unknown profile: ${args.profile}. Try one of: ${PROFILE_NAMES.join(', ')}`,
    );
    process.exit(1);
  }

  const observer = new Observer();
  let simTime = 0;
  const audio = new RecordingAudioEngine(observer, { now: () => simTime });
  await audio.init();
  const music = new MusicBrainImpl();
  const hands = new FakeHandTracker();
  const face = new FakeFaceTracker();
  const mapper = new InteractionMapperImpl();

  mapper.attach({ audio, music, hands, face });
  mapper.setVibe(VIBES[DEFAULT_VIBE]);
  mapper.start();

  const origRecordParam = observer.recordParam.bind(observer);
  observer.recordParam = (t, p) => {
    simTime = Math.max(simTime, t);
    origRecordParam(t, p);
  };

  const player = new SyntheticPlayer({
    audio,
    music,
    hands,
    face,
    observer,
  });

  console.log(
    `[simulate] profile=${profile.name} duration=${args.durationSec}s seed=${args.seed} fast=${args.fast}`,
  );
  const startWall = performance.now();
  await player.play(profile, args.durationSec, {
    fast: args.fast,
    seed: args.seed,
  });
  const wallMs = (performance.now() - startWall).toFixed(1);

  mapper.stop();
  music.stop();

  const summary = observer.summary();
  if (args.report === 'json') {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n  wall-clock: ${wallMs} ms`);
    console.log(`  duration: ${summary.durationSec.toFixed(2)} s`);
    console.log(`  setParams calls: ${summary.totals.paramCalls}`);
    console.log(
      `  note events: ${summary.totals.noteEvents} (lead/bass/chord/perc combined)`,
    );
    console.log(`  voice-shape calls: ${summary.totals.voiceShapeCalls}`);
    console.log(`  music-state calls: ${summary.totals.musicStateCalls}`);
    console.log(`  errors: ${summary.totals.errors}`);
    console.log(`  peak params/sec: ${summary.peakParamsPerSec}`);
    console.log(`  avg params/sec: ${summary.avgParamsPerSec}`);
    if (summary.errors.length > 0) {
      console.log(`\n  --- errors ---`);
      for (const e of summary.errors) {
        console.log(`  [${e.t.toFixed(2)}s] ${e.source}: ${e.message}`);
      }
    }
    // Assertions. Skip the first 2 seconds for the rate ceiling — that's
    // the documented mapper startup transient (vibe-load cascade + pulse
    // register warmup + initial preset apply all cluster there).
    try {
      observer.assert.noErrors();
      observer.assert.noNaN();
      observer.assert.paramRangesValid();
      observer.assert.eventRateBounded('audio.setParams', 200, {
        skipSeconds: 2,
      });
      console.log(`\n  ✓ all assertions passed (warmup excluded: 2s)`);
    } catch (err) {
      console.error(
        `\n  ✗ assertion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error('[simulate] fatal:', err);
  process.exit(3);
});
