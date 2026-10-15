import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const server = process.env.GAME_SERVER ?? 'http://localhost:3001';

// After "Pull main and restart" Vite is back before the game server, and it
// reloads open pages as soon as it is. Answer their requests in words (and a
// 503 the pages know to wait out) instead of Vite's bare 502.
const whileDown: ProxyOptions['configure'] = (proxy) => {
  proxy.on('error', (_err, _req, res) => {
    if (!('writeHead' in res) || res.headersSent) return;
    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '2' });
    res.end(JSON.stringify({ error: 'starting', message: 'The game is starting up. Try again in a moment.' }));
  });
};

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: server, changeOrigin: true, configure: whileDown },
      '/wished-art': { target: server, changeOrigin: true, configure: whileDown },
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
