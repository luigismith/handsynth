// Owner: ux-curator (entry / wiring) — stub by architect
//
// Application entry point. Wires the subsystems together but does no real
// work itself. The ux-curator agent is responsible for the lifecycle
// (onboarding, webcam permission flow, autopilot fallback). Until then this
// stub just constructs the modules and waits.

import { AudioEngineImpl } from '@audio/AudioEngine';
import { HandTrackerImpl } from '@hands/HandTracker';
import { MusicBrainImpl } from '@music/MusicBrain';
import { InteractionMapperImpl } from '@interaction/InteractionMapper';
import { VisualizerImpl } from '@visual/Visualizer';
import { VIBES, DEFAULT_VIBE } from '@presets/vibes';

async function bootstrap(): Promise<void> {
  // Element references — present in index.html.
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement | null;
  const video = document.getElementById('webcam') as HTMLVideoElement | null;
  if (!canvas || !video) {
    throw new Error('Required DOM nodes not found (#visualizer or #webcam).');
  }

  // Construct subsystems. Real init happens later from a user gesture.
  const audio = new AudioEngineImpl();
  const music = new MusicBrainImpl();
  const hands = new HandTrackerImpl();
  const interaction = new InteractionMapperImpl();
  const visual = new VisualizerImpl();

  // Vibe seed — UI will swap this once VibeSelector is wired.
  const initialVibe = VIBES[DEFAULT_VIBE];

  // The orchestration below is intentionally minimal — the ux-curator agent
  // owns the real flow (gating audio init on user gesture, onboarding, etc).
  void { audio, music, hands, interaction, visual, video, canvas, initialVibe };

  // eslint-disable-next-line no-console
  console.info('[handsynth] bootstrap stub ready — awaiting ux-curator implementation');
}

void bootstrap();
