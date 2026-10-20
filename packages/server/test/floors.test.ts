import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKY,
  TICK_RATE,
  addStairs,
  addStorey,
  floorChecks,
  newCharacter,
  regionDef,
  type PlayerInfo,
  type ServerMessage,
  type SnapshotMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

// Floors in play: Old Bramble's cottage in the Whispering Woods gets a floor
// above, up a flight of stairs, and a cellar down a ladder.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const DAY = DEFAULT_SKY.dayMinutes * 60_000;
const hour = (h: number) => DAY * 10 + (h / 24) * DAY;

/** The woods at an hour, the cottage with its floors, and a player standing in it. */
function cottage(h = 12) {
  const clock = { now: hour(h) };
  const region = new Region(regionDef('woods')!, undefined, () => clock.now, () => 0.5);
  const map = region.map;
  const home = map.buildings[0]!;
  addStorey(map, home, 1, home.style);
  addStorey(map, home, -1, home.style);
  const stairs = addStairs(map, { kind: 'stairs', x: 110, y: 124, width: 2, height: 1, from: 0 });
  const ladder = addStairs(map, { kind: 'ladder', x: 101, y: 130, width: 1, height: 1, from: -1 });
  const conn = fakeConn();
  region.join(info('a'), conn, { x: 110.5, y: 127.5 }, newCharacter());
  let seq = 0;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.now += 1000 / TICK_RATE;
      region.tick();
    }
  };
  const walk = (dx: number, dy: number, n: number) => {
    for (let i = 0; i < n; i++) {
      region.handle('a', { t: 'input', seq: ++seq, dx, dy });
      tick();
    }
  };
  const snapshot = () => conn.messages.filter((m): m is SnapshotMessage => m.t === 'snapshot').at(-1)!;
  return { region, map, stairs, ladder, conn, tick, walk, snapshot, clock };
}

describe('floors in a building', () => {
  it('are laid out soundly', () => {
    expect(floorChecks(cottage().map)).toEqual([]);
  });

  it('take a player up the stairs and back down, telling them where they are', () => {
    const { walk, snapshot, conn } = cottage();
    const notices = () => conn.messages.filter((m) => m.t === 'notice').map((m) => (m as { text: string }).text);
    // North up the stairs, and on north across the floor above.
    walk(0, -1, 30);
    expect(notices()).toContain('You climb the stairs to floor 1.');
    expect(snapshot().floor).toBe(1);
    expect(snapshot().y).toBeLessThan(121);
    // Back south: down again, coming off the bottom of the stairs.
    walk(0, 1, 30);
    expect(notices()).toContain('You go down the stairs to the ground floor.');
    expect(snapshot().floor).toBeUndefined();
    expect(snapshot().y).toBeGreaterThan(125);
  });

  it('keep people apart: nobody on another floor is seen, heard or spoken to', () => {
    const { region, snapshot, tick, conn, stairs } = cottage();
    tick();
    expect(snapshot().npcs.map((n) => n.id)).toContain('old-bramble');
    region.placePlayer('a', stairs.top.x, stairs.top.y, 1);
    tick();
    expect(snapshot().floor).toBe(1);
    expect(snapshot().npcs).toEqual([]);
    const before = conn.messages.length;
    region.handle('a', { t: 'interact' });
    expect(conn.messages.slice(before).some((m) => m.t === 'dialogue')).toBe(false);
  });

  it('let a creature chase a player up the stairs, but not down a ladder', () => {
    const { region, tick, stairs, ladder } = cottage();
    const [mushroom] = region.creatureIds();
    region.placeCreature(mushroom!, 110.5, 128.5);
    region.handle('a', { t: 'attack' });
    expect(region.creatureMood(mushroom!)?.aggro).toBe('a');
    region.placePlayer('a', stairs.top.x, stairs.top.y - 1, 1);
    tick(4 * TICK_RATE);
    expect(region.floorOf(mushroom!)).toBe(1);
    expect(region.creatureMood(mushroom!)?.aggro).toBe('a');
    // Down to the cellar by the ladder: it cannot follow, and goes home.
    region.placePlayer('a', ladder.bottom.x, ladder.bottom.y, -1);
    tick(2);
    expect(region.creatureMood(mushroom!)?.aggro).toBeNull();
    tick(10 * TICK_RATE);
    expect(region.floorOf(mushroom!)).toBe(0);
  });

  it('let people who live upstairs come down to the square at dusk', () => {
    const { region, clock, tick } = cottage(17.95);
    // Nobody stands about to stop them for a chat.
    region.remove('a');
    region.addNpc({ id: 'test-lodger', name: 'Lodger', asset: 'woods-herbalist', x: 104.5, y: 122.5, floor: 1 });
    tick();
    expect(region.floorOf('test-lodger')).toBe(1);
    clock.now = hour(18.2);
    tick(60 * TICK_RATE);
    const lodger = region.npc('test-lodger')!;
    expect(region.floorOf('test-lodger')).toBe(0);
    expect(Math.hypot(lodger.x - region.map.spawn.x, lodger.y - region.map.spawn.y)).toBeLessThan(8);
  });

  it('are kept when a player comes back, unless that floor is gone', () => {
    const { region, conn, stairs } = cottage();
    region.join(info('b'), conn, { x: stairs.top.x, y: stairs.top.y, floor: 1 }, newCharacter());
    expect(region.position('b')).toEqual({ x: stairs.top.x, y: stairs.top.y, floor: 1 });
    expect(region.remove('b')?.carry.floor).toBe(1);
    // Out in the woods there is no floor 1: they stand on the ground.
    region.join(info('b'), conn, { x: 128.5, y: 129.5, floor: 1 }, newCharacter());
    expect(region.position('b')).toEqual({ x: 128.5, y: 129.5 });
  });
});
