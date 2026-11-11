import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { DEFAULT_SKY, cleanSky } from '@co-mmo/shared';
import { inviteUrl } from './account-routes.ts';
import { Store } from './store.ts';
import { connectPostgres, openBuiltInPostgres } from './db.ts';
import { connectRedis } from './redis.ts';
import { RedisTurnLedger, SharedPaintQueue } from './shared-paint-queue.ts';
import { RedisBus } from './bus.ts';
import { netFromEnv } from './socket-net.ts';
import { Updater, currentCommit } from './updates.ts';
import { ApiLog, KEEP_DAYS, MAX_BYTES } from './api-log.ts';

const port = Number(process.env.PORT ?? 3001);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
// Saved things that are not in the database (painted art, the API Log) live
// beside it; DATA_FILE also names an older game's world file to bring in.
const dataFile = resolve(process.env.DATA_FILE ?? resolve(repoRoot, 'data/world.json'));
const dbDir = resolve(process.env.DB_DIR ?? resolve(dirname(dataFile), 'db'));
// In development the browser talks to Vite (5173), which proxies to us.
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';
// Serve the built client when there is one (npm run build); Vite serves it in dev.
const builtClient = resolve(repoRoot, 'packages/client/dist');
const clientDir = process.env.CLIENT_DIR
  ? resolve(process.env.CLIENT_DIR)
  : existsSync(builtClient) ? builtClient : undefined;

// The world is always kept in Postgres (docs/scale.md): the server at
// DATABASE_URL, or else the Postgres built into the game, in DB_DIR, so the
// game starts with nothing installed. A first run brings in the world from
// an older game's JSON file, if there is one.
const databaseUrl = process.env.DATABASE_URL;
const sql = await (databaseUrl ? connectPostgres(databaseUrl) : openBuiltInPostgres(dbDir)).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
const store = await Store.postgres(sql, dataFile, databaseUrl ? `Postgres on ${hostOf(databaseUrl)}` : `the built-in Postgres in ${dbDir}`).catch((err: Error) => {
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
// Every request to an outside service, kept in the database for God's View's API Log,
// for API_LOG_DAYS days and API_LOG_MAX_MB megabytes at most. An older game's
// log files (API_LOG_DIR) are brought in once.
const apiLog = await ApiLog.open({
  sql,
  importFrom: resolve(process.env.API_LOG_DIR ?? resolve(dirname(dataFile), 'api-log')),
  keepDays: positive('API_LOG_DAYS', KEEP_DAYS),
  maxBytes: positive('API_LOG_MAX_MB', MAX_BYTES / 1024 / 1024) * 1024 * 1024,
});
const app = createApp({
  store,
  // A game day of DAY_MINUTES, weather that changes every WEATHER_MINUTES; WEATHER=off keeps skies clear.
  sky: cleanSky({
    dayMinutes: positive('DAY_MINUTES', DEFAULT_SKY.dayMinutes),
    weatherMinutes: positive('WEATHER_MINUTES', DEFAULT_SKY.weatherMinutes),
    weather: process.env.WEATHER?.trim().toLowerCase() !== 'off',
  }),
  apiLog,
  // NET_COMPRESS=off sends to players uncompressed, NET_SKIP_STALE=off never skips a snapshot,
  // NET_SEE_ACROSS=off hides what stands over a region edge, NET_FAST_PATH=off takes the
  // slower path through region servers (socket-net.ts).
  net: netFromEnv(process.env),
  publicUrl,
  clientDir,
  updater,
  commit: currentCommit(repoRoot),
  ...(ledger ? { paintQueue: new SharedPaintQueue(ledger) } : {}),
  ...(regionBus ? { regionBus } : {}),
  builds: { repoDir: repoRoot },
  shippedArt: resolve(repoRoot, 'packages/client/public/art/manifest.json'),
  kitSheets: resolve(repoRoot, 'assets/kit-sheets'),
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

/** Where a database address points (host and port), never its user or password. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || 'this machine';
  } catch {
    return 'the DATABASE_URL server';
  }
}
