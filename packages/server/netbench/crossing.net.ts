// Crossing a region edge between two region servers (`npm run netbench`,
// docs/playtest.md): one player walks back and forth over the road between
// the Sanctum and the Woods, each run by its own region server 20 ms from the
// game server, and the bench reports how long their screen went without a
// snapshot at each crossing and whether any step was lost. Compare with
// NET_FAST_PATH=off. Nothing is painted: no AI runs at all.

import { afterAll, describe, expect, it } from 'vitest';
import { newCharacter, TICK_SECONDS, type ServerMessage } from '@co-mmo/shared';
import type { Connection } from '../src/region.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import { netFromEnv } from '../src/socket-net.ts';
import { World } from '../src/world.ts';
import { SlowBus } from './lag-proxy.ts';

const CROSSINGS = 6;
const SERVER_MS = 20;

const ONLY = process.env.NETBENCH_ONLY?.toLowerCase();
const skip = Boolean(ONLY && !'crossing between region servers'.includes(ONLY));

describe.skipIf(skip)('network bench: crossing between region servers', () => {
  const stops: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const stop of stops) await stop();
  });

  it(`crosses ${CROSSINGS} times, region servers ${SERVER_MS} ms away`, async () => {
    const net = netFromEnv(process.env);
    const bus = new SlowBus(SERVER_MS);
    const world = new World();
    const servers = new RegionServers(bus, world, { content: () => [], fastPath: net.fastPath });
    world.hosting = servers;
    await servers.start();
    stops.push(() => servers.close());
    for (const id of ['a', 'b']) {
      const s = new RegionServer({ bus, id, env: process.env });
      await s.start();
      stops.push(() => s.stop());
      await until(() => world.home.host !== 'gateway');
    }
    await servers.move('sanctum', 'a');
    await servers.move('woods', 'b');

    // When each snapshot came and from which region (the last welcome says).
    const seen: { at: number; region: string; ack: number }[] = [];
    let region = '';
    const conn: Connection = {
      send: (m: ServerMessage) => {
        if (m.t === 'welcome') region = m.region.id;
        if (m.t === 'snapshot') seen.push({ at: performance.now(), region, ack: m.ack });
      },
      sendSnapshot: (text: string) => {
        const m = JSON.parse(text) as { ack: number };
        seen.push({ at: performance.now(), region, ack: m.ack });
      },
      close() {},
    };
    const west = world.home.map.entries.west!;
    world.join({ id: 'm', name: 'Mara', color: 0, role: 'player' }, conn, { regionId: 'sanctum', x: west.x + 3, y: west.y }, newCharacter());
    await until(() => seen.length > 5);

    // Walk west into the Woods and back east, one step a tick, as a browser sends them.
    let seq = 0;
    for (let n = 0; n < CROSSINGS; n++) {
      const from = world.regionOf('m')!.def.id;
      const dx = from === 'sanctum' ? -1 : 1;
      const end = performance.now() + 5000;
      while (world.regionOf('m')!.def.id === from && performance.now() < end) {
        world.handle('m', { t: 'input', seq: ++seq, dx, dy: 0 });
        await pause(TICK_SECONDS * 1000);
      }
      // A few steps on, so the next crossing starts away from the edge.
      for (let i = 0; i < 20; i++) {
        world.handle('m', { t: 'input', seq: ++seq, dx, dy: 0 });
        await pause(TICK_SECONDS * 1000);
      }
    }
    await pause(500);

    // The longest stretch without a snapshot around each change of region.
    const freezes: number[] = [];
    for (let i = 1; i < seen.length; i++) {
      if (seen[i]!.region !== seen[i - 1]!.region) freezes.push(Math.round(seen[i]!.at - seen[i - 1]!.at));
    }
    const lost = seq - seen.at(-1)!.ack;
    console.log(`\nCrossing between region servers ${SERVER_MS} ms away (NET_FAST_PATH ${net.fastPath ? 'on' : 'off'}):
  crossings: ${freezes.length}, no snapshot for ${freezes.join(', ')} ms (median ${median(freezes)} ms; 50 ms is none missed)
  steps sent ${seq}, last applied ${seen.at(-1)!.ack}: ${lost} lost; bus messages ${bus.sent}\n`);
    expect(freezes.length).toBe(CROSSINGS);
  });
});

function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(test: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(10);
  }
}
