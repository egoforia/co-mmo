import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATURES,
  ITEMS,
  TICK_SECONDS,
  formatCombatHit,
  newCharacter,
  regionDef,
  type AbilityDef,
  type CombatHitTrace,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { CombatLogger } from '../src/region/combat-logger.ts';

function fakeConn(): Connection & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return { messages, send: (m) => messages.push(m), close() {} };
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

describe('Combat Log & Hit Receipts (Tool 5)', () => {
  it('records physical attack with variance, armor mitigation, final damage and threat', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable({ maxEvents: 100 });

    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
    region.setCombatLogger(logger);

    const conn = fakeConn();
    const ch = newCharacter();
    ch.stats.might = 20;
    ch.equipment.weapon = 'iron_sword'; // physical weapon

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);

    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    region.placeCreature(cId, 10, 10); // place in melee reach

    const initialHp = c.hp;
    // Perform attack
    region.handle('p1', { t: 'attack', target: cId });

    const events = logger.events();
    expect(events.length).toBeGreaterThan(0);
    const trace = events[0];

    expect(trace.attacker.id).toBe('p1');
    expect(trace.attacker.name).toBe('Mara');
    expect(trace.target.id).toBe(cId);
    expect(trace.damageType).toBe('physical');
    expect(trace.finalAmount).toBeGreaterThan(0);
    expect(trace.mitigation.defenseStat).toBe(c.def.armor ?? 0);
    expect(c.hp).toBe(initialHp - trace.finalAmount);
    expect(trace.threat?.added).toBe(trace.finalAmount);
    expect(formatCombatHit(trace)).toContain('Mara hit');
  });

  it('records arcane ability with Ward mitigation', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable({ maxEvents: 100 });

    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
    region.setCombatLogger(logger);

    const conn = fakeConn();
    const ch = newCharacter();
    ch.calling = 'wishweaver';
    ch.abilities = ['firebolt'];
    ch.energy = 50;

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);

    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    region.placeCreature(cId, 11, 10);

    // Cast firebolt
    region.handle('p1', { t: 'ability', ability: 'firebolt', target: cId });

    const events = logger.events();
    const fireboltHit = events.find((e) => e.action.id === 'firebolt');
    expect(fireboltHit).toBeDefined();
    expect(fireboltHit!.damageType).toBe('arcane');
    expect(fireboltHit!.mitigation.defenseStat).toBe(c.def.ward ?? 0);
    expect(fireboltHit!.finalAmount).toBeGreaterThan(0);
  });

  it('records critical hits when rolled', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable({ maxEvents: 100 });

    // Force random to 0.01 so crit rolls succeed
    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.01);
    region.setCombatLogger(logger);

    const conn = fakeConn();
    const ch = newCharacter();
    ch.stats.agility = 50; // high crit chance

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);
    const cId = region.creatureIds()[0];
    region.placeCreature(cId, 10, 10);

    region.handle('p1', { t: 'attack', target: cId });

    const events = logger.events();
    expect(events.length).toBeGreaterThan(0);
    const trace = events[0];
    expect(trace.rolls.crit).toBeDefined();
    expect(trace.rolls.crit!.crit).toBe(true);
    expect(trace.rolls.crit!.multiplier).toBeGreaterThan(1);
    expect(formatCombatHit(trace)).toContain('Critical!');
  });

  it('records creature attacks on player, including dodges', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable();

    // Random roll of 0.01 triggers dodge if dodge chance > 0.01
    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.01);
    region.setCombatLogger(logger);

    const conn = fakeConn();
    const ch = newCharacter();
    ch.stats.agility = 50; // high dodge chance

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);
    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    c.aggro = 'p1';
    c.threat = { p1: 100 };
    c.lastAttack = 0;
    c.asleep = false;
    c.x = 10;
    c.y = 10;
    c.home = { x: 10, y: 10, floor: 0 };

    // Creature strikes player via tick
    region.tick();

    // Should have recorded dodge
    const events = logger.events();
    expect(events.length).toBeGreaterThan(0);
    const trace = events[0];
    expect(trace.attacker.kind).toBe('creature');
    expect(trace.target.id).toBe('p1');
    expect(trace.rolls.dodge?.dodged).toBe(true);
    expect(trace.finalAmount).toBe(0);
    expect(formatCombatHit(trace)).toContain('dodged');
  });

  it('records creature attack shield block mitigation', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable();

    // With random = 0.1:
    // dodgeChance for 0 agility is 0.05. Roll 0.1 > 0.05 -> not dodged.
    // shield block chance is 0.4. Roll 0.1 < 0.4 -> blocked!
    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.1);
    region.setCombatLogger(logger);

    (ITEMS as any)['wooden_shield'] = {
      id: 'wooden_shield',
      name: 'Wooden Shield',
      kind: 'equipment',
      slot: 'offhand',
      block: 0.5,
      blockAmount: 10,
    };

    const conn = fakeConn();
    const ch = newCharacter();
    ch.stats.agility = 0;
    ch.equipment.offhand = 'wooden_shield';

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);
    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    c.aggro = 'p1';
    c.threat = { p1: 100 };
    c.lastAttack = 0;
    c.asleep = false;
    c.x = 10;
    c.y = 10;
    c.home = { x: 10, y: 10, floor: 0 };

    region.tick();

    const events = logger.events();
    expect(events.length).toBeGreaterThan(0);
    const trace = events[0];
    expect(trace.attacker.kind).toBe('creature');
    expect(trace.target.id).toBe('p1');
    expect(trace.rolls.dodge?.dodged).toBe(false);
    expect(trace.rolls.block).toBeDefined();
    expect(trace.rolls.block!.blocked).toBe(true);
    expect(trace.rolls.block!.amount).toBeGreaterThan(0);
    expect(formatCombatHit(trace)).toContain('blocked');
  });

  it('enforces ring buffer capacity (auto-eviction) and JSON export', () => {
    const logger = new CombatLogger({ capacity: 5 });
    logger.enable({ maxEvents: 1000 });

    for (let i = 0; i < 8; i++) {
      const trace: CombatHitTrace = {
        id: `trace-${i}`,
        at: 1000 + i,
        tick: i,
        region: 'shore',
        attacker: { id: 'p1', name: 'Mara', kind: 'player' },
        target: { id: 'c1', name: 'Crab', kind: 'creature' },
        action: { id: 'attack', name: 'Attack', kind: 'attack' },
        damageType: 'physical',
        pierce: false,
        rolls: { variance: 1 },
        factors: { base: 10, power: 10, raw: 10 },
        mitigation: { shieldAbsorb: 0, defenseStat: 0, afterDefense: 10 },
        finalAmount: 10,
        defeated: false,
      };
      logger.record(trace);
    }

    const events = logger.events();
    expect(events.length).toBe(5);
    // Oldest 3 (0, 1, 2) were evicted; 3, 4, 5, 6, 7 remain
    expect(events[0].id).toBe('trace-3');
    expect(events[4].id).toBe('trace-7');

    // JSON export
    const jsonStr = logger.exportJson();
    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(5);
  });

  it('integrates with balance testing to extract total damage and DPS', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable();

    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
    region.setCombatLogger(logger);

    const conn = fakeConn();
    const ch = newCharacter();
    ch.stats.might = 30;
    ch.equipment.weapon = 'iron_sword';
    region.join(info('p1', 'Mara'), conn, { x: 10, y: 10 }, ch);

    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    c.hp = 10000;
    c.def.hp = 10000;
    region.placeCreature(cId, 10, 10);

    // Simulate 5 attacks over 10 seconds (one attack every 2s)
    for (let i = 0; i < 5; i++) {
      clock.now += 2000;
      region.handle('p1', { t: 'attack', target: cId });
    }

    const events = logger.events({ entity: 'p1' });
    expect(events.length).toBe(5);

    const totalDamage = events.reduce((sum, e) => sum + e.finalAmount, 0);
    const durationSeconds = 10;
    const dps = totalDamage / durationSeconds;

    expect(totalDamage).toBeGreaterThan(0);
    expect(dps).toBeGreaterThan(0);
  });

  it('automatically deactivates when duration expires', () => {
    const clock = { now: 1_000_000 };
    const logger = new CombatLogger({ now: () => clock.now });
    logger.enable({ maxDurationMs: 1000 });
    expect(logger.active).toBe(true);

    // Advance clock past expiration
    clock.now += 1500;
    logger.record({
      id: 'test',
      at: clock.now,
      tick: 1,
      region: 'shore',
      attacker: { id: 'p', name: 'P', kind: 'player' },
      target: { id: 'c', name: 'C', kind: 'creature' },
      action: { id: 'a', name: 'A', kind: 'attack' },
      damageType: 'physical',
      pierce: false,
      rolls: { variance: 1 },
      factors: { base: 1, power: 1, raw: 1 },
      mitigation: { shieldAbsorb: 0, defenseStat: 0, afterDefense: 1 },
      finalAmount: 1,
      defeated: false,
    });

    expect(logger.active).toBe(false);
  });
});
