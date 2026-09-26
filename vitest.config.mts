import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The tests cover lib/ — the pure modules that encode how NovelAI behaves.
// Anything needing a canvas, the network or a React tree is checked in the
// browser instead; see docs/REVERSE_ENGINEERING.md.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
