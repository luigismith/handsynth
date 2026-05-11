// Diagnostic: print per-second setParams call counts for a profile, so
// we can see exactly which seconds carry the burst and which are
// steady-state. Used to investigate the warmup peak observed in the
// stress matrix (peak 1422/sec on rhythmic, 1447 on chaos).
//
// Usage: pnpm exec tsx scripts/diag-warmup.ts <profile> <duration>

import { InteractionMapperImpl } from '@interaction/InteractionMapper';
import { MusicBrainImpl } from '@music/MusicBrain';
import { VIBES, DEFAULT_VIBE } from '@presets/vibes';
import { FakeFaceTracker, FakeHandTracker } from '../src/test-tools/fake-trackers';
import { Observer } from '../src/test-tools/observer';
import { RecordingAudioEngine } from '../src/test-tools/recording-audio';
import { SyntheticPlayer } from '../src/test-tools/synthetic-player';
import { PROFILES } from '../src/test-tools/profiles';

async function run(profileName: string, durationSec: number): Promise<void> {
  const observer = new Observer();
  const clock = { t: 0 };
  const audio = new RecordingAudioEngine(observer, { now: () => clock.t });
  await audio.init();
  const music = new MusicBrainImpl();
  const hands = new FakeHandTracker();
  const face = new FakeFaceTracker();
  const mapper = new InteractionMapperImpl();
  mapper.attach({ audio, music, hands, face });
  mapper.setVibe(VIBES[DEFAULT_VIBE]);
  mapper.start();
  const player = new SyntheticPlayer({
    audio,
    music,
    hands,
    face,
    observer,
    clock,
  });
  await player.play(PROFILES[profileName]!, durationSec, {
    fast: true,
    seed: 42,
  });
  mapper.stop();
  music.stop();
  const buckets = observer.metricsPerSecond();
  console.log(`\n=== ${profileName} (${durationSec}s, seed=42) ===`);
  for (const b of buckets) {
    const bar = '#'.repeat(Math.min(60, Math.floor(b.paramCallCount / 30)));
    console.log(
      `  s${String(b.second).padStart(2)} setParams=${String(b.paramCallCount).padStart(5)} ${bar}`,
    );
  }
}

const profile = process.argv[2] ?? 'rhythmic';
const dur = parseInt(process.argv[3] ?? '15', 10);
run(profile, dur);
