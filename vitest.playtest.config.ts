import { defineConfig } from 'vitest/config';

// The robot playtester (docs/playtest.md): bots and a browser play the real
// game with fake AI. Slower than the unit tests, so it runs on its own:
// `npm run playtest`.
export default defineConfig({
  test: {
    include: ['packages/*/playtest/**/*.play.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
