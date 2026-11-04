import { afterEach, describe, expect, it } from 'vitest';
import { CREATURES, DEFAULT_SKY, PERSON_RADIUS, TICK_RATE, collides, creatureRadius, newCharacter, regionDef, type CreatureDef, type PlayerInfo, type RegionMap } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { CREATURE_REACH } from '../src/creature-brain.ts';

// Hit boxes on the server (shared hit-boxes.ts): creatures crowd round a
// player without standing in one another, only so many reach them at once,
// and players are stopped by creatures but walk through each other.

const conn = (): Connection => ({ send() {}, close() {} });
const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const none = { x: null, y: null };
const DAY = DEFAULT_SKY.dayMinutes * 60_000;

/** A region at noon with a controllable clock and fixed dice. */
function setup(id = 'sanctum') {
  const clock = { now: DAY * 10 + DAY / 2 };
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const region = new Region(regionDef(id)!, undefined, () => clock.now, random);
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock.now += 1000 / TICK_RATE;
      region.tick();
    }
  };
  return { region, clock, ticks };
}

/** The middle of an open square of land `size` tiles wide, away from everyone. */
function openSpot(map: RegionMap, region: Region, size: number): { x: number; y: number } {
  const npcs = map.npcs;
  for (let y = 20; y < map.height - 20; y += 3) {
    for (let x = 20; x < map.width - 20; x += 3) {
      let open = true;
      for (let dy = -size; dy <= size && open; dy++) for (let dx = -size; dx <= size && open; dx++) if (collides(map, x + dx + 0.5, y + dy + 0.5)) open = false;
      const busy = npcs.some((n) => Math.hypot(n.x - x, n.y - y) < size * 2) || region.creatureIds().some((id) => {
        const c = region.creature(id)!;
        return Math.hypot(c.x - x, c.y - y) < size * 3;
      });
      if (open && !busy) return { x: x + 0.5, y: y + 0.5 };
    }
  }
  throw new Error('no open land');
}

const BITER: CreatureDef = { ...CREATURES['walking-mushroom']!, name: 'Test Biter', behavior: 'chase', notice: 12, speed: 3, damage: 0, hp: 1000, cooldown: 1000 };

afterEach(() => {
  delete CREATURES['test-biter'];
});

describe('hit boxes', () => {
  it('a crowd of creatures surrounds a player without stacking, and only a ring of them reaches', () => {
    CREATURES['test-biter'] = BITER;
    const { region, ticks } = setup();
    const at = openSpot(region.map, region, 6);
    region.join(info('a'), conn(), none, newCharacter());
    region.placePlayer('a', at.x, at.y);
    // Twenty creatures, all coming from one side.
    const spots = Array.from({ length: 20 }, (_, i) => ({ x: at.x + 3 + (i % 4) * 0.7, y: at.y - 2 + Math.floor(i / 4) * 0.8 }));
    region.addCreatures('test-biter', spots);
    ticks(TICK_RATE * 12);

    const me = region.position('a')!;
    const them = region.creatureIds().filter((id) => id.startsWith('test-biter')).map((id) => region.creature(id)!);
    const touch = creatureRadius() * 2;
    for (let i = 0; i < them.length; i++) {
      expect(Math.hypot(them[i]!.x - me.x, them[i]!.y - me.y)).toBeGreaterThanOrEqual(PERSON_RADIUS + creatureRadius() - 1e-3);
      for (let j = i + 1; j < them.length; j++) expect(Math.hypot(them[i]!.x - them[j]!.x, them[i]!.y - them[j]!.y)).toBeGreaterThanOrEqual(touch - 1e-3);
    }
    const reaching = them.filter((c) => Math.hypot(c.x - me.x, c.y - me.y) <= CREATURE_REACH).length;
    // They work round the crowd until the ring about the player is full (about seven), and the rest wait behind.
    expect(reaching).toBeGreaterThanOrEqual(5);
    expect(reaching).toBeLessThanOrEqual(8);
  });

  it('stops a player walking into a creature, but not into another player', () => {
    CREATURES['test-biter'] = { ...BITER, behavior: 'wander', speed: 0 };
    const { region, ticks } = setup();
    const at = openSpot(region.map, region, 4);
    region.join(info('a'), conn(), none, newCharacter());
    region.join(info('b'), conn(), none, newCharacter());
    region.placePlayer('a', at.x, at.y);
    region.placePlayer('b', at.x + 1.5, at.y);
    let seq = 0;
    const walk = (id: string, n: number) => {
      for (let i = 0; i < n; i++) {
        region.handle(id, { t: 'input', seq: ++seq, dx: 1, dy: 0 });
        ticks(1);
      }
    };
    walk('a', 20);
    // Walked right through the other player.
    expect(region.position('a')!.x).toBeGreaterThan(at.x + 2);

    region.placePlayer('a', at.x, at.y + 2);
    region.addCreatures('test-biter', [{ x: at.x + 1.5, y: at.y + 2 }]);
    const c = region.creature('test-biter-0')!;
    walk('a', 20);
    const me = region.position('a')!;
    expect(Math.hypot(me.x - c.x, me.y - c.y)).toBeGreaterThanOrEqual(PERSON_RADIUS + creatureRadius() - 1e-3);
    expect(me.x).toBeLessThan(c.x);
  });

  it('a person steps out of the way of a player who walks into them', () => {
    const { region, ticks } = setup();
    region.join(info('a'), conn(), none, newCharacter());
    const npc = region.map.npcs[0]!;
    region.placePlayer('a', npc.x, npc.y, npc.floor ?? 0);
    ticks(TICK_RATE);
    const me = region.position('a')!;
    expect(Math.hypot(npc.x - me.x, npc.y - me.y)).toBeGreaterThan(PERSON_RADIUS);
  });

  it('creatures put on one spot get homes of their own', () => {
    CREATURES['test-biter'] = { ...BITER, behavior: 'wander' };
    const { region } = setup();
    const at = openSpot(region.map, region, 4);
    region.addCreatures('test-biter', [at, at, at]);
    const homes = ['test-biter-0', 'test-biter-1', 'test-biter-2'].map((id) => region.creature(id)!);
    for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) {
      expect(Math.hypot(homes[i]!.x - homes[j]!.x, homes[i]!.y - homes[j]!.y)).toBeGreaterThanOrEqual(creatureRadius() * 2);
    }
  });
});
