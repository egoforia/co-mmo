import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, inviteUrl } from './app.ts';
import { Store } from './store.ts';
import { connectPostgres } from './db.ts';
import { connectRedis } from './redis.ts';
import { RedisTurnLedger, SharedPaintQueue } from './shared-paint-queue.ts';
import { RedisBus } from './bus.ts';
import { Updater, currentCommit } from './updates.ts';
import { ApiLog, KEEP_DAYS, MAX_BYTES } from './api-log.ts';

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

// Postgres when DATABASE_URL is set (docs/scale.md); otherwise one JSON file,
// so the game starts with nothing installed. Postgres's first run brings in
// whatever the file held.
const databaseUrl = process.env.DATABASE_URL;
const store = await (databaseUrl ? connectPostgres(databaseUrl).then((sql) => Store.postgres(sql, dataFile)) : Store.open(dataFile)).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
console.log(`The world is kept in ${store.label}.`);
// Redis when REDIS_URL is set: the paint queue's turns and pauses are shared
// by every server and outlive a restart. Without it they live in memory.
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? await connectRedis(redisUrl).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
}) : undefined;
const ledger = redis && new RedisTurnLedger(redis);
if (ledger) console.log('The paint queue is kept in Redis.');
// Region servers (npm run region-server) reach this server through the same Redis.
const regionBus = redis && new RedisBus(redis);
// scripts/dev.mjs (npm run dev) watches the request file and does the pull
// and restart; without it the Owner still sees what is new on GitHub.
const updater = new Updater({
  repoDir: repoRoot,
  requestFile: process.env.CO_MMO_UPDATE_REQUEST,
  resultFile: process.env.CO_MMO_UPDATE_RESULT,
});
// Every request to an outside service, kept beside the world for God's View's API Log,
// for API_LOG_DAYS days and API_LOG_MAX_MB megabytes at most.
const apiLog = await ApiLog.open({
  dir: resolve(process.env.API_LOG_DIR ?? resolve(dirname(dataFile), 'api-log')),
  keepDays: positive('API_LOG_DAYS', KEEP_DAYS),
  maxBytes: positive('API_LOG_MAX_MB', MAX_BYTES / 1024 / 1024) * 1024 * 1024,
});
const app = createApp({
  store,
  apiLog,
  publicUrl,
  clientDir,
  updater,
  commit: currentCommit(repoRoot),
  ...(ledger ? { paintQueue: new SharedPaintQueue(ledger) } : {}),
  ...(regionBus ? { regionBus } : {}),
  builds: { repoDir: repoRoot },
  shippedArt: resolve(repoRoot, 'packages/client/public/art/manifest.json'),
  wishes: {
    anchorDir: resolve(repoRoot, 'assets/anchors'),
    artDir: resolve(process.env.ART_DIR ?? resolve(dirname(dataFile), 'art')),
  },
});

app.server.listen(port, () => {
  console.log(`co-MMO server listening on http://localhost:${port}`);
  updater.start();
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
    await store.close();
    await regionBus?.close();
    await ledger?.close();
    process.exit(0);
  });
}

/** A positive number from the environment, or `fallback` (with a warning) when it is missing or not one. */
function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`${name}=${raw} is not a positive number, so ${fallback} is used.`);
  return fallback;
}
