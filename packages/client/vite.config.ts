import { defineConfig } from 'vite';

const server = process.env.GAME_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
