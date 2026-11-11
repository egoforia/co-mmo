// A game server for one shot: the real app on a random port with fake AI
// (the offline God, no painter, no video or sound), so taking shots never
// pays for anything, and a sky pinned to the shot's hour and weather. It
// uses only createApp so the same runner works on older commits when a
// branch is compared with main.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { hashString, type SkyConfig } from '@co-mmo/shared';
import { createApp, type App } from '../src/app.ts';
import { OfflineGod } from '../src/god.ts';
import { Store } from '../src/store.ts';
import { MemoryPaintQueue } from '../src/paint-queue.ts';

/** A running server for one shot. */
export interface ShotWorld {
  app: App;
  store: Store;
  base: string;
  close(): Promise<void>;
}

/** A fresh art folder for one run; shots share it so kit houses are drawn once. */
export const newArtDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'co-mmo-shots-'));

/** Starts the game serving `clientDir` and the repo's kit sheets, with this sky over every land. */
export async function shotWorld(repoRoot: string, clientDir: string, artDir: string, sky?: SkyConfig): Promise<ShotWorld> {
  const store = Store.memory();
  const app = createApp({
    store,
    publicUrl: 'http://shots.test',
    commit: 'shots',
    builds: { issues: null },
    auth: { mailer: { kind: 'email', async send() {} } },
    videoProvider: () => undefined,
    paintQueue: new MemoryPaintQueue({ limit: () => undefined }),
    clientDir,
    // The shipped kit sheets paint kit houses; no shipped-art manifest, so nothing is queued for painting.
    kitSheets: resolve(repoRoot, 'assets/kit-sheets'),
    sound: { start: false },
    ...(sky ? { sky } : {}),
    wishes: {
      env: {},
      anchorDir: '/nonexistent',
      artDir,
      chatModel: () => [new OfflineGod()],
      imageProvider: () => undefined,
    },
  });
  await app.ready;
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  return { app, store, base: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/**
 * Makes an account (the Owner, so God's View opens) and returns its sign-in
 * token. A player without a look of their own is drawn as one of two people
 * picked from their account id, so ids are drawn until the pick is the same
 * every run; otherwise every comparison would show the player changing.
 */
export function owner(store: Store, name = 'Shots'): { id: string; token: string } {
  for (let i = 0; ; i++) {
    const invite = store.createInvite(null, 'owner');
    const { account, token } = store.acceptInvite(invite.code, `${name}${i}`, 'sanctum');
    if (hashString(account.id) % 2 === 0 || i > 50) {
      // The same name every run too, so the name over the player and in the HUD doesn't change.
      account.name = name;
      return { id: account.id, token };
    }
  }
}

/**
 * Makes Math.random repeat the same numbers from `seed` on, so creatures and
 * townsfolk start from the same places and choices in every run. Their
 * moves still follow the clock, so busy shots differ a little.
 */
export function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws every land's kit houses into the art folder before any shot, so no
 * shot catches a house still being drawn (the first ask starts the drawing
 * and answers "building"). Returns the houses that could not be drawn.
 */
export async function drawKitHouses(world: ShotWorld, token: string, regions: string[], timeoutMs = 240_000): Promise<string[]> {
  const until = Date.now() + timeoutMs;
  let waiting = new Set(regions);
  const failed: string[] = [];
  while (waiting.size && Date.now() < until) {
    for (const region of [...waiting]) {
      const res = await fetch(`${world.base}/api/kit-houses?region=${region}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) { waiting.delete(region); continue; }
      const { houses } = (await res.json()) as { houses: { key: string; status: string }[] };
      if (houses.every((h) => h.status !== 'building')) {
        waiting.delete(region);
        failed.push(...houses.filter((h) => h.status === 'failed').map((h) => `${region}: ${h.key}`));
      }
    }
    if (waiting.size) await new Promise((r) => setTimeout(r, 1000));
  }
  return [...failed, ...[...waiting].map((r) => `${r}: still drawing after ${timeoutMs / 1000} s`)];
}
