import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const server = process.env.GAME_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/wished-art': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        godsView: resolve(here, 'gods-view.html'),
      },
    },
  },
});
