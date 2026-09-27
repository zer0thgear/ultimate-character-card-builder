import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The tests cover lib/ — the pure modules that encode how NovelAI behaves.
// Anything needing a canvas, the network or a React tree is checked in the
// browser instead; see docs/REVERSE_ENGINEERING.md.
const local = (file: string, fallback: string) => fileURLToPath(new URL(`./${existsSync(new URL(`./${file}`, import.meta.url)) ? file : fallback}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Lets tests import server modules (lib/server/*).
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      // Local extensions, as in next.config.ts.
      '@local/client': local('local/client.tsx', 'lib/extensions/noClient.ts'),
      '@local/server': local('local/server.ts', 'lib/extensions/noServer.ts'),
    },
  },
  test: {
    environment: 'node',
    // A local extension's own tests live with it.
    include: ['tests/**/*.test.ts', 'local/**/*.test.ts'],
  },
});
