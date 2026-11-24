import { describe, expect, it } from 'vitest';
import { attackCooldown, newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { CombatLogger } from '../src/region/combat-logger.ts';
import { EARLY_MS, keepEarly } from '../src/region/held-actions.ts';

// A swing or skill that arrives a little before it is ready is done when it
// is, not lost (region/held-actions.ts).

function fakeConn(): Connection & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return { messages, send: (m) => messages.push(m), close() {} };
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });

/** A player beside a creature that will not die, run or strike back, and a count of the player's hits. */
function fight() {
  const clock = { now: 1_000_000 };
  const logger = new CombatLogger({ now: () => clock.now });
  logger.enable({ maxEvents: 1000 });
  const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
  region.setCombatLogger(logger);
  const ch = newCharacter();
  ch.equipment.weapon = 'iron_sword';
  region.join(info('p1'), fakeConn(), { x: 10, y: 10 }, ch);
  const id = region.creatureIds()[0]!;
  const c = region.state.creatures.find((cr) => cr.id === id)!;
  c.def = { ...c.def, damage: 0, behavior: 'wander' };
  c.rest = 1e9;
  const keep = () => {
    c.hp = 1e9;
    region.placeCreature(id, 10, 10);
  };
  keep();
  const hits = () => logger.events().filter((e) => e.attacker.id === 'p1').length;
  const p = region.state.players.get('p1')!;
  const tick = (at: number) => {
    clock.now = at;
    region.tick();
    keep();
  };
  return { clock, region, id, hits, p, tick, cooldown: attackCooldown(ch) * 1000 };
}

describe('attacks that come a little early', () => {
  it('keeps only what is at most EARLY_MS early', () => {
    expect(keepEarly(1000, 1100, 'c1')).toEqual({ at: 1100, target: 'c1' });
    expect(keepEarly(1000, 1000 + EARLY_MS + 1)).toBeUndefined();
  });

  it('strikes the moment it is ready, counting the next from then', () => {
    const f = fight();
    const start = f.clock.now;
    f.region.handle('p1', { t: 'attack', target: f.id });
    expect(f.hits()).toBe(1);
    // The next swing, sent as the first ended, arrives 40 ms early.
    f.clock.now = start + f.cooldown - 40;
    f.region.handle('p1', { t: 'attack', target: f.id });
    expect(f.hits()).toBe(1);
    // The next tick after it is ready strikes it.
    f.tick(start + f.cooldown + 10);
    expect(f.hits()).toBe(2);
    expect(f.p.lastAttack).toBe(start + f.cooldown);
    expect(f.p.heldAttack).toBeUndefined();
  });

  it('still drops a swing sent far too early', () => {
    const f = fight();
    const start = f.clock.now;
    f.region.handle('p1', { t: 'attack', target: f.id });
    f.clock.now = start + f.cooldown - EARLY_MS - 50;
    f.region.handle('p1', { t: 'attack', target: f.id });
    f.tick(start + f.cooldown + 10);
    expect(f.hits()).toBe(1);
  });

  it('keeps a held swing when a later one comes too early', () => {
    const f = fight();
    const start = f.clock.now;
    f.region.handle('p1', { t: 'attack', target: f.id });
    f.clock.now = start + f.cooldown - 40;
    f.region.handle('p1', { t: 'attack', target: f.id });
    f.p.lastAttack = start + 1000;
    f.region.handle('p1', { t: 'attack', target: f.id });
    expect(f.p.heldAttack?.at).toBe(start + f.cooldown);
  });

  it('does a skill that came early when it is ready', () => {
    const f = fight();
    const ch = f.p.character;
    ch.calling = 'wishweaver';
    ch.abilities = ['firebolt'];
    ch.energy = 100;
    const start = f.clock.now;
    f.p.readyAt.set('firebolt', start + 60);
    f.region.handle('p1', { t: 'ability', ability: 'firebolt', target: f.id });
    expect(f.p.heldAbility?.ability).toBe('firebolt');
    expect(f.hits()).toBe(0);
    f.tick(start + 100);
    expect(f.p.heldAbility).toBeUndefined();
    expect(f.hits()).toBe(1);
  });
});
