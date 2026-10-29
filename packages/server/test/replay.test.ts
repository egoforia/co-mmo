import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATURES,
  TICK_SECONDS,
  collides,
  newCharacter,
  regionDef,
  type AbilityDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { mulberry32 } from '../src/debug/prng.ts';
import { RegionRecorder } from '../src/debug/region-recorder.ts';
import { replayTrace } from '../src/tools/replay.ts';
import { World } from '../src/world.ts';
import { handleAdmin, type AdminContext } from '../src/admin.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = {
    messages,
    send: (m) => messages.push(m),
    close() {},
  };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

const taught: string[] = [];
afterEach(() => {
  for (const id of taught.splice(0)) delete ABILITIES[id];
});

function ability(effect: AbilityDef['effect'], more: Partial<AbilityDef> = {}): string {
  const id = `test-replay-${effect}-${taught.length}`;
  ABILITIES[id] = {
    name: `Test ${effect}`,
    description: 'For replay testing.',
    effect,
    energy: 0,
    cooldown: 0,
    range: 5,
    base: 3,
    stat: 'might',
    factor: 0,
    ...more,
  };
  taught.push(id);
  return id;
}

function openGround(region: Region): { x: number; y: number } {
  const start = region.position('p1')!;
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(start.x) + dx + 0.5;
        const y = Math.floor(start.y) + dy + 0.5;
        let clear = true;
        for (let sx = -2; sx <= 6 && clear; sx += 0.5) {
          for (let sy = -2; sy <= 2 && clear; sy += 0.5) {
            clear = !collides(region.map, x + sx, y + sy);
          }
        }
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open ground');
}

describe('Mulberry32 PRNG', () => {
  it('generates deterministic sequences from identical seeds', () => {
    const prng1 = mulberry32(12345);
    const prng2 = mulberry32(12345);
    const seq1 = Array.from({ length: 100 }, () => prng1());
    const seq2 = Array.from({ length: 100 }, () => prng2());
    expect(seq1).toEqual(seq2);
    for (const n of seq1) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('generates different sequences from different seeds', () => {
    const prng1 = mulberry32(12345);
    const prng2 = mulberry32(54321);
    const seq1 = Array.from({ length: 10 }, () => prng1());
    const seq2 = Array.from({ length: 10 }, () => prng2());
    expect(seq1).not.toEqual(seq2);
  });
});

describe('Headless Record and Replay', () => {
  it('records a 100-tick battle with 2 players and 3 creatures and replays it bit-for-bit', async () => {
    const seed = 987654321;
    const clock = { now: 1_000_000 };

    const region = new Region(
      regionDef('shore')!,
      { worldChat: () => undefined, online: () => 2, party: () => ['p1', 'p2'] },
      () => clock.now,
      mulberry32(seed),
    );

    const conns = { p1: fakeConn(), p2: fakeConn() };
    for (const id of ['p1', 'p2'] as const) {
      const ch = newCharacter();
      ch.abilities.push('firebolt', 'mend', 'power-strike');
      region.join(info(id, id === 'p1' ? 'Mara' : 'Tolle'), conns[id], { x: null, y: null }, ch);
    }

    const at = openGround(region);
    region.placePlayer('p1', at.x, at.y);
    region.placePlayer('p2', at.x - 1, at.y);

    const allCreatures = region.creatureIds();
    expect(allCreatures.length).toBeGreaterThanOrEqual(3);
    const fightCreatures = allCreatures.slice(0, 3);
    const otherCreatures = allCreatures.slice(3);

    // Place the 3 fighting creatures near the players
    region.placeCreature(fightCreatures[0]!, at.x + 1, at.y);
    region.placeCreature(fightCreatures[1]!, at.x + 1, at.y + 1);
    region.placeCreature(fightCreatures[2]!, at.x + 1, at.y - 1);

    // Move other creatures far away
    otherCreatures.forEach((id, i) => region.placeCreature(id, at.x + 40 + i, at.y + 40));

    // Start recording
    const recorder = new RegionRecorder(region, { seed, clock: clock.now, maxTicks: 150 });

    // Scripted battle sequence over 100 ticks
    for (let t = 1; t <= 100; t++) {
      clock.now += TICK_SECONDS * 1000;

      if (t === 1) {
        // Player 1 attacks creature 0 with firebolt
        region.handle('p1', { t: 'ability', ability: 'firebolt', target: fightCreatures[0]! });
        // Player 1 sends a chat message (must be stripped for privacy)
        region.handle('p1', { t: 'chat', channel: 'say', text: 'Secret tactical whisper' });
      } else if (t === 2) {
        // Player 2 walks slightly toward creature 1
        region.handle('p2', { t: 'input', seq: 1, dx: 0, dy: 1 });
      } else if (t === 5) {
        // Player 2 attacks creature 1 with power-strike
        region.handle('p2', { t: 'ability', ability: 'power-strike', target: fightCreatures[1]! });
      } else if (t === 10) {
        // Player 1 heals player 2 (drawing threat to healer)
        region.handle('p1', { t: 'ability', ability: 'mend', target: 'p2' });
      } else if (t === 15) {
        // Player 1 basic attacks creature 2
        region.handle('p1', { t: 'attack', target: fightCreatures[2]! });
      } else if (t === 20) {
        // Player 2 basic attacks creature 0
        region.handle('p2', { t: 'attack', target: fightCreatures[0]! });
      }

      region.tick();
    }

    const trace = recorder.stop();
    expect(trace.ticks.length).toBe(100);

    // Verify privacy: chat text was stripped
    const chatInput = trace.ticks.flatMap((t) => t.inputs).find((i) => i.message.t === 'chat');
    expect(chatInput).toBeDefined();
    expect((chatInput!.message as any).text).toBe('');

    // Replay the trace in a fresh region with verification
    const result = await replayTrace(trace, { verify: true });
    if (!result.success) console.log('MISMATCHES:', result.mismatches);
    expect(result.mismatches).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.ticks).toBe(100);

    // Assert that all final HP, positions, creature states, and threat tables match bit-for-bit!
    const origP1 = region.character('p1')!;
    const origP2 = region.character('p2')!;
    const replP1 = result.region.character('p1')!;
    const replP2 = result.region.character('p2')!;

    expect(replP1.hp).toBe(origP1.hp);
    expect(replP1.energy).toBe(origP1.energy);
    expect(result.region.position('p1')).toEqual(region.position('p1'));

    expect(replP2.hp).toBe(origP2.hp);
    expect(replP2.energy).toBe(origP2.energy);
    expect(result.region.position('p2')).toEqual(region.position('p2'));

    for (const cId of fightCreatures) {
      const origC = region.creature(cId)!;
      const replC = result.region.creature(cId)!;
      expect(replC.hp).toBe(origC.hp);
      expect(replC.x).toBe(origC.x);
      expect(replC.y).toBe(origC.y);
      expect(result.region.creatureMood(cId)).toEqual(region.creatureMood(cId));
      expect(result.region.creatureThreat(cId)).toEqual(region.creatureThreat(cId));
    }

    // Verify threat tables contain exact floating-point matches
    const origThreat0 = region.creatureThreat(fightCreatures[0]!)!;
    const replThreat0 = result.region.creatureThreat(fightCreatures[0]!)!;
    expect(replThreat0).toEqual(origThreat0);
    expect(Object.keys(replThreat0.threat).length).toBeGreaterThan(0);

    // Test CLI runner execution with --verify
    const tempFile = join(tmpdir(), `co-mmo-test-${Date.now()}.replay.json`);
    writeFileSync(tempFile, JSON.stringify(trace, null, 2), 'utf-8');

    try {
      const output = execFileSync('node_modules/.bin/tsx', ['packages/server/src/tools/replay.ts', tempFile, '--verify'], {
        encoding: 'utf-8',
      });
      expect(output).toContain('Replay completed successfully: 100 ticks');

      // Test with --tick 25
      const outputTick = execFileSync('node_modules/.bin/tsx', ['packages/server/src/tools/replay.ts', tempFile, '--tick', '25'], {
        encoding: 'utf-8',
      });
      expect(outputTick).toContain('25 ticks');
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {}
    }
  }, 30_000);
});

describe('Dev pause, step, and resume simulation controls', () => {
  it('controls world ticking via World.pause, World.step, and World.resume', () => {
    let now = 100_000;
    const world = new World(() => now);
    const startTicks = (world as any).ticks;

    // Running normally: tick advances
    world.tick();
    expect((world as any).ticks).toBe(startTicks + 1);

    // Pause simulation
    world.pause();
    expect(world.isPaused()).toBe(true);

    // Normal tick() does nothing while paused
    world.tick();
    expect((world as any).ticks).toBe(startTicks + 1);

    // Single step advances exactly 1 tick
    world.step();
    expect((world as any).ticks).toBe(startTicks + 2);

    // Resume simulation
    world.resume();
    expect(world.isPaused()).toBe(false);

    // Normal tick resumes
    world.tick();
    expect((world as any).ticks).toBe(startTicks + 3);
  });

  it('strictly guards dev endpoints to non-production (403 when NODE_ENV=production)', async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const world = new World();
      const mockRes: any = {
        statusCode: 200,
        headers: {},
        writeHead(status: number, headers: any) {
          this.statusCode = status;
          this.headers = headers;
        },
        end(data: string) {
          this.body = JSON.parse(data);
        },
      };

      const mockReq: any = {
        method: 'POST',
        url: '/api/admin/dev/pause',
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('{}');
        },
      };

      const ctx: any = {
        world,
        json: (res: any, status: number, body: any) => {
          res.writeHead(status, {});
          res.end(JSON.stringify(body));
        },
        readJson: async () => ({}),
      };

      const ownerAccount: any = { id: 'owner', name: 'Admin', role: 'owner' };
      const handled = await handleAdmin(mockReq, mockRes, '/api/admin/dev/pause', ownerAccount, ctx);

      expect(handled).toBe(true);
      expect(mockRes.statusCode).toBe(403);
      expect(mockRes.body.error).toBe('forbidden');
      expect(mockRes.body.message).toContain('development');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('allows owner to pause, step, and resume in development mode via admin API', async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';

      const world = new World();
      const createReqRes = (action: string) => {
        const res: any = {
          statusCode: 200,
          headers: {},
          writeHead(status: number, headers: any) {
            this.statusCode = status;
            this.headers = headers;
          },
          end(data: string) {
            this.body = JSON.parse(data);
          },
        };
        const req: any = {
          method: 'POST',
          url: `/api/admin/dev/${action}`,
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('{}');
          },
        };
        return { req, res };
      };

      const ctx: any = {
        world,
        rules: { tick: () => {} },
        json: (res: any, status: number, body: any) => {
          res.writeHead(status, {});
          res.end(JSON.stringify(body));
        },
        readJson: async () => ({}),
      };
      const ownerAccount: any = { id: 'owner', name: 'Admin', role: 'owner' };

      // Pause
      const { req: pReq, res: pRes } = createReqRes('pause');
      await handleAdmin(pReq, pRes, '/api/admin/dev/pause', ownerAccount, ctx);
      expect(pRes.statusCode).toBe(200);
      expect(world.isPaused()).toBe(true);

      // Step
      const { req: sReq, res: sRes } = createReqRes('step');
      await handleAdmin(sReq, sRes, '/api/admin/dev/step', ownerAccount, ctx);
      expect(sRes.statusCode).toBe(200);
      expect(sRes.body.stepped).toBe(true);

      // Resume
      const { req: rReq, res: rRes } = createReqRes('resume');
      await handleAdmin(rReq, rRes, '/api/admin/dev/resume', ownerAccount, ctx);
      expect(rRes.statusCode).toBe(200);
      expect(world.isPaused()).toBe(false);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('allows owner to start and stop region replay recording via admin API', async () => {
    const world = new World();
    const ctx: any = {
      world,
      json: (res: any, status: number, body: any) => {
        res.writeHead(status, {});
        res.end(JSON.stringify(body));
      },
      readJson: async () => ({ regionId: world.home.def.id, durationSeconds: 5 }),
    };
    const ownerAccount: any = { id: 'owner', name: 'Admin', role: 'owner' };

    // Start recording
    const startRes: any = {
      writeHead(s: number) { this.statusCode = s; },
      end(d: string) { this.body = JSON.parse(d); },
    };
    const startReq: any = { method: 'POST', url: '/api/admin/replay/start' };
    await handleAdmin(startReq, startRes, '/api/admin/replay/start', ownerAccount, ctx);
    expect(startRes.statusCode).toBe(200);
    expect(startRes.body.recording).toBe(true);

    // Stop recording
    const stopRes: any = {
      writeHead(s: number) { this.statusCode = s; },
      end(d: string) { this.body = JSON.parse(d); },
    };
    const stopReq: any = { method: 'POST', url: '/api/admin/replay/stop' };
    await handleAdmin(stopReq, stopRes, '/api/admin/replay/stop', ownerAccount, ctx);
    expect(stopRes.statusCode).toBe(200);
    expect(stopRes.body.trace).toBeDefined();
    expect(stopRes.body.trace.header.regionId).toBe(world.home.def.id);
  });
});
