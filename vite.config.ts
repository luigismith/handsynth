/// <reference types="node" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite configuration for HandSynth.
 *
 * Notes:
 * - Target ES2022 to keep modern syntax (BigInt, top-level await, class fields).
 * - Static output (`dist/`) — Vercel/Netlify-friendly; no SSR.
 * - AudioWorklet strategy: worklet sources live in `src/audio/worklets/*.ts` and are
 *   loaded via `import workletUrl from '...?worker&url'` — Vite emits a separate
 *   chunk and we pass the URL to `AudioContext.audioWorklet.addModule(url)`. This
 *   avoids a custom plugin and works in dev (with HMR) and build alike.
 *   See ARCHITECTURE.md (AudioWorklet integration) for details.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@audio': resolve(__dirname, 'src/audio'),
      '@music': resolve(__dirname, 'src/music'),
      '@hands': resolve(__dirname, 'src/hands'),
      '@face': resolve(__dirname, 'src/face'),
      '@interaction': resolve(__dirname, 'src/interaction'),
      '@visual': resolve(__dirname, 'src/visual'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@contracts': resolve(__dirname, 'src/types'),
      '@presets': resolve(__dirname, 'src/presets'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          tone: ['tone'],
          mediapipe: ['@mediapipe/tasks-vision'],
          p5: ['p5'],
        },
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
  server: {
    host: true,
    // MediaPipe + AudioWorklet require a secure context. `localhost` counts; for LAN
    // testing pair this with mkcert or `--https`.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
});
