/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@audio': resolve(__dirname, 'src/audio'),
      '@music': resolve(__dirname, 'src/music'),
      '@hands': resolve(__dirname, 'src/hands'),
      '@interaction': resolve(__dirname, 'src/interaction'),
      '@visual': resolve(__dirname, 'src/visual'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@contracts': resolve(__dirname, 'src/types'),
      '@presets': resolve(__dirname, 'src/presets'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
