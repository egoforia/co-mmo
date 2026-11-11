import { defineConfig } from 'vitest/config';

// The shot runner (docs/screenshots.md): fixed pictures of the game for
// agents to look at and compare. Started by `npm run shots`
// (scripts/shots.mjs), which also compares and reports.
export default defineConfig({
  test: {
    include: ['packages/server/shots/**/*.shots.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
