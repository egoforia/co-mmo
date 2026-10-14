import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, inviteUrl } from './app.ts';
import { Store } from './store.ts';

const port = Number(process.env.PORT ?? 3001);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const dataFile = resolve(process.env.DATA_FILE ?? resolve(repoRoot, 'data/world.json'));
// In development the browser talks to Vite (5173), which proxies to us.
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';
// Serve the built client when there is one (npm run build); Vite serves it in dev.
const builtClient = resolve(repoRoot, 'packages/client/dist');
const clientDir = process.env.CLIENT_DIR
  ? resolve(process.env.CLIENT_DIR)
  : existsSync(builtClient) ? builtClient : undefined;

const store = await Store.open(dataFile);
const app = createApp({
  store,
  publicUrl,
  clientDir,
  wishes: {
    anchorDir: resolve(repoRoot, 'assets/anchors'),
    artDir: resolve(process.env.ART_DIR ?? resolve(dirname(dataFile), 'art')),
  },
});

app.server.listen(port, () => {
  console.log(`co-MMO server listening on http://localhost:${port}`);
  // First run: nobody exists yet, so print a one-time invite that makes its
  // user the Owner.
  if (store.accountCount === 0) {
    const invite = store.pendingOwnerInvite() ?? store.createInvite(null, 'owner');
    console.log(`\nNo players yet. Open this link to create the Owner account:\n  ${inviteUrl(publicUrl, invite.code)}\n`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log('Saving and shutting down...');
    await app.close();
    process.exit(0);
  });
}
