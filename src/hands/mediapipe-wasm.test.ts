import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MEDIAPIPE_TASKS_VISION_VERSION,
  MEDIAPIPE_WASM_BASE,
} from './mediapipe-wasm';

describe('MediaPipe WASM pin', () => {
  it('matches the installed @mediapipe/tasks-vision version', () => {
    const pkg = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'node_modules/@mediapipe/tasks-vision/package.json'),
        'utf8',
      ),
    ) as { version: string };
    // Bumping the dependency? Update MEDIAPIPE_TASKS_VISION_VERSION too.
    expect(MEDIAPIPE_TASKS_VISION_VERSION).toBe(pkg.version);
  });

  it('never points at a floating tag', () => {
    expect(MEDIAPIPE_WASM_BASE).not.toMatch(/@latest|@next/);
    expect(MEDIAPIPE_WASM_BASE).toContain(`@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`);
  });
});
