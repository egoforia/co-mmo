import { defineConfig } from 'vitest/config';

// The network bench (docs/playtest.md): robot players walk through a pretend
// network and the bench reports how smooth play felt. It runs on its own,
// one scenario at a time: `npm run netbench`.
export default defineConfig({
  test: {
    include: ['packages/*/netbench/**/*.net.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
