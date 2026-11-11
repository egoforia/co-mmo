import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The robot playtester (docs/playtest.md): bots and a browser play the real
// game with fake AI. Slower than the unit tests, so it runs on its own:
// `npm run playtest`.
export default defineConfig({
  resolve: {
    alias: {
      '@co-mmo/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@co-mmo/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
      '@co-mmo/client': fileURLToPath(new URL('./packages/client/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/playtest/**/*.play.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    // A runner without a graphics card draws the game slowly; give what a page shows time to change.
    expect: { poll: { timeout: 30_000 } },
  },
});
