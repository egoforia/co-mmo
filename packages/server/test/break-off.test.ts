import { describe, expect, it } from 'vitest';
import { CREATURES, TICK_RATE, Tile, breakOffOf, generateRegion, isSafe, regenOf, regionDef, validateDefinition, type CreatureDef, type RegionMap } from '@co-mmo/shared';
import { CHASE_SECONDS, LEASH, LOST_DISTANCE, makeCreature, think, type Creature, type Habitat, type Prey } from '../src/creature-brain.ts';

// Breaking off a chase (combat decisions, step 6): each kind gives up its own
// way, heals at its own rate all the time, and none follows into a safe area.

/** Open ground everywhere: nothing in the way, no safe areas unless a test lays one. */
function openMap(): RegionMap {
  const map = generateRegion(regionDef('shore')!);
  map.tiles.fill(Tile.Ground);
  Object.assign(map, { buildings: [], storeys: [], stairways: [], spots: [], npcs: [], creatures: [], landmarks: [], safe: [] });
  return map;
}

const HOME = { x: 100.5, y: 100.5 };

function monster(more: Partial<CreatureDef> = {}): Creature {
  const def: CreatureDef = { ...CREATURES['walking-mushroom']!, behavior: 'chase', notice: 6, speed: 3, damage: 0, hp: 100, cooldown: 1, active: 'always', ...more };
  return makeCreature('m', 'test-monster', def, HOME.x, HOME.y, () => 0.5);
}

/**
 * A player who walks away east at `speed` tiles a second (0 stands still)
 * while the monster chases; returns a tick function and the player.
 */
function chase(c: Creature, speed: number, map = openMap()) {
  const p: Prey = { id: 'a', x: HOME.x + 1, y: HOME.y, floor: 0, alive: true, lit: false };
  let tick = 0;
  const h = (): Habitat => ({ map, now: 1_000_000 + (tick * 1000) / TICK_RATE, tick, random: () => 0.5, phase: 0.5, weather: 'clear', players: [p], creatures: [c], hurt() {} });
  c.aggro = 'a';
  c.threat = { a: 1 };
  c.chased = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) {
      tick++;
      p.x += speed / TICK_RATE;
      think(c, h());
    }
  };
  return { p, run, map };
}

describe('breaking off', () => {
  it('each behaviour has a fitting way, and a monster may name its own', () => {
    expect(breakOffOf({ behavior: 'wander' })).toBe('lost');
    expect(breakOffOf({ behavior: 'guard' })).toBe('edge');
    expect(breakOffOf({ behavior: 'chase' })).toBe('timed');
    expect(breakOffOf({ behavior: 'chase', breakOff: 'edge' })).toBe('edge');
  });

  it('timed: it gives up after a while, sooner the farther it is from home', () => {
    // Kept close: a player circling near home holds it longest.
    const near = monster({ breakOff: 'timed' });
    const n = chase(near, 0);
    n.run(CHASE_SECONDS - 2);
    expect(near.aggro).toBe('a');
    n.run(4);
    // Broken off, it does not turn straight back on the player beside it.
    expect(near.aggro).toBeNull();
    n.run(3);
    expect(near.aggro).toBeNull();
    // Led away: the same chase ends well before 20 s.
    const far = monster({ breakOff: 'timed', speed: 2.5 });
    const f = chase(far, 2.4);
    let gaveUp = 0;
    for (let s = 1; s <= CHASE_SECONDS && !gaveUp; s++) {
      f.run(1);
      if (!far.aggro) gaveUp = s;
    }
    expect(gaveUp).toBeGreaterThan(0);
    expect(gaveUp).toBeLessThan(CHASE_SECONDS - 4);
  });

  it('lost: dragged too far, it stays where it ends up and wanders there, and goes back home only when it falls', () => {
    const c = monster({ breakOff: 'lost', speed: 3 });
    const { run } = chase(c, 2.8);
    run(15);
    expect(c.aggro).toBeNull();
    expect(c.returning).toBe(false);
    const there = { ...c.home };
    expect(Math.hypot(there.x - HOME.x, there.y - HOME.y)).toBeGreaterThan(LOST_DISTANCE);
    expect(c.lostFrom).toEqual({ ...HOME, floor: 0 });
    // When it falls, it comes back at its old home.
    c.hp = 0;
    c.respawnAt = 0;
    think(c, { map: openMap(), now: 2_000_000, tick: 1, random: () => 0.5, phase: 0.5, weather: 'clear', players: [], creatures: [c], hurt() {} });
    expect(c.home).toEqual({ ...HOME, floor: 0 });
    expect(c.x).toBe(HOME.x);
  });

  it('edge: it chases to the edge of its reach, keeps watch there, and gives up when they are well beyond', () => {
    const c = monster({ breakOff: 'edge', speed: 3 });
    const { p, run } = chase(c, 2);
    run(4);
    // At the edge, the player farther out: it holds.
    expect(c.aggro).toBe('a');
    expect(Math.hypot(c.x - HOME.x, c.y - HOME.y)).toBeLessThan(LEASH + 1.5);
    p.x = HOME.x + LEASH + c.def.notice * 2 + 1;
    run(0.2);
    expect(c.aggro).toBeNull();
    expect(c.returning).toBe(true);
  });

  it('heals at its own rate all the time, and no longer jumps to full health at home', () => {
    const c = monster({ hp: 200, regen: 4 });
    expect(regenOf(c.def)).toBe(4);
    expect(regenOf({ hp: 300 })).toBe(3);
    c.hp = 100;
    const { run } = chase(c, 0);
    run(5);
    expect(c.hp).toBeCloseTo(120, 0);
    // Gave up and went home: still only its rate.
    c.aggro = null;
    c.returning = true;
    c.x = HOME.x + 0.1;
    run(1);
    expect(c.returning).toBe(false);
    expect(c.hp).toBeLessThan(130);
  });

  it('never follows a player into a safe area: it stops at the edge', () => {
    for (const way of ['timed', 'lost', 'edge'] as const) {
      const map = openMap();
      map.safe = [{ x: HOME.x + 7, y: HOME.y, radius: 3 }];
      const c = monster({ breakOff: way, speed: 3 });
      const { p, run } = chase(c, 0, map);
      p.x = HOME.x + 7;
      for (let i = 0; i < 6 * TICK_RATE; i++) {
        run(1 / TICK_RATE);
        expect(isSafe(map, c.x, c.y), way).toBe(false);
      }
    }
  });

  it('a wished monster may choose how it breaks off; an unknown way is left out', () => {
    const base = { kind: 'creature', id: 'bog-crab', name: 'Bog Crab', description: 'A crab of the bog.', hp: 20, damage: 2, speed: 2, notice: 5, cooldown: 1.2, xp: 5, behavior: 'chase', art: 'A small crab.' };
    expect(validateDefinition({ ...base, breakOff: 'lost' })).toMatchObject({ breakOff: 'lost' });
    expect(validateDefinition({ ...base, breakOff: 'sulk' })).not.toHaveProperty('breakOff');
  });
});
