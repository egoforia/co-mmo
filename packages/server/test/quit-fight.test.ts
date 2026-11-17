import { describe, expect, it } from 'vitest';
import { newCharacter, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { QUIT_FIGHT_MS, type Connection } from '../src/region.ts';
import { World, type Place } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

/** Mara, sturdy, beside a scarab in the desert that has started on her. */
function inFight() {
  const clock = { now: 5_000_000 };
  const world = new World(() => clock.now, () => 0.5);
  // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
  for (const r of world.units()) r.map.safe = [];
  const quits: Place[] = [];
  world.onQuit = (p) => quits.push(p);
  const ch = newCharacter();
  ch.hp = 10_000;
  ch.stats.vigor = 500;
  world.join(info('a', 'Mara'), fakeConn(), { regionId: 'desert', x: null, y: null }, ch);
  const desert = world.local('desert')!;
  const scarab = desert.creatureIds()[0]!;
  const me = desert.position('a')!;
  desert.placeCreature(scarab, me.x + 1, me.y);
  for (let i = 0; i < 3; i++) {
    clock.now += 1000;
    world.tick();
  }
  return { world, desert, clock, quits, scarab };
}

describe('quitting mid-fight', () => {
  it('leaves at once when nothing is fighting them', () => {
    const clock = { now: 5_000_000 };
    const world = new World(() => clock.now, () => 0.5);
    // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
    for (const r of world.units()) r.map.safe = [];
    world.join(info('a'), fakeConn(), { regionId: 'sanctum', x: null, y: null }, newCharacter());
    const place = world.leave('a') as Place | undefined;
    expect(place?.regionId).toBe('sanctum');
    expect(world.has('a')).toBe(false);
  });

  it('keeps them in the world until nothing has attacked them for 15 seconds', () => {
    const { world, desert, clock, quits, scarab } = inFight();
    expect(desert.creatureMood(scarab)!.aggro).toBe('a');
    expect(world.leave('a')).toBeUndefined();
    expect(world.has('a')).toBe(true);
    clock.now += 1000;
    world.tick();
    expect(desert.has('a')).toBe(true);
    // The fight ends: the scarab is taken away, and 15 quiet seconds later they are gone.
    desert.removeWish(desert.creature(scarab)!.kind);
    for (let t = 0; t <= QUIT_FIGHT_MS; t += 1000) {
      clock.now += 1000;
      world.tick();
    }
    expect(world.has('a')).toBe(false);
    expect(quits).toHaveLength(1);
    expect(quits[0]).toMatchObject({ id: 'a', regionId: 'desert' });
  });

  it('coming back before it is over takes up the fight where they stand', () => {
    const { world, desert, clock } = inFight();
    const at = desert.position('a')!;
    world.leave('a');
    clock.now += 1000;
    world.tick();
    const conn = fakeConn();
    world.join(info('a', 'Mara'), conn, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    expect(world.regionOf('a')!.def.id).toBe('desert');
    expect(desert.position('a')).toEqual(at);
    for (let t = 0; t <= QUIT_FIGHT_MS * 2; t += 1000) {
      clock.now += 1000;
      world.tick();
    }
    // Playing again: not taken out when the fight ends.
    expect(world.has('a')).toBe(true);
  });
});
